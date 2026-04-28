// Shared AI reply pipeline used by:
//   - receive-sms (called once per inbound SMS to SCHEDULE a reply)
//   - sms-process-pending (cron worker that actually CALLS Claude when due)
//
// Splitting these two phases lets the human owner intervene during the
// delay window and silently cancel the bot.

import { ChatTurn, draftSmsReply } from "./anthropic.ts";
import {
  detectAutomatedNoise,
  isInQuietHours,
  sendQuoSms,
} from "./sms.ts";

// deno-lint-ignore no-explicit-any
type Sb = any;

interface ScheduleArgs {
  supabase: Sb;
  threadId: string;
  threadRow: {
    bot_muted: boolean;
    bot_paused_until: string | null;
    ai_reply_delay_seconds: number | null;
  };
  customerNumber: string;
  incomingText: string;
}

const log = (supabase: Sb, threadId: string, reason: string, extra: Record<string, unknown> = {}) =>
  supabase.from("sms_messages").insert({
    thread_id: threadId,
    direction: "outbound",
    role: "system",
    body: null,
    ai_meta: { skipped: reason, ...extra },
  });

/**
 * Called from the webhook. Runs the cheap pre-LLM checks; if everything
 * passes, sets `sms_threads.next_ai_at = now() + delay`. The actual Claude
 * call happens later in `runScheduledAiReply`.
 */
export async function scheduleAiReply(args: ScheduleArgs): Promise<void> {
  const { supabase, threadId, threadRow, customerNumber, incomingText } = args;

  // Global kill switch.
  if ((Deno.env.get("SMS_AI_AUTOREPLY") ?? "on").toLowerCase() === "off") {
    await log(supabase, threadId, "global_kill_switch");
    return;
  }

  // Pre-LLM filter #1: short-code / OTP / marketing.
  const noiseReason = detectAutomatedNoise({
    fromNumber: customerNumber,
    body: incomingText,
  });
  if (noiseReason) {
    await log(supabase, threadId, "automated_noise", { kind: noiseReason });
    return;
  }

  // Pre-LLM filter #2: phone has a paid invoice in the last 14 days
  //                    -> active customer, never auto-reply.
  const recentCutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const { data: recentInvoices } = await supabase
    .from("invoices")
    .select("id, paid_at, status")
    .eq("customer_phone", customerNumber)
    .gte("paid_at", recentCutoff)
    .limit(1);
  if (recentInvoices && recentInvoices.length > 0) {
    await log(supabase, threadId, "active_customer", {
      invoice_id: recentInvoices[0].id,
      paid_at: recentInvoices[0].paid_at,
    });
    return;
  }

  // Per-thread mute / pause.
  if (threadRow.bot_muted) {
    await log(supabase, threadId, "thread_muted");
    return;
  }
  if (
    threadRow.bot_paused_until &&
    new Date(threadRow.bot_paused_until).getTime() > Date.now()
  ) {
    await log(supabase, threadId, "thread_paused", { until: threadRow.bot_paused_until });
    return;
  }

  // Resolve delay: per-thread override -> global default -> 120s.
  const { data: ctx } = await supabase
    .from("sms_business_context")
    .select("ai_reply_delay_seconds, auto_send_enabled")
    .eq("id", 1)
    .maybeSingle();
  if (!ctx) {
    await log(supabase, threadId, "no_business_context");
    return;
  }
  if (!ctx.auto_send_enabled) {
    await log(supabase, threadId, "context_auto_send_disabled");
    return;
  }
  const delaySec = threadRow.ai_reply_delay_seconds ?? ctx.ai_reply_delay_seconds ?? 120;
  const nextAt = new Date(Date.now() + delaySec * 1000).toISOString();

  await supabase
    .from("sms_threads")
    .update({ next_ai_at: nextAt, updated_at: new Date().toISOString() })
    .eq("id", threadId);

  await log(supabase, threadId, "scheduled", { at: nextAt, delay_sec: delaySec });
}

/** Cancel a scheduled AI reply (called when a human admin replies). */
export async function cancelScheduledAiReply(supabase: Sb, threadId: string): Promise<void> {
  // Only log a 'cancelled' system row if there was actually something pending.
  const { data: t } = await supabase
    .from("sms_threads")
    .select("next_ai_at")
    .eq("id", threadId)
    .maybeSingle();
  if (!t?.next_ai_at) return;
  await supabase
    .from("sms_threads")
    .update({ next_ai_at: null, updated_at: new Date().toISOString() })
    .eq("id", threadId);
  await log(supabase, threadId, "cancelled_human_replied");
}

/**
 * Called from the cron worker. Runs the LLM and sends the reply if all
 * post-delay safety checks still pass. Idempotent — safe to call multiple
 * times for the same thread (it nulls `next_ai_at` once consumed).
 */
export async function runScheduledAiReply(
  supabase: Sb,
  threadId: string,
): Promise<void> {
  const { data: thread } = await supabase
    .from("sms_threads")
    .select("*")
    .eq("id", threadId)
    .maybeSingle();
  if (!thread) return;

  // Idempotency: if next_ai_at was cleared (admin replied), bail.
  if (!thread.next_ai_at) return;

  // Belt-and-suspenders: did a human or another AI reply AFTER the most
  // recent inbound? If so, drop the schedule.
  const { data: lastMsgs } = await supabase
    .from("sms_messages")
    .select("direction, role, status, created_at")
    .eq("thread_id", threadId)
    .in("role", ["customer", "ai", "admin"])
    .order("created_at", { ascending: false })
    .limit(20);
  type Msg = { direction: string; role: string; status: string | null; created_at: string };
  const list = (lastMsgs ?? []) as Msg[];
  const lastInbound = list.find((m) => m.direction === "inbound");
  if (!lastInbound) {
    await supabase.from("sms_threads").update({ next_ai_at: null }).eq("id", threadId);
    return;
  }
  const intervening = list.find(
    (m) =>
      m.direction === "outbound" &&
      (m.role === "admin" || (m.role === "ai" && m.status === "sent")) &&
      new Date(m.created_at).getTime() > new Date(lastInbound.created_at).getTime(),
  );
  if (intervening) {
    await supabase.from("sms_threads").update({ next_ai_at: null }).eq("id", threadId);
    await log(supabase, threadId, "cancelled_human_replied");
    return;
  }

  // Re-check kill switch + mute + pause (could've changed during the wait).
  if ((Deno.env.get("SMS_AI_AUTOREPLY") ?? "on").toLowerCase() === "off") {
    await supabase.from("sms_threads").update({ next_ai_at: null }).eq("id", threadId);
    await log(supabase, threadId, "global_kill_switch");
    return;
  }
  if (thread.bot_muted) {
    await supabase.from("sms_threads").update({ next_ai_at: null }).eq("id", threadId);
    await log(supabase, threadId, "thread_muted");
    return;
  }
  if (
    thread.bot_paused_until &&
    new Date(thread.bot_paused_until).getTime() > Date.now()
  ) {
    await supabase.from("sms_threads").update({ next_ai_at: null }).eq("id", threadId);
    await log(supabase, threadId, "thread_paused");
    return;
  }

  // Load context.
  const { data: ctx } = await supabase
    .from("sms_business_context")
    .select("*")
    .eq("id", 1)
    .maybeSingle();
  if (!ctx) {
    await supabase.from("sms_threads").update({ next_ai_at: null }).eq("id", threadId);
    await log(supabase, threadId, "no_business_context");
    return;
  }
  if (!ctx.auto_send_enabled) {
    await supabase.from("sms_threads").update({ next_ai_at: null }).eq("id", threadId);
    await log(supabase, threadId, "context_auto_send_disabled");
    return;
  }
  if (
    isInQuietHours(new Date(), ctx.timezone, ctx.quiet_hours_start, ctx.quiet_hours_end)
  ) {
    // Don't clear next_ai_at — leave it so the cron picks it up after
    // quiet hours end (it's already overdue, will fire as soon as the
    // window opens).
    await log(supabase, threadId, "quiet_hours");
    return;
  }

  // Per-thread daily rate limit.
  const windowStart = thread.ai_reply_window_started_at
    ? new Date(thread.ai_reply_window_started_at).getTime()
    : 0;
  const ageMs = Date.now() - windowStart;
  let count = thread.ai_reply_count_24h ?? 0;
  let newWindowStart = thread.ai_reply_window_started_at;
  if (ageMs > 24 * 60 * 60 * 1000) {
    count = 0;
    newWindowStart = new Date().toISOString();
  }
  if (count >= ctx.max_ai_replies_per_24h) {
    await supabase.from("sms_threads").update({ next_ai_at: null }).eq("id", threadId);
    await log(supabase, threadId, "rate_limited", { count });
    return;
  }

  // Build chat history.
  const { data: history } = await supabase
    .from("sms_messages")
    .select("direction, role, body, created_at")
    .eq("thread_id", threadId)
    .in("role", ["customer", "ai", "admin"])
    .order("created_at", { ascending: false })
    .limit(20);
  const turns: ChatTurn[] = ((history ?? []) as Array<{
    direction: string;
    role: string;
    body: string | null;
  }>)
    .filter((m) => m.body && m.body.trim())
    .map((m): ChatTurn => ({
      role: m.direction === "inbound" ? "user" : "assistant",
      body: m.body!,
    }))
    .reverse();
  if (turns.length === 0) {
    await supabase.from("sms_threads").update({ next_ai_at: null }).eq("id", threadId);
    return;
  }

  const { count: aiPriorCount } = await supabase
    .from("sms_messages")
    .select("id", { count: "exact", head: true })
    .eq("thread_id", threadId)
    .eq("role", "ai");
  const isFirstReply = (aiPriorCount ?? 0) === 0;

  const result = await draftSmsReply({
    history: turns,
    context: {
      services_md: ctx.services_md ?? "",
      pricing_md: ctx.pricing_md ?? "",
      policy_md: ctx.policy_md ?? "",
      faq_md: ctx.faq_md ?? "",
      greeting: ctx.greeting ?? "Thanks for reaching out!",
    },
    isFirstReply,
  });

  if (!result.ok) {
    await supabase.from("sms_threads").update({ next_ai_at: null }).eq("id", threadId);
    await log(supabase, threadId, "ai_error", { error: result.error });
    return;
  }
  const { draft, meta } = result;

  if (draft.intent === "spam_or_optout") {
    await supabase.from("sms_threads").update({ next_ai_at: null }).eq("id", threadId);
    await supabase.from("sms_messages").insert({
      thread_id: threadId,
      direction: "outbound",
      role: "system",
      body: null,
      ai_meta: { skipped: "spam_or_optout", draft, ...meta },
    });
    return;
  }

  if (!draft.send_now) {
    await supabase.from("sms_threads").update({ next_ai_at: null }).eq("id", threadId);
    await supabase.from("sms_messages").insert({
      thread_id: threadId,
      direction: "outbound",
      role: "ai",
      body: draft.reply,
      status: "draft",
      ai_meta: { ...draft, ...meta, decision: "draft_only" },
    });
    return;
  }

  // Send via Quo.
  const sendRes = await sendQuoSms({
    from: thread.our_number,
    to: thread.customer_number,
    content: draft.reply,
  });
  if (!sendRes.ok) {
    await supabase.from("sms_threads").update({ next_ai_at: null }).eq("id", threadId);
    await supabase.from("sms_messages").insert({
      thread_id: threadId,
      direction: "outbound",
      role: "system",
      body: null,
      ai_meta: { skipped: "quo_send_failed", error: sendRes.error, draft, ...meta },
    });
    return;
  }

  await supabase.from("sms_messages").insert({
    thread_id: threadId,
    direction: "outbound",
    role: "ai",
    body: draft.reply,
    status: "sent",
    ai_meta: { ...draft, ...meta, decision: "auto_send", quo_send_id: sendRes.id },
  });

  await supabase
    .from("sms_threads")
    .update({
      next_ai_at: null,
      ai_reply_count_24h: count + 1,
      ai_reply_window_started_at: newWindowStart,
      last_outbound_at: new Date().toISOString(),
    })
    .eq("id", threadId);
}
