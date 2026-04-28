// Shared email helpers used by stripe-webhook, public-invoice, and
// invoice-reminders. Sends payment confirmation receipts and sign-reminder
// emails via Resend.
//
// Each helper returns { ok, id?, error? } and never throws.

const RESEND_API_URL = "https://api.resend.com/emails";
const FROM_EMAIL = "Pretty Potty <hello@getprettypotty.com>";
const REPLY_TO = "hello@getprettypotty.com";

// deno-lint-ignore no-explicit-any
type Json = any;

const escapeHtml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const fmtMoney = (cents: number, currency: string) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);

const fmtDate = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString("en-US", { dateStyle: "long" })
    : "—";

interface EmailResult {
  ok: boolean;
  id?: string;
  error?: string;
}

async function sendViaResend(opts: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<EmailResult> {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return { ok: false, error: "RESEND_API_KEY not set" };
  const r = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [opts.to],
      reply_to: REPLY_TO,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error("Resend error:", r.status, j);
    return { ok: false, error: (j as Json)?.message ?? `HTTP ${r.status}` };
  }
  return { ok: true, id: (j as Json)?.id };
}

const FOOTER_HTML = `
  <p style="margin-top:32px;color:#666;font-size:13px;line-height:1.5;border-top:1px solid #eee;padding-top:12px;">
    <strong style="color:#222;">Pretty Potty</strong> &middot; Elevated Restroom Experiences<br/>
    (512) 270-5164 &middot; getprettypotty.com<br/>
    Austin, TX &amp; all of Central Texas
  </p>`;

/**
 * Full receipt sent once the invoice is fully complete (paid + signed if a
 * document was attached, or just paid if not). This is the customer's "save
 * this for your records" copy.
 */
export async function sendPaymentConfirmation(args: {
  invoice: Json;
  items: Json[];
  document: Json | null;
  publicUrl: string;
}): Promise<EmailResult> {
  const { invoice, items, document, publicUrl } = args;
  const total = fmtMoney(invoice.total_cents, invoice.currency);
  const eventLabel = invoice.email_subject?.trim()
    ? ` — ${invoice.email_subject.trim()}`
    : "";

  const itemsRows =
    (items ?? [])
      .map(
        (it) => `<tr>
            <td style="padding:6px 12px 6px 0;border-bottom:1px solid #eee;">${escapeHtml(it.description)}</td>
            <td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:right;">${it.quantity}</td>
            <td style="padding:6px 0 6px 12px;border-bottom:1px solid #eee;text-align:right;">${fmtMoney(it.amount_cents, invoice.currency)}</td>
          </tr>`,
      )
      .join("") || "";

  const docBlock =
    document && document.signed_at
      ? `<p style="margin:20px 0 8px 0;"><strong>Signed agreement:</strong> ${escapeHtml(document.title)}</p>
         <p style="color:#555;font-size:13px;margin:0;">
           Signed by ${escapeHtml(document.signer_name ?? invoice.customer_name)} on ${fmtDate(document.signed_at)}.
         </p>`
      : "";

  const html = `
    <div style="font-family:Arial,sans-serif;color:#222;font-size:14px;line-height:1.5;max-width:560px;margin:0 auto;">
      <p>Hi ${escapeHtml(invoice.customer_name)},</p>
      <p>Thank you! Your payment has been received and your booking with Pretty Potty is confirmed${eventLabel ? `<strong>${eventLabel}</strong>` : ""}.</p>

      <div style="margin:20px 0;padding:16px 20px;background:#ecfdf5;border-left:4px solid #10b981;border-radius:6px;">
        <div style="font-size:13px;color:#065f46;text-transform:uppercase;letter-spacing:0.04em;">Paid</div>
        <div style="font-size:22px;font-weight:700;color:#065f46;margin-top:4px;">${total}</div>
        <div style="font-size:13px;color:#065f46;margin-top:4px;">on ${fmtDate(invoice.paid_at)}</div>
      </div>

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
          ${
            invoice.tax_cents > 0
              ? `<tr><td colspan="2" style="padding:4px 12px 4px 0;text-align:right;color:#555;">Tax</td><td style="padding:4px 0 4px 12px;text-align:right;">${fmtMoney(invoice.tax_cents, invoice.currency)}</td></tr>`
              : ""
          }
          <tr>
            <td colspan="2" style="padding:8px 12px 8px 0;text-align:right;font-weight:bold;">Total paid</td>
            <td style="padding:8px 0 8px 12px;text-align:right;font-weight:bold;">${total}</td>
          </tr>
        </tfoot>
      </table>

      ${docBlock}

      <p style="margin:24px 0 8px 0;color:#555;">A copy of your invoice is always available here:</p>
      <p style="margin:0 0 24px 0;">
        <a href="${publicUrl}" style="color:#0f172a;text-decoration:underline;">${publicUrl}</a>
      </p>

      <p style="color:#444;">If you have any questions about your booking, just reply to this email — we'd love to help.</p>
      ${FOOTER_HTML}
    </div>`;

  const text = [
    `Hi ${invoice.customer_name},`,
    `Thank you! Your payment has been received and your Pretty Potty booking${eventLabel} is confirmed.`,
    "",
    `Paid: ${total} on ${fmtDate(invoice.paid_at)}`,
    "",
    "Items:",
    ...(items ?? []).map(
      (it) => `  - ${it.description} x${it.quantity} — ${fmtMoney(it.amount_cents, invoice.currency)}`,
    ),
    `  Subtotal: ${fmtMoney(invoice.subtotal_cents, invoice.currency)}`,
    invoice.tax_cents > 0 ? `  Tax: ${fmtMoney(invoice.tax_cents, invoice.currency)}` : "",
    `  Total paid: ${total}`,
    "",
    document && document.signed_at
      ? `Signed agreement: ${document.title} (signed ${fmtDate(document.signed_at)} by ${document.signer_name ?? invoice.customer_name})`
      : "",
    "",
    `Invoice copy: ${publicUrl}`,
    "",
    "Questions? Reply to this email.",
    "— Pretty Potty",
  ]
    .filter(Boolean)
    .join("\n");

  const subject = invoice.email_subject?.trim()
    ? `Pretty Potty: payment received — ${invoice.email_subject.trim()}`
    : `Pretty Potty: payment received — ${total}`;

  return await sendViaResend({ to: invoice.customer_email, subject, html, text });
}

/**
 * Sent when payment has cleared but a service agreement is attached and
 * unsigned. The CTA points back to the hosted invoice page where the canvas
 * signature widget lives.
 */
export async function sendSignReminder(args: {
  invoice: Json;
  document: Json;
  publicUrl: string;
  reminderIndex: number; // 0-based; controls copy tone
}): Promise<EmailResult> {
  const { invoice, document, publicUrl, reminderIndex } = args;
  const total = fmtMoney(invoice.total_cents, invoice.currency);
  const eventLabel = invoice.email_subject?.trim() ? ` for ${invoice.email_subject.trim()}` : "";

  // Slightly more direct copy on later nudges.
  const opening =
    reminderIndex === 0
      ? `Thanks for your payment! We've received <strong>${total}</strong>${eventLabel ? ` for ${escapeHtml(invoice.email_subject!.trim())}` : ""}.`
      : reminderIndex === 1
      ? `Just a quick reminder — we still need your signature on the service agreement to finalize your booking.`
      : `Final reminder: please sign your service agreement so we can confirm your booking.`;

  const html = `
    <div style="font-family:Arial,sans-serif;color:#222;font-size:14px;line-height:1.5;max-width:560px;margin:0 auto;">
      <p>Hi ${escapeHtml(invoice.customer_name)},</p>
      <p>${opening}</p>
      <p>To finalize your booking, we just need your signature on the
      <strong>${escapeHtml(document.title)}</strong>. It only takes a few seconds — sign right on the page from your phone or computer.</p>

      <p style="margin:24px 0;text-align:center;">
        <a href="${publicUrl}"
           style="display:inline-block;padding:12px 28px;background:#0f172a;color:#fff;
                  text-decoration:none;border-radius:6px;font-weight:600;">
          Sign service agreement
        </a>
      </p>
      <p style="font-size:12px;color:#888;">If the button doesn't work, copy this link:<br/>${publicUrl}</p>
      <p style="color:#444;">Questions? Just reply to this email.</p>
      ${FOOTER_HTML}
    </div>`;

  const text = [
    `Hi ${invoice.customer_name},`,
    opening.replace(/<[^>]+>/g, ""),
    "",
    `To finalize your booking, please sign your ${document.title}:`,
    publicUrl,
    "",
    "— Pretty Potty",
  ].join("\n");

  const subject =
    reminderIndex === 0
      ? `Payment received — please sign your service agreement${eventLabel}`
      : reminderIndex >= 2
      ? `Final reminder: please sign your service agreement${eventLabel}`
      : `Reminder: please sign your service agreement${eventLabel}`;

  return await sendViaResend({ to: invoice.customer_email, subject, html, text });
}
