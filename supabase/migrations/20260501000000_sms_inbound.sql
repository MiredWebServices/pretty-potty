-- Inbound SMS pipeline + AI auto-reply scaffolding.
--
-- Threads keyed by (our number, customer number). Messages store both
-- inbound (from customer) and outbound (from us / from AI). A single-row
-- `sms_business_context` table feeds the LLM with services + pricing
-- knowledge so it does not hallucinate.

-- ---------- threads ----------
CREATE TABLE IF NOT EXISTS public.sms_threads (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  our_number      TEXT NOT NULL,
  customer_number TEXT NOT NULL,
  -- Quo's conversation id (when present) for cross-reference.
  quo_conversation_id TEXT,
  display_name    TEXT,
  -- When set in the future, AI will not auto-reply on this thread.
  bot_muted       BOOLEAN NOT NULL DEFAULT FALSE,
  -- Auto-paused timestamp: e.g. set 24h after a human admin reply from Quo.
  bot_paused_until TIMESTAMPTZ,
  last_inbound_at  TIMESTAMPTZ,
  last_outbound_at TIMESTAMPTZ,
  ai_reply_count_24h INTEGER NOT NULL DEFAULT 0,
  ai_reply_window_started_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (our_number, customer_number)
);

CREATE INDEX IF NOT EXISTS idx_sms_threads_last_inbound
  ON public.sms_threads (last_inbound_at DESC NULLS LAST);

-- ---------- messages ----------
CREATE TABLE IF NOT EXISTS public.sms_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id   UUID NOT NULL REFERENCES public.sms_threads(id) ON DELETE CASCADE,
  -- 'inbound' = from customer; 'outbound' = from us.
  direction   TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  -- 'customer' | 'ai' | 'admin' | 'system'
  role        TEXT NOT NULL CHECK (role IN ('customer', 'ai', 'admin', 'system')),
  body        TEXT,
  -- Quo/OpenPhone message id (AC...) for de-duplication.
  quo_message_id TEXT UNIQUE,
  status      TEXT,
  -- LLM metadata: { intent, confidence, model, reason, send_now, prompt_tokens, ... }
  ai_meta     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sms_messages_thread_created
  ON public.sms_messages (thread_id, created_at);

-- ---------- business context (single row, id = 1) ----------
CREATE TABLE IF NOT EXISTS public.sms_business_context (
  id              SMALLINT PRIMARY KEY DEFAULT 1,
  services_md     TEXT NOT NULL DEFAULT '',
  pricing_md      TEXT NOT NULL DEFAULT '',
  policy_md       TEXT NOT NULL DEFAULT '',
  faq_md          TEXT NOT NULL DEFAULT '',
  greeting        TEXT NOT NULL DEFAULT 'Thanks for reaching out to Pretty Potty!',
  -- Local timezone used for quiet-hours math. IANA name.
  timezone        TEXT NOT NULL DEFAULT 'America/Chicago',
  quiet_hours_start SMALLINT NOT NULL DEFAULT 21, -- 9 PM
  quiet_hours_end   SMALLINT NOT NULL DEFAULT 8,  -- 8 AM
  max_ai_replies_per_24h SMALLINT NOT NULL DEFAULT 2,
  auto_send_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sms_business_context_singleton CHECK (id = 1)
);

INSERT INTO public.sms_business_context (id, services_md, pricing_md, policy_md, faq_md)
VALUES (1,
'Pretty Potty rents luxury restroom trailers in Austin & Central Texas for weddings, private events, and construction sites.',
'Pricing depends on event size, # of days, and location. Typical wedding trailer rental starts around $1,800 for a weekend. We do not quote firm prices over text without event details.',
'We service Austin and surrounding Central Texas (Hill Country, San Antonio, Waco). Standard delivery window is 24-72h before the event. A signed agreement and deposit are required to lock a date.',
'')
ON CONFLICT (id) DO NOTHING;

-- ---------- RLS ----------
ALTER TABLE public.sms_threads          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sms_messages         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sms_business_context ENABLE ROW LEVEL SECURITY;

-- Admin read access (writes go through edge functions w/ service role).
DROP POLICY IF EXISTS "Admins read sms_threads" ON public.sms_threads;
CREATE POLICY "Admins read sms_threads"
ON public.sms_threads FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.admin_users
  WHERE lower(admin_users.email) = lower(auth.jwt() ->> 'email')
));

DROP POLICY IF EXISTS "Admins read sms_messages" ON public.sms_messages;
CREATE POLICY "Admins read sms_messages"
ON public.sms_messages FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.admin_users
  WHERE lower(admin_users.email) = lower(auth.jwt() ->> 'email')
));

DROP POLICY IF EXISTS "Admins read sms_business_context" ON public.sms_business_context;
CREATE POLICY "Admins read sms_business_context"
ON public.sms_business_context FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.admin_users
  WHERE lower(admin_users.email) = lower(auth.jwt() ->> 'email')
));

-- Realtime publication so AdminSMS gets live updates.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'sms_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.sms_messages;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'sms_threads'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.sms_threads;
  END IF;
END $$;
