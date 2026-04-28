// Quo / OpenPhone webhook receiver.
//
// Handles two events:
//   - message.received  -> log inbound + (maybe) auto-reply via Claude
//   - message.delivered -> log outbound; if NOT sent by our AI, treat it as
//                          a human/Quo-app reply and pause the bot for 24h.
//
// Setup:
//   1. In Quo dashboard, create a webhook for events
//        ['message.received', 'message.delivered']
//      pointing at:
//        https://<project-ref>.supabase.co/functions/v1/receive-sms
//   2. "Reveal signing secret" -> paste into env QUO_WEBHOOK_SIGNING_KEY.
//   3. Set ANTHROPIC_API_KEY (and optionally ANTHROPIC_MODEL).
//   4. Set SMS_AI_AUTOREPLY=on  (or 'off' to globally kill auto-replies).
//
// IMPORTANT: in the Supabase dashboard, mark this function as
//   `--no-verify-jwt` so Quo can hit it without a Supabase JWT.

import { serviceClient } from "../_shared/admin.ts";
import { verifyQuoSignature } from "../_shared/sms.ts";
import { cancelScheduledAiReply, scheduleAiReply } from "../_shared/ai-pipeline.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, openphone-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

interface QuoMessageObject {
  id: string;
  object: "message";
  from: string;
  to: string | string[];
  direction: "incoming" | "outgoing";
  body?: string;            // v2
  text?: string;            // v4
  status?: string;
  createdAt: string;
  conversationId?: string;
  phoneNumberId?: string;
}

interface QuoEvent {
  id: string;
  type: string;
  apiVersion?: string;
  data?: { object?: QuoMessageObject };
}

function pickText(m: QuoMessageObject): string {
  return (m.text ?? m.body ?? "").trim();
}
function firstTo(m: QuoMessageObject): string {
  return Array.isArray(m.to) ? m.to[0] : m.to;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // Read raw body for signature verification (must NOT re-stringify).
  const raw = await req.text();
  const signingKey = Deno.env.get("QUO_WEBHOOK_SIGNING_KEY");
  const ok = await verifyQuoSignature(
    raw,
    req.headers.get("openphone-signature"),
    signingKey,
  );
  if (!ok) {
    console.warn("receive-sms: signature verification failed");
    return json({ error: "Unauthorized" }, 401);
  }

  let evt: QuoEvent;
  try {
    evt = JSON.parse(raw) as QuoEvent;
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const msg = evt.data?.object;
  if (!msg?.id) return json({ ok: true, skipped: "no_message" });

  const supabase = serviceClient();

  // ------------------------------------------------------------------
  // De-dupe: if we've already stored this Quo message, exit.
  // ------------------------------------------------------------------
  const { data: existing } = await supabase
    .from("sms_messages")
    .select("id")
    .eq("quo_message_id", msg.id)
    .maybeSingle();
  if (existing) return json({ ok: true, skipped: "duplicate" });

  // For inbound: customer = from, our number = to.
  // For outbound: our number = from, customer = to.
  const isInbound = msg.direction === "incoming" || evt.type === "message.received";
  const ourNumber = isInbound ? firstTo(msg) : msg.from;
  const customerNumber = isInbound ? msg.from : firstTo(msg);
  const text = pickText(msg);

  // ------------------------------------------------------------------
  // Upsert thread.
  // ------------------------------------------------------------------
  const { data: threadRow } = await supabase
    .from("sms_threads")
    .upsert(
      {
        our_number: ourNumber,
        customer_number: customerNumber,
        quo_conversation_id: msg.conversationId ?? null,
      },
      { onConflict: "our_number,customer_number", ignoreDuplicates: false },
    )
    .select("*")
    .single();

  if (!threadRow) {
    return json({ error: "Failed to upsert thread" }, 500);
  }

  // Stamp last_inbound/outbound and conversation id (in case it was new).
  const stamp: Record<string, unknown> = {
    quo_conversation_id: msg.conversationId ?? threadRow.quo_conversation_id,
    updated_at: new Date().toISOString(),
  };
  if (isInbound) stamp.last_inbound_at = msg.createdAt;
  else stamp.last_outbound_at = msg.createdAt;
  await supabase.from("sms_threads").update(stamp).eq("id", threadRow.id);

  // ------------------------------------------------------------------
  // Insert the message row.
  // ------------------------------------------------------------------
  // Outbound delivered events come from BOTH our AI (we sent it) and human
  // admins replying inside the Quo app. We can't tell from the payload, so
  // we look up whether we just inserted a matching outbound message in the
  // last few minutes; if so, mark role=ai, otherwise role=admin.
  let role: "customer" | "ai" | "admin" = "customer";
  if (!isInbound) {
    const since = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: recentAi } = await supabase
      .from("sms_messages")
      .select("id, body")
      .eq("thread_id", threadRow.id)
      .eq("direction", "outbound")
      .eq("role", "ai")
      .is("quo_message_id", null)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(5);
    const matchingAi = (recentAi ?? []).find((m) => (m.body ?? "").trim() === text);
    if (matchingAi) {
      // Stamp the existing AI row with the Quo id; don't insert a duplicate.
      await supabase
        .from("sms_messages")
        .update({ quo_message_id: msg.id, status: msg.status ?? "delivered" })
        .eq("id", matchingAi.id);
      return json({ ok: true, linked_ai: matchingAi.id });
    }
    role = "admin";
  }

  await supabase.from("sms_messages").insert({
    thread_id: threadRow.id,
    direction: isInbound ? "inbound" : "outbound",
    role,
    body: text,
    quo_message_id: msg.id,
    status: msg.status ?? null,
    created_at: msg.createdAt ?? new Date().toISOString(),
  });

  // ------------------------------------------------------------------
  // Outbound from a human admin -> pause the bot for 24h AND cancel any
  // currently-pending AI reply that hasn't fired yet.
  // ------------------------------------------------------------------
  if (!isInbound && role === "admin") {
    const pausedUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await supabase
      .from("sms_threads")
      .update({ bot_paused_until: pausedUntil })
      .eq("id", threadRow.id);
    await cancelScheduledAiReply(supabase, threadRow.id);
    return json({ ok: true, paused_bot: true });
  }

  // From here on we only act on inbound.
  if (!isInbound) return json({ ok: true });

  // ------------------------------------------------------------------
  // Schedule the AI reply (does NOT call Claude yet). The cron worker
  // sms-process-pending will fire it after the configured delay, giving
  // the human owner a buffer to jump in first.
  // ------------------------------------------------------------------
  await scheduleAiReply({
    supabase,
    threadId: threadRow.id,
    threadRow,
    customerNumber,
    incomingText: text,
  });

  return json({ ok: true });
});
