// Admin: list / get / void invoices.
//
// GET ?action=list&status=<all|draft|sent|paid|overdue|signed|void>&q=<search>
// GET ?action=get&id=<uuid>
// POST { action: "void", id: string }

import { corsHeaders, json, requireAdmin } from "../_shared/admin.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let ctx;
  try {
    ctx = await requireAdmin(req);
  } catch (resp) {
    return resp as Response;
  }
  const { adminEmail, supabase } = ctx;

  const url = new URL(req.url);
  const action = url.searchParams.get("action") ?? "list";

  if (req.method === "GET" && action === "list") {
    const status = url.searchParams.get("status") ?? "all";
    const q = url.searchParams.get("q")?.trim() ?? "";
    let query = supabase
      .from("invoices")
      .select(
        "id, invoice_number, customer_name, customer_email, customer_phone, total_cents, currency, status, issued_at, due_at, paid_at, created_at, public_token, stripe_payment_link_url, last_reminder_at, reminder_count",
      )
      .order("created_at", { ascending: false })
      .limit(200);
    if (status !== "all") query = query.eq("status", status);
    if (q) {
      query = query.or(
        `invoice_number.ilike.%${q}%,customer_name.ilike.%${q}%,customer_email.ilike.%${q}%`,
      );
    }
    const { data, error } = await query;
    if (error) return json({ error: error.message }, 500);
    return json({ invoices: data ?? [] });
  }

  if (req.method === "GET" && action === "get") {
    const id = url.searchParams.get("id");
    if (!id) return json({ error: "Missing id" }, 400);
    const [{ data: invoice, error: e1 }, { data: items }, { data: doc }, { data: events }] =
      await Promise.all([
        supabase.from("invoices").select("*").eq("id", id).maybeSingle(),
        supabase.from("invoice_items").select("*").eq("invoice_id", id).order("position"),
        supabase.from("invoice_documents").select("*").eq("invoice_id", id).maybeSingle(),
        supabase
          .from("invoice_events")
          .select("*")
          .eq("invoice_id", id)
          .order("occurred_at", { ascending: false })
          .limit(50),
      ]);
    if (e1) return json({ error: e1.message }, 500);
    if (!invoice) return json({ error: "Not found" }, 404);
    return json({ invoice, items: items ?? [], document: doc, events: events ?? [] });
  }

  if (req.method === "POST" && action === "void") {
    const body = (await req.json().catch(() => null)) as { id?: string } | null;
    if (!body?.id) return json({ error: "id required" }, 400);
    const { error } = await supabase
      .from("invoices")
      .update({ status: "void", voided_at: new Date().toISOString() })
      .eq("id", body.id)
      .neq("status", "paid");
    if (error) return json({ error: error.message }, 500);
    await supabase.from("invoice_events").insert({
      invoice_id: body.id,
      type: "voided",
      channel: "web",
      meta: { by: adminEmail },
    });
    return json({ ok: true });
  }

  return json({ error: "Unknown action" }, 400);
});
