// Resend "email.received" webhook handler.
// Receives inbound email events, fetches full email contents from Resend's
// Received Emails API, and persists them to public.inbound_emails.
//
// Webhook signatures from Resend are signed with Svix. If RESEND_WEBHOOK_SECRET
// is set, we verify the signature; otherwise we skip verification (useful for
// local dev / initial setup, but the secret should be set in production).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { Webhook } from "https://esm.sh/svix@1.24.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, svix-id, svix-timestamp, svix-signature",
};

const RESEND_API_URL = "https://api.resend.com/emails";

interface ResendInboundEvent {
  type: string;
  created_at: string;
  data: {
    email_id: string;
    created_at: string;
    from: string;
    to: string[];
    cc?: string[];
    bcc?: string[];
    message_id?: string;
    subject?: string;
    attachments?: Array<{
      id: string;
      filename: string;
      content_type: string;
      content_disposition?: string;
      content_id?: string;
    }>;
  };
}

interface ResendEmailDetail {
  id: string;
  from?: string;
  to?: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  html?: string | null;
  text?: string | null;
  created_at?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  try {
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    const RESEND_WEBHOOK_SECRET = Deno.env.get("RESEND_WEBHOOK_SECRET");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY not configured");

    const rawBody = await req.text();

    // Verify Svix signature if a secret is configured.
    let event: ResendInboundEvent;
    if (RESEND_WEBHOOK_SECRET) {
      const wh = new Webhook(RESEND_WEBHOOK_SECRET);
      const headers = {
        "svix-id": req.headers.get("svix-id") ?? "",
        "svix-timestamp": req.headers.get("svix-timestamp") ?? "",
        "svix-signature": req.headers.get("svix-signature") ?? "",
      };
      try {
        event = wh.verify(rawBody, headers) as ResendInboundEvent;
      } catch (err) {
        console.error("Webhook signature verification failed:", err);
        return new Response(JSON.stringify({ error: "Invalid signature" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else {
      console.warn("RESEND_WEBHOOK_SECRET not set; skipping signature verification");
      event = JSON.parse(rawBody) as ResendInboundEvent;
    }

    if (event.type !== "email.received") {
      // Ignore other event types but acknowledge.
      return new Response(JSON.stringify({ ignored: event.type }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const meta = event.data;

    // Fetch full email contents (body, etc.) from Resend.
    let detail: ResendEmailDetail | null = null;
    try {
      // Inbound emails are retrieved via /emails/receiving/{id} (not the
      // outbound /emails/{id} endpoint). See:
      // https://resend.com/docs/api-reference/emails/retrieve-received-email
      const detailRes = await fetch(`${RESEND_API_URL}/receiving/${meta.email_id}`, {
        headers: { Authorization: `Bearer ${RESEND_API_KEY}` },
      });
      if (detailRes.ok) {
        detail = (await detailRes.json()) as ResendEmailDetail;
      } else {
        console.error("Failed to fetch email detail:", detailRes.status, await detailRes.text());
      }
    } catch (err) {
      console.error("Error fetching email detail:", err);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { error: dbError } = await supabase
      .from("inbound_emails")
      .upsert(
        {
          resend_email_id: meta.email_id,
          message_id: meta.message_id ?? null,
          from_address: detail?.from ?? meta.from,
          to_addresses: detail?.to ?? meta.to ?? [],
          cc_addresses: detail?.cc ?? meta.cc ?? [],
          bcc_addresses: detail?.bcc ?? meta.bcc ?? [],
          subject: detail?.subject ?? meta.subject ?? null,
          text_body: detail?.text ?? null,
          html_body: detail?.html ?? null,
          attachments: meta.attachments ?? [],
          raw_event: event,
          received_at: meta.created_at ?? event.created_at,
        },
        { onConflict: "resend_email_id" },
      );
    if (dbError) {
      console.error("DB insert error:", dbError);
      throw new Error("Failed to save inbound email");
    }

    return new Response(JSON.stringify({ ok: true, email_id: meta.email_id }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("receive-email error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
