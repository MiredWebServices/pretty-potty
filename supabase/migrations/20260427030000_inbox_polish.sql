-- Gmail-feel polish: archive, full-text search, realtime, RLS read for admins.

-- Archive support.
ALTER TABLE public.inbound_emails
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_inbound_emails_archived_at
  ON public.inbound_emails (archived_at);

-- Full-text search vector across subject + sender + body.
ALTER TABLE public.inbound_emails
  ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(subject, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(from_address, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(text_body, '')), 'C')
  ) STORED;
CREATE INDEX IF NOT EXISTS idx_inbound_emails_search
  ON public.inbound_emails USING gin (search_vector);

-- Allow allowlisted admins to SELECT inbound_emails so the client can use
-- Supabase Realtime directly. Writes still flow through edge functions.
DROP POLICY IF EXISTS "Admins can read inbound emails" ON public.inbound_emails;
CREATE POLICY "Admins can read inbound emails"
ON public.inbound_emails
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE lower(admin_users.email) = lower(auth.jwt() ->> 'email')
  )
);

DROP POLICY IF EXISTS "Admins can read outbound replies" ON public.outbound_replies;
CREATE POLICY "Admins can read outbound replies"
ON public.outbound_replies
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE lower(admin_users.email) = lower(auth.jwt() ->> 'email')
  )
);

-- Add inbound_emails to the realtime publication so client subscriptions
-- get INSERT events when new mail arrives.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'inbound_emails'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.inbound_emails;
  END IF;
END $$;
