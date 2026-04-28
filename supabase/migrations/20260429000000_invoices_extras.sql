-- Follow-up to 20260428000000_invoices.sql
--   * Store tax as a percentage (basis points) so admins enter % instead of $.
--   * Allow a per-invoice email subject line so customer-facing copy can be
--     tailored to the event ("Your invoice for Smith wedding 5/4/26") and the
--     internal invoice number stays out of the subject.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS tax_rate_bps   INTEGER,        -- e.g. 825 = 8.25%
  ADD COLUMN IF NOT EXISTS email_subject  TEXT;
