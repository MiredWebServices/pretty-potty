// Sends a brand-new email from hello@getprettypotty.com (not a reply).
// Auth: Supabase JWT + admin_users allowlist.
// Logs the sent email to public.outbound_replies with inbound_email_id = NULL.

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

    // Auth.
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

    // Allowlist gate.
    const { data: adminRow } = await supabase
      .from("admin_users")
      .select("email")
      .ilike("email", adminEmail)
      .maybeSingle();
    if (!adminRow) return json({ error: "Not authorized" }, 403);

    // Parse + validate.
    const body = await req.json().catch(() => null) as
      | { to?: string | string[]; subject?: string; body?: string }
      | null;
    if (!body?.to || !body?.subject?.trim() || !body?.body?.trim()) {
      return json({ error: "to, subject and body are required" }, 400);
    }
    const recipients = Array.isArray(body.to)
      ? body.to.filter((t) => typeof t === "string" && t.trim())
      : [body.to.trim()];
    if (recipients.length === 0) return json({ error: "No valid recipients" }, 400);

    const textBody = body.body.trim();
    const htmlBody = `
      <div style="font-family: Arial, sans-serif; color: #222; font-size: 14px; line-height: 1.5;">
        ${escapeHtml(textBody).replace(/\n/g, "<br/>")}
      </div>
    `;

    const resendRes = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: recipients,
        reply_to: REPLY_TO_ADDRESS,
        subject: body.subject.trim(),
        html: htmlBody,
        text: textBody,
      }),
    });
    const resendJson = await resendRes.json().catch(() => ({}));
    if (!resendRes.ok) {
      console.error("Resend send failed:", resendRes.status, resendJson);
      return json({ error: resendJson?.message ?? "Resend send failed" }, 502);
    }

    await supabase.from("outbound_replies").insert({
      inbound_email_id: null,
      resend_email_id: resendJson?.id ?? null,
      from_address: FROM_ADDRESS,
      to_addresses: recipients,
      subject: body.subject.trim(),
      body_text: textBody,
      body_html: htmlBody,
      in_reply_to: null,
      sent_by: adminEmail,
    });

    return json({ ok: true, resend_email_id: resendJson?.id ?? null });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("send-admin-email error:", message);
    return json({ error: message }, 500);
  }
});
