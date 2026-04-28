// Claude wrapper used by the SMS auto-reply pipeline.
//
// Uses the Anthropic Messages API with tool-use to FORCE structured JSON
// output. The model must call a single tool `draft_sms_reply`; we read its
// arguments verbatim. This is the most reliable way to get well-formed
// objects from Claude (more robust than asking it to print JSON).
//
// Docs: https://docs.anthropic.com/en/api/messages

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

export type SmsIntent =
  | "quote_vague"
  | "quote_specific"
  | "availability_check"
  | "logistics_followup"
  | "existing_customer"
  | "active_job"
  | "spam_or_optout"
  | "unclear";

export interface AiDraft {
  intent: SmsIntent;
  confidence: number;        // 0..1
  reply: string;             // SMS-length, plain text
  send_now: boolean;         // model's own recommendation
  needs_human: boolean;      // true if it should escalate to a human
  reason: string;            // short rationale (for the audit log)
}

export interface ChatTurn {
  role: "user" | "assistant";
  body: string;
}

const SYSTEM_PROMPT = (ctx: {
  services_md: string;
  pricing_md: string;
  policy_md: string;
  faq_md: string;
  greeting: string;
}) => `You are the SMS auto-responder for **Pretty Potty**, a luxury restroom
trailer rental company in Austin & Central Texas. You are texting on behalf
of the owner from the company phone number. The owner reads texts in their
Quo dashboard and will follow up personally.

## Your job

Read the latest customer text plus thread history, then call the
\`draft_sms_reply\` tool with the best next reply.

## Tone & format

- Warm, concise, conversational. **2 sentences max** unless asking for a list.
- No emojis. No marketing fluff.
- Plain text only. No links unless explicitly safe to share.
- Sign-off is NOT needed — the customer already knows it's Pretty Potty.
- Always one short reply at a time. Never write two-message scripts.

## What you MAY do (set send_now = true)

- For a vague inquiry ("how much?", "info please", "interested"), greet
  briefly and ask for the missing details: **city, date(s), type of use
  (event / wedding / construction / other), and approximate guest count**.
  Don't assume it's an event.
- Answer a basic FAQ that's covered in the context below (delivery area,
  what's included, how booking works).
- Acknowledge an availability question with **"let me check our schedule
  and confirm shortly"** — never confirm or deny a date yourself; the owner
  has the calendar.
- Reply politely to "STOP" / opt-out language with a confirmation that they
  won't receive automated messages.

## What you MUST NOT do (set send_now = false, needs_human = true)

- Quote a specific dollar amount.
- Confirm or deny availability for a specific date.
- Discuss an existing invoice, payment, or signed agreement.
- Promise delivery times, addresses, on-site logistics, or anything that
  requires owner judgment.
- **Reply to anyone in active-job mode.** If the message sounds like a
  customer who is at, near, or about to be at, an event/site — examples:
  "are you on your way?", "ETA?", "we're outside", "we're at the venue",
  "what time will you arrive?", "power isn't working", "the trailer
  is...", "the door won't..." — set intent = "active_job", send_now = false,
  needs_human = true. The owner is the only person who can answer this.
- Reply to anything you don't fully understand. When unsure, draft a short
  reply but set \`send_now = false\` so the owner can review.

If the message looks like spam or an automated/2FA/marketing message that
slipped past the upstream filter, set intent = "spam_or_optout",
send_now = false, needs_human = false (silently drop).

## Business context (ground truth — never contradict this)

### Services
${ctx.services_md || "(none provided)"}

### Pricing
${ctx.pricing_md || "(none provided)"}

### Policies & service area
${ctx.policy_md || "(none provided)"}

### FAQ
${ctx.faq_md || "(none provided)"}

### Standard greeting (use for first reply on a thread)
${ctx.greeting}
`;

const TOOL = {
  name: "draft_sms_reply",
  description:
    "Produce the next SMS reply for the customer along with metadata for routing.",
  input_schema: {
    type: "object",
    properties: {
      intent: {
        type: "string",
        enum: [
          "quote_vague",
          "quote_specific",
          "availability_check",
          "logistics_followup",
          "existing_customer",
          "active_job",
          "spam_or_optout",
          "unclear",
        ],
      },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      reply: {
        type: "string",
        description:
          "The SMS body to send. Plain text. 2 sentences max. No links unless safe.",
      },
      send_now: {
        type: "boolean",
        description:
          "True only if it is safe to auto-send without human review per the rules.",
      },
      needs_human: {
        type: "boolean",
        description: "True if a human owner should review/respond to this message.",
      },
      reason: {
        type: "string",
        description: "One short sentence rationale for the audit log.",
      },
    },
    required: ["intent", "confidence", "reply", "send_now", "needs_human", "reason"],
  },
} as const;

export async function draftSmsReply(opts: {
  history: ChatTurn[];
  context: {
    services_md: string;
    pricing_md: string;
    policy_md: string;
    faq_md: string;
    greeting: string;
  };
  isFirstReply: boolean;
}): Promise<{ ok: true; draft: AiDraft; meta: Record<string, unknown> } |
            { ok: false; error: string }> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return { ok: false, error: "ANTHROPIC_API_KEY not configured" };
  const model = Deno.env.get("ANTHROPIC_MODEL") ?? "claude-opus-4-7";

  const messages = opts.history.map((t) => ({
    role: t.role,
    content: t.body,
  }));
  // Force tool use so we always get structured output.
  const body = {
    model,
    max_tokens: 400,
    system: SYSTEM_PROMPT(opts.context) +
      (opts.isFirstReply
        ? "\n\nThis is the FIRST AI reply on this thread — open with the standard greeting before your question."
        : "\n\nThis is a follow-up reply on an ongoing thread — do NOT repeat the greeting."),
    tools: [TOOL],
    tool_choice: { type: "tool", name: TOOL.name },
    messages,
  };

  const r = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    return { ok: false, error: j?.error?.message ?? `HTTP ${r.status}` };
  }

  const block = Array.isArray(j?.content)
    ? j.content.find((b: { type?: string }) => b?.type === "tool_use")
    : null;
  if (!block || typeof block.input !== "object") {
    return { ok: false, error: "Claude did not return tool input" };
  }
  const draft = block.input as AiDraft;
  return {
    ok: true,
    draft,
    meta: {
      model,
      stop_reason: j?.stop_reason,
      usage: j?.usage,
    },
  };
}
