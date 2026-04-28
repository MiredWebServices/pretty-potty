// Admin endpoints for the SMS auto-reply system.
//
// GET  ?action=context                 -> business context row
// PUT  ?action=context  + JSON body    -> update business context
// POST ?action=mute     {thread_id, muted: bool} -> toggle bot mute on a thread
// POST ?action=resume   {thread_id}    -> clear bot_paused_until
// POST ?action=send_draft {message_id} -> send an existing role=ai status=draft message via Quo
//
// All calls require an authenticated admin (admin_users allowlist).

import { corsHeaders, json, requireAdmin } from "../_shared/admin.ts";
import { sendQuoSms } from "../_shared/sms.ts";

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
  const action = url.searchParams.get("action") ?? "";

  // -------- context --------
  if (action === "context" && req.method === "GET") {
    const { data, error } = await supabase
      .from("sms_business_context")
      .select("*")
      .eq("id", 1)
      .maybeSingle();
    if (error) return json({ error: error.message }, 500);
    return json({ context: data });
  }

  if (action === "context" && req.method === "PUT") {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return json({ error: "Invalid JSON" }, 400);
    const allow = [
      "services_md",
      "pricing_md",
      "policy_md",
      "faq_md",
      "greeting",
      "timezone",
      "quiet_hours_start",
      "quiet_hours_end",
      "max_ai_replies_per_24h",
      "auto_send_enabled",
    ] as const;
    const patch: Record<string, unknown> = { id: 1, updated_at: new Date().toISOString() };
    for (const k of allow) if (k in body) patch[k] = body[k];
    const { data, error } = await supabase
      .from("sms_business_context")
      .upsert(patch)
      .select("*")
      .single();
    if (error) return json({ error: error.message }, 500);
    return json({ context: data, by: adminEmail });
  }

  // -------- mute / resume --------
  if (action === "mute" && req.method === "POST") {
    const { thread_id, muted } = (await req.json().catch(() => ({}))) as {
      thread_id?: string;
      muted?: boolean;
    };
    if (!thread_id) return json({ error: "thread_id required" }, 400);
    const { error } = await supabase
      .from("sms_threads")
      .update({ bot_muted: !!muted, updated_at: new Date().toISOString() })
      .eq("id", thread_id);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  if (action === "cancel_pending" && req.method === "POST") {
    const { thread_id } = (await req.json().catch(() => ({}))) as { thread_id?: string };
    if (!thread_id) return json({ error: "thread_id required" }, 400);
    await supabase
      .from("sms_threads")
      .update({ next_ai_at: null, updated_at: new Date().toISOString() })
      .eq("id", thread_id);
    await supabase.from("sms_messages").insert({
      thread_id,
      direction: "outbound",
      role: "system",
      body: null,
      ai_meta: { skipped: "cancelled_by_admin", by: adminEmail },
    });
    return json({ ok: true });
  }

  if (action === "resume" && req.method === "POST") {
    const { thread_id } = (await req.json().catch(() => ({}))) as { thread_id?: string };
    if (!thread_id) return json({ error: "thread_id required" }, 400);
    const { error } = await supabase
      .from("sms_threads")
      .update({ bot_paused_until: null, updated_at: new Date().toISOString() })
      .eq("id", thread_id);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  // -------- send_draft: turn an AI draft into a real outbound SMS --------
  if (action === "send_draft" && req.method === "POST") {
    const { message_id, override_body } = (await req.json().catch(() => ({}))) as {
      message_id?: string;
      override_body?: string;
    };
    if (!message_id) return json({ error: "message_id required" }, 400);

    const { data: m, error: mErr } = await supabase
      .from("sms_messages")
      .select("*, sms_threads:thread_id(*)")
      .eq("id", message_id)
      .maybeSingle();
    if (mErr || !m) return json({ error: "Message not found" }, 404);
    if (m.role !== "ai" || m.status !== "draft") {
      return json({ error: "Only AI drafts can be sent" }, 400);
    }
    const thread = m.sms_threads;
    if (!thread) return json({ error: "Thread missing" }, 500);

    const body = (override_body ?? m.body ?? "").trim();
    if (!body) return json({ error: "Empty body" }, 400);

    const send = await sendQuoSms({
      from: thread.our_number,
      to: thread.customer_number,
      content: body,
    });
    if (!send.ok) return json({ error: send.error ?? "send failed" }, 502);

    await supabase
      .from("sms_messages")
      .update({
        status: "sent",
        body,
        ai_meta: { ...(m.ai_meta ?? {}), decision: "admin_sent_draft", quo_send_id: send.id, by: adminEmail },
      })
      .eq("id", message_id);

    await supabase
      .from("sms_threads")
      .update({ last_outbound_at: new Date().toISOString() })
      .eq("id", thread.id);

    return json({ ok: true, quo_id: send.id });
  }

  return json({ error: "Unknown action" }, 400);
});
