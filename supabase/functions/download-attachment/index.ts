// Streams an inbound email attachment to the admin browser.
// Auth: Supabase JWT + admin_users allowlist.
// Resend exposes attachments via /emails/receiving/{email}/attachments/{id}
// which returns metadata including a short-lived signed download_url.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const RESEND_API_URL = "https://api.resend.com";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

interface ResendAttachmentDetail {
  id: string;
  filename?: string;
  content_type?: string;
  download_url?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

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

    // Look up the inbound email to translate UI's UUID into Resend's email_id.
    const url = new URL(req.url);
    const inboundId = url.searchParams.get("inbound_email_id");
    const attachmentId = url.searchParams.get("attachment_id");
    if (!inboundId || !attachmentId) {
      return json({ error: "inbound_email_id and attachment_id required" }, 400);
    }

    const { data: inbound, error: inboundErr } = await supabase
      .from("inbound_emails")
      .select("resend_email_id, attachments")
      .eq("id", inboundId)
      .maybeSingle();
    if (inboundErr || !inbound) return json({ error: "Inbound email not found" }, 404);

    // Fetch attachment metadata (with signed download_url) from Resend.
    const metaRes = await fetch(
      `${RESEND_API_URL}/emails/receiving/${inbound.resend_email_id}/attachments/${attachmentId}`,
      { headers: { Authorization: `Bearer ${RESEND_API_KEY}` } },
    );
    if (!metaRes.ok) {
      const txt = await metaRes.text();
      console.error("Resend attachment metadata failed:", metaRes.status, txt);
      return json({ error: "Could not fetch attachment metadata" }, metaRes.status);
    }
    const meta = (await metaRes.json()) as ResendAttachmentDetail;
    if (!meta.download_url) return json({ error: "No download_url returned" }, 502);

    // Stream the file content back to the browser with sensible headers.
    const fileRes = await fetch(meta.download_url);
    if (!fileRes.ok || !fileRes.body) {
      return json({ error: "Failed to download attachment content" }, 502);
    }

    const filename = meta.filename ?? "attachment";
    const contentType = meta.content_type ?? "application/octet-stream";
    // RFC 5987 encode filename for non-ASCII safety.
    const encodedName = encodeURIComponent(filename);

    return new Response(fileRes.body, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodedName}`,
        "Cache-Control": "private, max-age=0",
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("download-attachment error:", message);
    return json({ error: message }, 500);
  }
});
