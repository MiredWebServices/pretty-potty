-- Track confirmation + signing-reminder emails so we don't re-send.
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS payment_confirmed_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_sign_reminder_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sign_reminder_count   INTEGER NOT NULL DEFAULT 0;
