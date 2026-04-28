// Public (no auth) invoice access via public_token. Used by /i/<token>.
//
// GET  ?token=<public_token>           -> { invoice, items, document }
// POST { action: "viewed", token }     -> logs an event (idempotent-ish)
// POST { action: "sign", token, signer_name, signer_email, signature_data_url }
//      -> records signature, marks invoice 'signed'.
//
// All access is gated by knowledge of the random public_token. We never expose
// internal_notes, stripe internal IDs, or admin emails.

import { corsHeaders, json, serviceClient, siteOrigin } from "../_shared/admin.ts";
import { sendPaymentConfirmation } from "../_shared/email.ts";

interface SignBody {
  action: "sign";
  token: string;
  signer_name?: string;
  signer_email?: string;
  signature_data_url?: string;
}

interface ViewedBody {
  action: "viewed";
  token: string;
}

const sanitizeInvoice = (inv: Record<string, unknown>) => ({
  id: inv.id,
  // Note: we deliberately omit invoice_number from the customer-facing payload
  // so the hosted invoice page doesn't surface internal numbering. It still
  // exists in the DB for admin/audit purposes.
  customer_name: inv.customer_name,
  customer_email: inv.customer_email,
  subtotal_cents: inv.subtotal_cents,
  tax_cents: inv.tax_cents,
  total_cents: inv.total_cents,
  currency: inv.currency,
  status: inv.status,
  issued_at: inv.issued_at,
  due_at: inv.due_at,
  paid_at: inv.paid_at,
  customer_notes: inv.customer_notes,
  stripe_payment_link_url: inv.stripe_payment_link_url,
  public_token: inv.public_token,
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = serviceClient();

  if (req.method === "GET") {
    const url = new URL(req.url);
    const token = url.searchParams.get("token");
    if (!token) return json({ error: "Missing token" }, 400);

    const { data: invoice } = await supabase
      .from("invoices")
      .select("*")
      .eq("public_token", token)
      .maybeSingle();
    if (!invoice) return json({ error: "Not found" }, 404);

    const [{ data: items }, { data: document }] = await Promise.all([
      supabase.from("invoice_items").select("*").eq("invoice_id", invoice.id).order("position"),
      supabase
        .from("invoice_documents")
        .select(
          "id, title, content_html, required_after_payment, signed_at, signer_name, signer_email",
        )
        .eq("invoice_id", invoice.id)
        .maybeSingle(),
    ]);

    return json({
      invoice: sanitizeInvoice(invoice),
      items: items ?? [],
      document: document ?? null,
    });
  }

  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const body = (await req.json().catch(() => null)) as
    | (ViewedBody | SignBody)
    | null;
  if (!body?.token) return json({ error: "token required" }, 400);

  const { data: invoice } = await supabase
    .from("invoices")
    .select("*")
    .eq("public_token", body.token)
    .maybeSingle();
  if (!invoice) return json({ error: "Not found" }, 404);

  if (body.action === "viewed") {
    // Promote 'sent' -> 'viewed' the first time the customer opens the link.
    if (invoice.status === "sent") {
      await supabase.from("invoices").update({ status: "viewed" }).eq("id", invoice.id);
    }
    await supabase.from("invoice_events").insert({
      invoice_id: invoice.id,
      type: "viewed",
      channel: "web",
      meta: {
        ip: req.headers.get("x-forwarded-for") ?? null,
        ua: req.headers.get("user-agent") ?? null,
      },
    });
    return json({ ok: true });
  }

  if (body.action === "sign") {
    if (invoice.status !== "paid" && invoice.status !== "signed") {
      return json({ error: "Invoice must be paid before signing" }, 400);
    }
    if (!body.signer_name?.trim() || !body.signature_data_url?.startsWith("data:image/")) {
      return json({ error: "signer_name and signature_data_url required" }, 400);
    }

    const { data: doc } = await supabase
      .from("invoice_documents")
      .select("*")
      .eq("invoice_id", invoice.id)
      .maybeSingle();
    if (!doc) return json({ error: "No document attached" }, 404);
    if (doc.signed_at) return json({ error: "Already signed" }, 409);

    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || null;
    const ua = req.headers.get("user-agent") ?? null;

    const { error: updErr } = await supabase
      .from("invoice_documents")
      .update({
        signed_at: new Date().toISOString(),
        signer_name: body.signer_name.trim(),
        signer_email: body.signer_email?.trim() || invoice.customer_email,
        signature_data_url: body.signature_data_url,
        signer_ip: ip,
        signer_user_agent: ua,
      })
      .eq("id", doc.id);
    if (updErr) return json({ error: updErr.message }, 500);

    await supabase
      .from("invoices")
      .update({ status: "signed" })
      .eq("id", invoice.id);

    await supabase.from("invoice_events").insert({
      invoice_id: invoice.id,
      type: "signed",
      channel: "web",
      meta: { ip, ua, signer_name: body.signer_name.trim() },
    });

    // Send the final "all set" confirmation receipt to the customer (best
    // effort — don't block the response on email).
    try {
      if (!invoice.payment_confirmed_at) {
        const [{ data: items }, { data: signedDoc }] = await Promise.all([
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
        const result = await sendPaymentConfirmation({
          invoice: { ...invoice, status: "signed" },
          items: items ?? [],
          document: signedDoc,
          publicUrl,
        });
        if (result.ok) {
          await supabase
            .from("invoices")
            .update({ payment_confirmed_at: new Date().toISOString() })
            .eq("id", invoice.id);
          await supabase.from("invoice_events").insert({
            invoice_id: invoice.id,
            type: "payment_confirmed",
            channel: "email",
            meta: { resend_email_id: result.id, trigger: "signed" },
          });
        } else {
          console.error("Final confirmation email failed:", result.error);
        }
      }
    } catch (e) {
      console.error("Confirmation email error (non-fatal):", e);
    }

    return json({ ok: true });
  }

  return json({ error: "Unknown action" }, 400);
});
