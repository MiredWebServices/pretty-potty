-- Delayed-reply support for SMS auto-reply.
--
-- Instead of calling Claude inline from the webhook, we now SCHEDULE the
-- AI reply for `now() + delay`. A cron-driven worker (`sms-process-pending`)
-- runs every minute and processes any thread whose `next_ai_at` is due.
--
-- This gives the human owner a buffer (default 2 min) to jump in from the
-- Quo dashboard before the bot responds. Any manual reply during that
-- window cancels the pending AI reply automatically.

ALTER TABLE public.sms_threads
  ADD COLUMN IF NOT EXISTS next_ai_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ai_reply_delay_seconds INTEGER; -- per-thread override, NULL = use global

CREATE INDEX IF NOT EXISTS idx_sms_threads_next_ai_at
  ON public.sms_threads (next_ai_at)
  WHERE next_ai_at IS NOT NULL;

ALTER TABLE public.sms_business_context
  ADD COLUMN IF NOT EXISTS ai_reply_delay_seconds INTEGER NOT NULL DEFAULT 120;
