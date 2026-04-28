// Stripe webhook receiver. Marks invoices as paid on successful checkout.
//
// Configure the Stripe dashboard webhook endpoint to:
//   https://<project>.supabase.co/functions/v1/stripe-webhook
// Send these events:
//   - checkout.session.completed
//   - payment_intent.succeeded   (fallback)
//
// Verifies STRIPE_WEBHOOK_SECRET signature manually (no SDK to keep cold start fast).

import { corsHeaders, serviceClient, siteOrigin } from "../_shared/admin.ts";
import { sendPaymentConfirmation, sendSignReminder } from "../_shared/email.ts";

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  const sigHeader = req.headers.get("stripe-signature") ?? "";
  const raw = await req.text();

  if (STRIPE_WEBHOOK_SECRET) {
    const ok = await verifyStripeSignature(raw, sigHeader, STRIPE_WEBHOOK_SECRET);
    if (!ok) return json({ error: "Invalid signature" }, 401);
  } else {
    console.warn("STRIPE_WEBHOOK_SECRET not set; signature verification skipped");
  }

  let event: { id?: string; type?: string; data?: { object?: Record<string, unknown> } };
  try {
    event = JSON.parse(raw);
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const supabase = serviceClient();
  const obj = event.data?.object ?? {};
  const meta = (obj.metadata ?? {}) as Record<string, string>;
  const invoiceId = meta.invoice_id;
  const publicToken = meta.public_token;

  if (!invoiceId && !publicToken) {
    // Not one of ours; acknowledge so Stripe doesn't retry.
    return json({ ignored: event.type });
  }

  if (
    event.type === "checkout.session.completed" ||
    event.type === "payment_intent.succeeded"
  ) {
    const sessionId = (obj.id as string | undefined) ?? null;
    const paymentIntent = (obj.payment_intent as string | undefined) ?? (obj.id as string | undefined) ?? null;

    let q = supabase.from("invoices").update({
      status: "paid",
      paid_at: new Date().toISOString(),
      stripe_session_id: sessionId,
      stripe_payment_intent: paymentIntent,
    });
    q = invoiceId ? q.eq("id", invoiceId) : q.eq("public_token", publicToken);
    // Don't downgrade if already signed.
    q = q.in("status", ["draft", "sent", "viewed", "overdue"]);

    const { data: updated, error } = await q.select("id").maybeSingle();
    if (error) {
      console.error("Stripe webhook DB update failed:", error);
      return json({ error: error.message }, 500);
    }

    if (updated?.id) {
      await supabase.from("invoice_events").insert({
        invoice_id: updated.id,
        type: "paid",
        channel: "stripe",
        meta: { event_id: event.id, type: event.type, session_id: sessionId },
      });

      // Notify the customer right away.
      // - If the invoice has a service agreement that still needs signing,
      //   send the "payment received, please sign" email.
      // - Otherwise (no doc, or already signed somehow), send the full receipt.
      try {
        const { data: invoice } = await supabase
          .from("invoices")
          .select("*")
          .eq("id", updated.id)
          .maybeSingle();
        if (invoice && !invoice.payment_confirmed_at) {
          const [{ data: items }, { data: document }] = await Promise.all([
            supabase
              .from("invoice_items")
              .select("*")
              .eq("invoice_id", invoice.id)
              .order("position"),
            supabase
              .from("invoice_documents")
              .select("*")
              .eq("invoice_id", invoice.id)
              .maybeSingle(),
          ]);

          const publicUrl = `${siteOrigin()}/i/${invoice.public_token}`;
          const needsSigning = document && !document.signed_at;

          const result = needsSigning
            ? await sendSignReminder({
                invoice,
                document,
                publicUrl,
                reminderIndex: 0,
              })
            : await sendPaymentConfirmation({
                invoice,
                items: items ?? [],
                document,
                publicUrl,
              });

          if (result.ok) {
            // If we sent the full receipt, mark it confirmed so we never
            // re-send. The sign-reminder path leaves it unset so the cron can
            // continue nudging.
            const updates: Record<string, unknown> = {};
            if (!needsSigning) {
              updates.payment_confirmed_at = new Date().toISOString();
            } else {
              updates.last_sign_reminder_at = new Date().toISOString();
              updates.sign_reminder_count = (invoice.sign_reminder_count ?? 0) + 1;
            }
            await supabase.from("invoices").update(updates).eq("id", invoice.id);

            await supabase.from("invoice_events").insert({
              invoice_id: invoice.id,
              type: needsSigning ? "sign_reminded" : "payment_confirmed",
              channel: "email",
              meta: { resend_email_id: result.id, trigger: "stripe-webhook" },
            });
          } else {
            console.error("Confirmation email failed:", result.error);
          }
        }
      } catch (e) {
        // Never let email failures break the webhook (Stripe will retry).
        console.error("Post-payment email error (non-fatal):", e);
      }
    }
    return json({ ok: true });
  }

  return json({ ignored: event.type });
});

/**
 * Manual Stripe signature verification.
 * Stripe-Signature: t=<timestamp>,v1=<hex hmac sha256>
 */
async function verifyStripeSignature(
  payload: string,
  header: string,
  secret: string,
): Promise<boolean> {
  const parts = Object.fromEntries(
    header.split(",").map((kv) => {
      const i = kv.indexOf("=");
      return [kv.slice(0, i), kv.slice(i + 1)];
    }),
  );
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) return false;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`${t}.${payload}`));
  const hex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Constant-time compare.
  if (hex.length !== v1.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ v1.charCodeAt(i);
  return diff === 0;
}
