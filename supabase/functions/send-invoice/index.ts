// Admin: send (or re-send) an invoice to the customer via email + SMS.
//
// POST { invoice_id: string, channels?: ("email"|"sms")[] }
//
// Email -> Resend
// SMS   -> Quo / OpenPhone API (https://api.openphone.com/v1/messages)
//
// Updates invoice.status to 'sent' if currently 'draft', stamps issued_at,
// and logs an invoice_events row per channel.

import { corsHeaders, json, requireAdmin, siteOrigin } from "../_shared/admin.ts";

const RESEND_API_URL = "https://api.resend.com/emails";
const QUO_API_URL = "https://api.openphone.com/v1/messages";
const FROM_EMAIL = "Pretty Potty <hello@getprettypotty.com>";
const REPLY_TO = "hello@getprettypotty.com";

interface SendBody {
  invoice_id?: string;
  channels?: Array<"email" | "sms">;
  /** When true, this is a follow-up reminder (changes copy + logs as 'reminded'). */
  reminder?: boolean;
}

const fmtMoney = (cents: number, currency: string) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let ctx;
  try {
    ctx = await requireAdmin(req);
  } catch (resp) {
    return resp as Response;
  }
  const { adminEmail, supabase } = ctx;

  const body = (await req.json().catch(() => null)) as SendBody | null;
  if (!body?.invoice_id) return json({ error: "invoice_id required" }, 400);

  const channels = body.channels?.length ? body.channels : ["email", "sms"];
  const isReminder = !!body.reminder;

  // Load invoice + items + document.
  const { data: invoice, error: invErr } = await supabase
    .from("invoices")
    .select("*")
    .eq("id", body.invoice_id)
    .maybeSingle();
  if (invErr || !invoice) return json({ error: "Invoice not found" }, 404);

  if (!invoice.stripe_payment_link_url) {
    return json(
      { error: "Invoice has no Stripe payment link. Re-create with STRIPE_SECRET_KEY configured." },
      400,
    );
  }

  const { data: items } = await supabase
    .from("invoice_items")
    .select("*")
    .eq("invoice_id", invoice.id)
    .order("position");

  const publicUrl = `${siteOrigin()}/i/${invoice.public_token}`;
  const totalStr = fmtMoney(invoice.total_cents, invoice.currency);
  const dueStr = invoice.due_at
    ? new Date(invoice.due_at).toLocaleDateString("en-US", { dateStyle: "medium" })
    : null;

  const results: Record<string, { ok: boolean; error?: string; id?: string }> = {};

  // ---------- email ----------
  if (channels.includes("email")) {
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      results.email = { ok: false, error: "RESEND_API_KEY not configured" };
    } else {
      // Customer-facing subject. We deliberately omit the internal invoice
      // number; admins can set a per-invoice override (e.g. "Smith wedding
      // 5/4/26") that better describes what the customer is paying for.
      const baseSubject = invoice.email_subject?.trim()
        ? `Pretty Potty: ${invoice.email_subject.trim()} — ${totalStr}`
        : `Your Pretty Potty invoice — ${totalStr}`;
      const subject = isReminder ? `Reminder: ${baseSubject}` : baseSubject;

      const intro = isReminder
        ? `<p>Hi ${escapeHtml(invoice.customer_name)},</p>
           <p>Just a friendly reminder that your invoice is still awaiting payment.</p>`
        : `<p>Hi ${escapeHtml(invoice.customer_name)},</p>
           <p>Thanks for choosing Pretty Potty. Your invoice is ready for review and payment.</p>`;

      // Optional note from the admin shown above the line items.
      const noteBlock = invoice.customer_notes?.trim()
        ? `<div style="margin:16px 0;padding:12px 16px;background:#f6f7f9;border-radius:8px;
                       font-size:14px;color:#222;white-space:pre-wrap;">
             ${escapeHtml(invoice.customer_notes.trim())}
           </div>`
        : "";

      const itemsRows =
        (items ?? [])
          .map(
            (it) =>
              `<tr>
                 <td style="padding:6px 12px 6px 0;border-bottom:1px solid #eee;">${escapeHtml(it.description)}</td>
                 <td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:right;">${it.quantity}</td>
                 <td style="padding:6px 0 6px 12px;border-bottom:1px solid #eee;text-align:right;">${fmtMoney(it.amount_cents, invoice.currency)}</td>
               </tr>`,
          )
          .join("") || "";

      const html = `
        <div style="font-family:Arial,sans-serif;color:#222;font-size:14px;line-height:1.5;max-width:560px;margin:0 auto;">
          ${intro}
          ${noteBlock}
          <p style="margin:16px 0;">
            <strong>Total due:</strong> ${totalStr}
            ${dueStr ? `<br/><strong>Due:</strong> ${dueStr}` : ""}
          </p>
          <table style="width:100%;border-collapse:collapse;margin:12px 0;">
            <thead>
              <tr style="text-align:left;color:#777;font-size:12px;">
                <th style="padding:6px 12px 6px 0;border-bottom:1px solid #ddd;">Item</th>
                <th style="padding:6px 12px;border-bottom:1px solid #ddd;text-align:right;">Qty</th>
                <th style="padding:6px 0 6px 12px;border-bottom:1px solid #ddd;text-align:right;">Amount</th>
              </tr>
            </thead>
            <tbody>${itemsRows}</tbody>
            <tfoot>
              <tr>
                <td colspan="2" style="padding:8px 12px 8px 0;text-align:right;color:#555;">Subtotal</td>
                <td style="padding:8px 0 8px 12px;text-align:right;">${fmtMoney(invoice.subtotal_cents, invoice.currency)}</td>
              </tr>
              ${invoice.tax_cents > 0 ? `<tr><td colspan="2" style="padding:4px 12px 4px 0;text-align:right;color:#555;">Tax</td><td style="padding:4px 0 4px 12px;text-align:right;">${fmtMoney(invoice.tax_cents, invoice.currency)}</td></tr>` : ""}
              <tr>
                <td colspan="2" style="padding:8px 12px 8px 0;text-align:right;font-weight:bold;">Total</td>
                <td style="padding:8px 0 8px 12px;text-align:right;font-weight:bold;">${totalStr}</td>
              </tr>
            </tfoot>
          </table>
          <p style="margin:24px 0;text-align:center;">
            <a href="${publicUrl}"
               style="display:inline-block;padding:12px 24px;background:#0f172a;color:#fff;
                      text-decoration:none;border-radius:6px;font-weight:600;">
              View &amp; pay invoice
            </a>
          </p>
          <p style="font-size:12px;color:#888;">If the button doesn't work, copy this link:<br/>${publicUrl}</p>
          <p style="margin-top:24px;color:#666;font-size:13px;line-height:1.5;border-top:1px solid #eee;padding-top:12px;">
            <strong style="color:#222;">Pretty Potty</strong> · Elevated Restroom Experiences<br/>
            (512) 270-5164 · getprettypotty.com<br/>
            Austin, TX &amp; all of Central Texas
          </p>
        </div>`;

      const text = [
        isReminder
          ? `Hi ${invoice.customer_name}, just a reminder that your Pretty Potty invoice is awaiting payment.`
          : `Hi ${invoice.customer_name}, your Pretty Potty invoice is ready.`,
        invoice.customer_notes?.trim() ? `\n${invoice.customer_notes.trim()}\n` : "",
        `Total: ${totalStr}${dueStr ? `, due ${dueStr}` : ""}`,
        `View & pay: ${publicUrl}`,
        "",
        "— Pretty Potty",
      ]
        .filter(Boolean)
        .join("\n");

      const r = await fetch(RESEND_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from: FROM_EMAIL,
          to: [invoice.customer_email],
          reply_to: REPLY_TO,
          subject,
          html,
          text,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok) {
        results.email = { ok: true, id: j?.id };
        await supabase.from("invoice_events").insert({
          invoice_id: invoice.id,
          type: isReminder ? "reminded" : "sent",
          channel: "email",
          meta: { resend_email_id: j?.id, by: adminEmail },
        });
      } else {
        console.error("Resend send failed:", r.status, j);
        results.email = { ok: false, error: j?.message ?? `HTTP ${r.status}` };
      }
    }
  }

  // ---------- sms via Quo / OpenPhone ----------
  if (channels.includes("sms") && invoice.customer_phone) {
    const QUO_API_KEY = Deno.env.get("QUO_API_KEY") ?? Deno.env.get("OPENPHONE_API_KEY");
    const QUO_FROM = Deno.env.get("QUO_FROM_NUMBER") ?? Deno.env.get("OPENPHONE_FROM_NUMBER");
    if (!QUO_API_KEY || !QUO_FROM) {
      results.sms = { ok: false, error: "QUO_API_KEY / QUO_FROM_NUMBER not configured" };
    } else {
      const smsBody = isReminder
        ? `Pretty Potty reminder: your invoice for ${totalStr} is awaiting payment. View & pay: ${publicUrl}`
        : `Pretty Potty: your invoice for ${totalStr} is ready. View & pay: ${publicUrl}`;

      const r = await fetch(QUO_API_URL, {
        method: "POST",
        headers: {
          // Quo / OpenPhone uses raw API key (no "Bearer ").
          Authorization: QUO_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          content: smsBody,
          from: QUO_FROM,
          to: [invoice.customer_phone],
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok) {
        results.sms = { ok: true, id: j?.data?.id ?? j?.id };
        await supabase.from("invoice_events").insert({
          invoice_id: invoice.id,
          type: isReminder ? "reminded" : "sent",
          channel: "sms",
          meta: { quo_id: results.sms.id, by: adminEmail },
        });
      } else {
        console.error("Quo SMS send failed:", r.status, j);
        results.sms = { ok: false, error: j?.message ?? j?.error?.message ?? `HTTP ${r.status}` };
      }
    }
  } else if (channels.includes("sms") && !invoice.customer_phone) {
    results.sms = { ok: false, error: "No customer_phone on invoice" };
  }

  // Promote draft -> sent.
  const updates: Record<string, unknown> = {};
  if (invoice.status === "draft" && (results.email?.ok || results.sms?.ok)) {
    updates.status = "sent";
    updates.issued_at = new Date().toISOString();
  }
  if (isReminder && (results.email?.ok || results.sms?.ok)) {
    updates.last_reminder_at = new Date().toISOString();
    updates.reminder_count = (invoice.reminder_count ?? 0) + 1;
  }
  if (Object.keys(updates).length > 0) {
    await supabase.from("invoices").update(updates).eq("id", invoice.id);
  }

  return json({ ok: true, results });
});

const escapeHtml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
