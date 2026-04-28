// Daily cron: nudge unpaid invoices via email + SMS.
//
// Trigger: schedule a Supabase Cron job that POSTs here (no auth):
//   curl -X POST https://<project>.supabase.co/functions/v1/invoice-reminders \
//        -H 'Authorization: Bearer <CRON_SECRET>'
//
// Header `x-cron-secret` (or Authorization: Bearer <secret>) must match CRON_SECRET env.
//
// Reminder cadence (only fires once per day per invoice):
//   +1 day past issued_at  -> reminder #1
//   +3 days past issued_at -> reminder #2
//   +7 days past issued_at -> reminder #3 (final)

import { corsHeaders, serviceClient, siteOrigin } from "../_shared/admin.ts";

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const RESEND_API_URL = "https://api.resend.com/emails";
const QUO_API_URL = "https://api.openphone.com/v1/messages";
const FROM_EMAIL = "Pretty Potty <hello@getprettypotty.com>";

const REMINDER_DAYS = [1, 3, 7]; // days after issued_at

const fmtMoney = (cents: number, currency: string) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // Auth: shared secret. Either Authorization: Bearer <secret> or x-cron-secret.
  const expected = Deno.env.get("CRON_SECRET");
  if (expected) {
    const auth = req.headers.get("Authorization") ?? "";
    const headerSecret = req.headers.get("x-cron-secret") ?? "";
    const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (bearer !== expected && headerSecret !== expected) {
      return json({ error: "Unauthorized" }, 401);
    }
  }

  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  const QUO_API_KEY = Deno.env.get("QUO_API_KEY") ?? Deno.env.get("OPENPHONE_API_KEY");
  const QUO_FROM = Deno.env.get("QUO_FROM_NUMBER") ?? Deno.env.get("OPENPHONE_FROM_NUMBER");

  const supabase = serviceClient();

  // Fetch candidate invoices: sent or viewed, not paid, with issued_at set.
  const { data: invoices, error } = await supabase
    .from("invoices")
    .select("*")
    .in("status", ["sent", "viewed", "overdue"])
    .not("issued_at", "is", null)
    .lte("reminder_count", REMINDER_DAYS.length - 1)
    .limit(200);
  if (error) return json({ error: error.message }, 500);

  const now = Date.now();
  const ONE_DAY = 24 * 60 * 60 * 1000;
  const summary: Array<{ id: string; sent: string[]; skipped?: string }> = [];

  for (const inv of invoices ?? []) {
    const issued = new Date(inv.issued_at).getTime();
    const ageDays = Math.floor((now - issued) / ONE_DAY);

    // Determine which reminder index this invoice should be on.
    const targetIdx = inv.reminder_count ?? 0;
    if (targetIdx >= REMINDER_DAYS.length) {
      summary.push({ id: inv.id, sent: [], skipped: "max_reached" });
      continue;
    }
    const dueDays = REMINDER_DAYS[targetIdx];
    if (ageDays < dueDays) {
      summary.push({ id: inv.id, sent: [], skipped: `wait_${dueDays - ageDays}d` });
      continue;
    }

    // Don't re-fire within 20h of last reminder.
    if (
      inv.last_reminder_at &&
      now - new Date(inv.last_reminder_at).getTime() < 20 * 60 * 60 * 1000
    ) {
      summary.push({ id: inv.id, sent: [], skipped: "recent" });
      continue;
    }

    const publicUrl = `${siteOrigin()}/i/${inv.public_token}`;
    const totalStr = fmtMoney(inv.total_cents, inv.currency);
    const sentChans: string[] = [];

    // Email
    if (RESEND_API_KEY && inv.customer_email) {
      const r = await fetch(RESEND_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from: FROM_EMAIL,
          to: [inv.customer_email],
          subject: inv.email_subject?.trim()
            ? `Reminder: Pretty Potty: ${inv.email_subject.trim()} — ${totalStr}`
            : `Reminder: your Pretty Potty invoice — ${totalStr}`,
          html: `<div style="font-family:Arial,sans-serif;color:#222;font-size:14px;line-height:1.5;">
            <p>Hi ${escapeHtml(inv.customer_name)},</p>
            <p>This is a friendly reminder that your Pretty Potty invoice for
            <strong>${totalStr}</strong> is still awaiting payment.</p>
            ${
              inv.customer_notes?.trim()
                ? `<div style="margin:12px 0;padding:12px 16px;background:#f6f7f9;border-radius:8px;font-size:14px;color:#222;white-space:pre-wrap;">${escapeHtml(inv.customer_notes.trim())}</div>`
                : ""
            }
            <p style="margin:24px 0;text-align:center;">
              <a href="${publicUrl}" style="display:inline-block;padding:12px 24px;background:#0f172a;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;">
                View &amp; pay invoice
              </a>
            </p>
            <p style="color:#666;font-size:13px;">— Pretty Potty</p>
          </div>`,
          text: `Reminder: your Pretty Potty invoice for ${totalStr} is awaiting payment.\nView & pay: ${publicUrl}`,
        }),
      });
      if (r.ok) {
        sentChans.push("email");
        const j = await r.json().catch(() => ({}));
        await supabase.from("invoice_events").insert({
          invoice_id: inv.id,
          type: "reminded",
          channel: "email",
          meta: { resend_email_id: j?.id, reminder_index: targetIdx },
        });
      } else {
        console.error("Reminder email failed:", inv.id, await r.text());
      }
    }

    // SMS
    if (QUO_API_KEY && QUO_FROM && inv.customer_phone) {
      const r = await fetch(QUO_API_URL, {
        method: "POST",
        headers: { Authorization: QUO_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({
          content: `Pretty Potty reminder: your invoice for ${totalStr} is awaiting payment. View & pay: ${publicUrl}`,
          from: QUO_FROM,
          to: [inv.customer_phone],
        }),
      });
      if (r.ok) {
        sentChans.push("sms");
        const j = await r.json().catch(() => ({}));
        await supabase.from("invoice_events").insert({
          invoice_id: inv.id,
          type: "reminded",
          channel: "sms",
          meta: { quo_id: j?.data?.id ?? j?.id, reminder_index: targetIdx },
        });
      } else {
        console.error("Reminder SMS failed:", inv.id, await r.text());
      }
    }

    if (sentChans.length > 0) {
      await supabase
        .from("invoices")
        .update({
          last_reminder_at: new Date().toISOString(),
          reminder_count: targetIdx + 1,
        })
        .eq("id", inv.id);
    }

    summary.push({ id: inv.id, sent: sentChans });
  }

  return json({ ok: true, processed: summary.length, summary });
});
