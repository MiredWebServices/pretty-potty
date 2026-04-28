# SMS AI auto-reply

When a customer texts the Pretty Potty Quo number, an Edge Function reads
the message, calls Claude, and (if the rules allow) auto-replies. Anything
the AI is not allowed to say is saved as a **draft** for you to send/edit
from `/admin/sms`.

## Pieces

| What                              | Where                                                    |
| --------------------------------- | -------------------------------------------------------- |
| Webhook receiver                  | `supabase/functions/receive-sms/index.ts`                |
| Cron worker (delayed reply)       | `supabase/functions/sms-process-pending/index.ts`        |
| Shared AI pipeline                | `supabase/functions/_shared/ai-pipeline.ts`              |
| Admin actions (mute / send draft) | `supabase/functions/sms-admin/index.ts`                  |
| Claude wrapper (tool-use)         | `supabase/functions/_shared/anthropic.ts`                |
| Quo helpers + HMAC                | `supabase/functions/_shared/sms.ts`                      |
| DB schema                         | `supabase/migrations/20260501000000_sms_inbound.sql` + `20260502000000_sms_delayed_replies.sql` |
| Admin UI                          | `src/pages/AdminSMS.tsx` (route `/admin/sms`)            |

## One-time setup

### 1. Run the migration

```bash
supabase db push
```

### 2. Set Edge Function secrets

In Supabase dashboard → Project settings → Edge Functions → Secrets, or via
CLI:

```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
supabase secrets set ANTHROPIC_MODEL=claude-opus-4-5
supabase secrets set QUO_WEBHOOK_SIGNING_KEY=<base64 from Quo>
supabase secrets set SMS_AI_AUTOREPLY=on
```

`QUO_API_KEY` and `QUO_FROM_NUMBER` should already be set from the invoice
flow.

### 3. Deploy the functions

```bash
supabase functions deploy receive-sms --no-verify-jwt
supabase functions deploy sms-process-pending --no-verify-jwt
supabase functions deploy sms-admin
```

`receive-sms` **must** be `--no-verify-jwt` because Quo hits it without a
Supabase JWT (we verify HMAC). `sms-process-pending` is also
`--no-verify-jwt` because the cron caller authenticates with `CRON_SECRET`.

### 3b. Schedule the cron worker

The bot replies are delayed (default 2 minutes). A cron job needs to fire
the worker every minute. Either approach works:

**Option A — pg_cron (in-database, recommended):**

```sql
select cron.schedule(
  'sms-process-pending',
  '* * * * *',
  $$ select net.http_post(
       url     := 'https://<project-ref>.supabase.co/functions/v1/sms-process-pending',
       headers := jsonb_build_object(
         'Content-Type',   'application/json',
         'Authorization',  'Bearer <CRON_SECRET>'
       )
     ) $$
);
```

**Option B — external scheduler (cron-job.org, GitHub Actions, etc.):**

POST every minute to:
`https://<project-ref>.supabase.co/functions/v1/sms-process-pending`
with header `Authorization: Bearer <CRON_SECRET>`.

### 4. Register the webhook in Quo

1. Quo dashboard → Settings → API → **Webhooks** → New webhook.
2. Events: `message.received` **and** `message.delivered`.
3. URL: `https://<project-ref>.supabase.co/functions/v1/receive-sms`
4. Save, then open the webhook → ⋯ → **Reveal signing secret**.
5. Paste that value into `QUO_WEBHOOK_SIGNING_KEY`.

### 5. Seed business context

Open `/admin/sms` → click **Business context** and fill in:

- **Services** — what you offer (drives intent classification).
- **Pricing** — phrasing the AI may use; it will not quote firm dollar
  amounts.
- **Policy & service area** — service radius, lead time, deposit rules.
- **FAQ** — Q/A pairs the AI may answer directly.
- **Greeting** — the opening line for the FIRST AI reply on a thread.

The defaults are seeded by the migration; edit them to match your voice.

## What the AI will and won't do

| Intent                | Auto-sends?                                              |
| --------------------- | -------------------------------------------------------- |
| `quote_vague`         | ✅ Greeting + asks for city / date / type / guest count  |
| `logistics_followup`  | ✅ FAQ-grounded answer                                   |
| `availability_check`  | ✅ "Let me check our schedule and confirm shortly."     |
| `quote_specific`      | ❌ Saves as draft                                        |
| `existing_customer`   | ❌ Saves as draft                                        |
| `active_job`          | ❌ "We're outside" / "ETA?" / "on your way?" → never autoreply |
| `spam_or_optout`      | ❌ Silently skipped                                      |
| `unclear`             | ❌ Saves as draft                                        |

## Pre-LLM filters (run before Claude is even called)

These short-circuit the pipeline and never spend a token:

1. **Short-code sender** — any `from` with fewer than 10 digits (e.g.
   `34567`) is a bank, airline, or 2FA service. Logged as
   `automated_noise: shortcode_sender`.
2. **OTP / 2FA / marketing keywords** — regex match on phrases like
   "verification code", "your code is", "do not reply",
   "msg & data rates may apply", "reply STOP". Logged as
   `automated_noise: <kind>`.
3. **Active customer** — if this phone has a paid invoice in the last
   **14 days**, treat them as an in-progress job. Anything they text
   ("are you on your way?", "we're outside", "the door won't lock") goes
   straight to you, not the AI. Logged as `automated_noise: active_customer`
   with the invoice id.

The inbound message is still stored on the thread so you see it in
`/admin/sms` and on Quo — only the AI reply is suppressed.

## Guardrails

- **Reply delay**: every inbound is *scheduled* (default 120s). You have
  that window to text from Quo first — if you do, the pending AI reply is
  silently cancelled. Tunable in business context (`Auto-reply delay`).
- **Cancel pending**: if a thread shows `AI in 47s`, click **Cancel
  pending AI** in the thread header to drop it manually.
- **Per-thread mute**: toggle the Bot switch in `/admin/sms`.
- **Auto-pause on human reply**: when *you* reply from the Quo dashboard,
  the bot pauses on that thread for 24h *and* clears any pending AI reply.
  Click **Resume bot** to override.
- **Quiet hours**: defaults 9 PM – 8 AM CT. Edit in business-context.
- **Rate limit**: max 2 AI replies per phone number per 24h.
- **Global kill switch**: set `SMS_AI_AUTOREPLY=off` and redeploy /
  hot-reload secrets.

## Audit trail

Every AI decision (sent, drafted, skipped) writes a row to `sms_messages`.
System rows (skipped reasons) have `role = 'system'` and a `body = null`,
with the reason in `ai_meta.skipped`. Real replies live alongside as
`role = 'ai'`.

When `message.delivered` arrives from Quo for an AI message we just sent,
the receiver links it to the existing `sms_messages` row by matching the
body within a 5 minute window, then stamps `quo_message_id` on the row.

## Future: real availability

Right now the AI only acknowledges date questions ("let me check…"). To
answer authoritatively, add a `bookings(start_date, end_date, units)`
table and let the AI call a tool to look it up. The system prompt in
`_shared/anthropic.ts` already lists "availability_check" as an intent —
swap the canned reply for a DB lookup when the table exists.
