// Admin: create a new invoice (with optional document) and a Stripe Payment Link.
//
// POST body:
// {
//   customer_name: string,
//   customer_email: string,
//   customer_phone?: string,         // E.164
//   currency?: string,                // default 'usd'
//   tax_rate_bps?: number,            // basis points; 825 = 8.25% (default Texas+Austin)
//   tax_cents?: number,               // legacy override; ignored if tax_rate_bps supplied
//   email_subject?: string,           // optional subject override for the invoice email
//   due_at?: string,                  // ISO timestamp
//   customer_notes?: string,
//   internal_notes?: string,
//   items: Array<{
//     description: string,
//     quantity?: number,              // default 1
//     unit_price_cents: number,
//   }>,
//   document?: {                      // optional agreement to sign after payment
//     title: string,
//     content_html: string,
//     required_after_payment?: boolean,
//   }
// }
//
// Returns: { invoice_id, public_token, public_url, payment_link_url }

import { corsHeaders, json, requireAdmin, siteOrigin } from "../_shared/admin.ts";

interface ItemInput {
  description: string;
  quantity?: number;
  unit_price_cents: number;
}

interface DocumentInput {
  title: string;
  content_html: string;
  required_after_payment?: boolean;
}

interface CreateInvoiceBody {
  customer_name?: string;
  customer_email?: string;
  customer_phone?: string;
  currency?: string;
  tax_rate_bps?: number;
  tax_cents?: number;
  email_subject?: string;
  due_at?: string;
  customer_notes?: string;
  internal_notes?: string;
  items?: ItemInput[];
  document?: DocumentInput;
}

// Default sales tax = 8.25% (TX state 6.25% + Austin/Travis County 2%, capped).
const DEFAULT_TAX_BPS = 825;

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

  const body = (await req.json().catch(() => null)) as CreateInvoiceBody | null;
  if (!body) return json({ error: "Invalid JSON" }, 400);
  if (!body.customer_name?.trim()) return json({ error: "customer_name required" }, 400);
  if (!body.customer_email?.trim()) return json({ error: "customer_email required" }, 400);
  if (!Array.isArray(body.items) || body.items.length === 0) {
    return json({ error: "At least one line item required" }, 400);
  }

  // Compute totals (cents).
  const items = body.items.map((it, i) => {
    const qty = Number(it.quantity ?? 1);
    const unit = Math.round(Number(it.unit_price_cents ?? 0));
    if (!it.description?.trim()) {
      throw json({ error: `Item ${i + 1} missing description` }, 400);
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      throw json({ error: `Item ${i + 1} quantity invalid` }, 400);
    }
    if (!Number.isFinite(unit) || unit < 0) {
      throw json({ error: `Item ${i + 1} unit_price_cents invalid` }, 400);
    }
    return {
      position: i,
      description: it.description.trim(),
      quantity: qty,
      unit_price_cents: unit,
      amount_cents: Math.round(qty * unit),
    };
  });
  const subtotal_cents = items.reduce((s, it) => s + it.amount_cents, 0);

  // Tax: prefer percentage (basis points). Falls back to literal cents if a
  // legacy caller still sends tax_cents.
  const taxBps =
    typeof body.tax_rate_bps === "number" && Number.isFinite(body.tax_rate_bps)
      ? Math.max(0, Math.round(body.tax_rate_bps))
      : DEFAULT_TAX_BPS;
  const taxFromBps = Math.round((subtotal_cents * taxBps) / 10_000);
  const tax_cents =
    typeof body.tax_cents === "number" && Number.isFinite(body.tax_cents) && body.tax_rate_bps == null
      ? Math.max(0, Math.round(body.tax_cents))
      : taxFromBps;
  const total_cents = subtotal_cents + tax_cents;
  if (total_cents < 50) {
    return json({ error: "Invoice total must be at least $0.50 (Stripe minimum)" }, 400);
  }

  const currency = (body.currency ?? "usd").toLowerCase();

  // Insert invoice row.
  const { data: invoice, error: invErr } = await supabase
    .from("invoices")
    .insert({
      customer_name: body.customer_name.trim(),
      customer_email: body.customer_email.trim().toLowerCase(),
      customer_phone: body.customer_phone?.trim() || null,
      subtotal_cents,
      tax_cents,
      tax_rate_bps: taxBps,
      total_cents,
      currency,
      status: "draft",
      due_at: body.due_at ?? null,
      email_subject: body.email_subject?.trim() || null,
      customer_notes: body.customer_notes?.trim() || null,
      internal_notes: body.internal_notes?.trim() || null,
      created_by: adminEmail,
    })
    .select("*")
    .single();
  if (invErr || !invoice) {
    console.error("invoice insert failed", invErr);
    return json({ error: invErr?.message ?? "Failed to create invoice" }, 500);
  }

  // Insert items.
  const { error: itemsErr } = await supabase
    .from("invoice_items")
    .insert(items.map((it) => ({ ...it, invoice_id: invoice.id })));
  if (itemsErr) {
    console.error("invoice_items insert failed", itemsErr);
    return json({ error: itemsErr.message }, 500);
  }

  // Optional document.
  if (body.document?.title?.trim() && body.document?.content_html?.trim()) {
    const { error: docErr } = await supabase.from("invoice_documents").insert({
      invoice_id: invoice.id,
      title: body.document.title.trim(),
      content_html: body.document.content_html,
      required_after_payment: body.document.required_after_payment ?? true,
    });
    if (docErr) {
      console.error("invoice_documents insert failed", docErr);
      // Non-fatal; admin can attach a doc later.
    }
  }

  // Create Stripe Payment Link.
  // We use Payment Links (not Checkout Sessions) so the same URL can be
  // re-emailed for reminders without re-creating a session each time.
  const STRIPE_KEY = Deno.env.get("STRIPE_SECRET_KEY");
  let payment_link_url: string | null = null;
  let payment_link_id: string | null = null;

  if (STRIPE_KEY) {
    try {
      // 1. Create a Stripe Product + Price for THIS invoice.
      // We collapse the whole invoice into a single line item priced at total_cents
      // because Payment Links require pre-existing prices and we want exactly one URL.
      const productRes = await stripeFetch(STRIPE_KEY, "/v1/products", {
        name: `${invoice.invoice_number} — ${invoice.customer_name}`,
        "metadata[invoice_id]": invoice.id,
      });
      const product = await productRes.json();
      if (!productRes.ok) throw new Error(product?.error?.message ?? "Stripe product failed");

      const priceRes = await stripeFetch(STRIPE_KEY, "/v1/prices", {
        product: product.id,
        currency,
        unit_amount: String(total_cents),
      });
      const price = await priceRes.json();
      if (!priceRes.ok) throw new Error(price?.error?.message ?? "Stripe price failed");

      const successUrl = `${siteOrigin()}/i/${invoice.public_token}?paid=1`;

      const linkRes = await stripeFetch(STRIPE_KEY, "/v1/payment_links", {
        "line_items[0][price]": price.id,
        "line_items[0][quantity]": "1",
        "metadata[invoice_id]": invoice.id,
        "metadata[public_token]": invoice.public_token,
        "after_completion[type]": "redirect",
        "after_completion[redirect][url]": successUrl,
        // Allow customers to enter promo codes you create in
        // Stripe Dashboard → Products → Coupons → "Create promotion code".
        allow_promotion_codes: "true",
      });
      const link = await linkRes.json();
      if (!linkRes.ok) throw new Error(link?.error?.message ?? "Stripe payment link failed");

      payment_link_url = link.url;
      payment_link_id = link.id;

      await supabase
        .from("invoices")
        .update({
          stripe_payment_link_id: payment_link_id,
          stripe_payment_link_url: payment_link_url,
        })
        .eq("id", invoice.id);
    } catch (err) {
      console.error("Stripe setup failed:", err);
      // Don't fail invoice creation — admin can retry/edit later.
    }
  } else {
    console.warn("STRIPE_SECRET_KEY not set; invoice created without payment link");
  }

  await supabase.from("invoice_events").insert({
    invoice_id: invoice.id,
    type: "created",
    channel: "web",
    meta: { by: adminEmail },
  });

  return json({
    invoice_id: invoice.id,
    invoice_number: invoice.invoice_number,
    public_token: invoice.public_token,
    public_url: `${siteOrigin()}/i/${invoice.public_token}`,
    payment_link_url,
  });
});

/** Stripe expects application/x-www-form-urlencoded for its REST API. */
async function stripeFetch(
  key: string,
  path: string,
  params: Record<string, string>,
): Promise<Response> {
  const body = new URLSearchParams(params).toString();
  return fetch(`https://api.stripe.com${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
}
