// Sends a reply to an inbound email from the admin inbox UI.
// Auth: Supabase JWT + admin_users allowlist (same model as list-inbound-emails).
// Threading: sets In-Reply-To and References headers using the inbound message_id
// so most clients (Gmail, Apple Mail, etc.) thread the reply with the original.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RESEND_API_URL = "https://api.resend.com/emails";
const FROM_ADDRESS = "Pretty Potty <hello@getprettypotty.com>";
const REPLY_TO_ADDRESS = "hello@getprettypotty.com";

// Signature appended to every outbound email. Helps deliverability (looks like
// a real business email) and keeps branding consistent.
const SIGNATURE_TEXT = `--
Pretty Potty · Elevated Restroom Experiences
(512) 270-5164 · https://getprettypotty.com
Austin, TX & all of Central Texas`;

const SIGNATURE_HTML = `
<p style="margin-top:24px;color:#666;font-size:13px;line-height:1.5;border-top:1px solid #eee;padding-top:12px;">
  <strong style="color:#222;">Pretty Potty</strong> · Elevated Restroom Experiences<br/>
  <a href="tel:+15122705164" style="color:#666;text-decoration:none;">(512) 270-5164</a> ·
  <a href="https://getprettypotty.com" style="color:#666;text-decoration:none;">getprettypotty.com</a><br/>
  Austin, TX &amp; all of Central Texas
</p>`;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const escapeHtml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (!RESEND_API_KEY) return json({ error: "Email service not configured" }, 500);

    // 1. Auth.
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "Missing Authorization" }, 401);
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser(jwt);
    if (userErr || !userData?.user?.email) return json({ error: "Invalid session" }, 401);
    const adminEmail = userData.user.email.toLowerCase();

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 2. Allowlist check.
    const { data: adminRow } = await supabase
      .from("admin_users")
      .select("email")
      .ilike("email", adminEmail)
      .maybeSingle();
    if (!adminRow) return json({ error: "Not authorized" }, 403);

    // 3. Parse body.
    const body = await req.json().catch(() => null) as
      | { inbound_email_id?: string; body?: string; subject?: string }
      | null;
    if (!body?.inbound_email_id || !body?.body?.trim()) {
      return json({ error: "inbound_email_id and body are required" }, 400);
    }

    // 4. Look up inbound email for recipient + threading + quoted original.
    const { data: inbound, error: inboundErr } = await supabase
      .from("inbound_emails")
      .select("from_address, subject, message_id, text_body, html_body, received_at")
      .eq("id", body.inbound_email_id)
      .maybeSingle();
    if (inboundErr || !inbound) return json({ error: "Inbound email not found" }, 404);

    const recipient = inbound.from_address;
    const replySubject =
      body.subject?.trim() ||
      (inbound.subject?.startsWith("Re:") ? inbound.subject : `Re: ${inbound.subject ?? ""}`).trim();

    // Auto-quote original message so the reply has context (helps deliverability
    // and looks like a legitimate conversation).
    const replyText = body.body.trim();
    const originalText = (
      inbound.text_body ??
      (inbound.html_body ?? "").replace(/<[^>]+>/g, "")
    ).trim();
    const originalDate = new Date(inbound.received_at).toLocaleString("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    });
    const quotedText = originalText
      ? `\n\nOn ${originalDate}, ${recipient} wrote:\n${originalText
          .split("\n")
          .map((line: string) => `> ${line}`)
          .join("\n")}`
      : "";

    const textBody = `${replyText}\n\n${SIGNATURE_TEXT}${quotedText}`;

    const quotedHtml = originalText
      ? `<blockquote style="margin:16px 0 0 0;padding:0 0 0 12px;border-left:3px solid #ddd;color:#555;font-size:13px;">
          <p style="color:#888;font-size:12px;margin:0 0 8px 0;">
            On ${escapeHtml(originalDate)}, ${escapeHtml(recipient)} wrote:
          </p>
          <div>${escapeHtml(originalText).replace(/\n/g, "<br/>")}</div>
        </blockquote>`
      : "";

    const htmlBody = `
      <div style="font-family: Arial, sans-serif; color: #222; font-size: 14px; line-height: 1.5;">
        <div>${escapeHtml(replyText).replace(/\n/g, "<br/>")}</div>
        ${SIGNATURE_HTML}
        ${quotedHtml}
      </div>
    `;

    // 6. Send via Resend with threading headers.
    const resendPayload: Record<string, unknown> = {
      from: FROM_ADDRESS,
      to: [recipient],
      reply_to: REPLY_TO_ADDRESS,
      subject: replySubject,
      html: htmlBody,
      text: textBody,
    };
    if (inbound.message_id) {
      resendPayload.headers = {
        "In-Reply-To": inbound.message_id,
        References: inbound.message_id,
      };
    }

    const resendRes = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify(resendPayload),
    });
    const resendJson = await resendRes.json().catch(() => ({}));
    if (!resendRes.ok) {
      console.error("Resend send failed:", resendRes.status, resendJson);
      return json({ error: resendJson?.message ?? "Resend send failed" }, 502);
    }

    // 7. Log the reply.
    await supabase.from("outbound_replies").insert({
      inbound_email_id: body.inbound_email_id,
      resend_email_id: resendJson?.id ?? null,
      from_address: FROM_ADDRESS,
      to_addresses: [recipient],
      subject: replySubject,
      body_text: textBody,
      body_html: htmlBody,
      in_reply_to: inbound.message_id ?? null,
      sent_by: adminEmail,
    });

    return json({ ok: true, resend_email_id: resendJson?.id ?? null });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("send-admin-reply error:", message);
    return json({ error: message }, 500);
  }
});
