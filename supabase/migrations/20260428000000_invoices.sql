-- Hosted invoicing + e-signature system.
--
-- Flow:
--   1. Admin creates an invoice with line items (and optional document to sign).
--      A Stripe Payment Link is generated and a public_token issued.
--   2. Customer opens https://getprettypotty.com/i/<public_token>, views invoice,
--      pays via Stripe. Stripe webhook flips status -> 'paid'.
--   3. If the invoice has an attached document, customer is redirected to
--      /i/<public_token>/sign to sign it. Signature image + audit data stored.
--   4. invoice-reminders cron nudges unpaid invoices at +1d, +2d, +3d.
--
-- All public access happens through edge functions using the public_token;
-- RLS denies direct anon reads.

CREATE TYPE invoice_status AS ENUM (
  'draft',     -- created but not sent
  'sent',      -- sent to customer, awaiting payment
  'viewed',    -- customer opened the public link
  'paid',      -- Stripe webhook confirmed payment
  'signed',    -- (if document attached) customer also signed
  'void',      -- cancelled by admin
  'overdue'    -- past due_date and unpaid (set by cron)
);

CREATE TABLE public.invoices (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Customer
  customer_name  TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  customer_phone TEXT, -- E.164, e.g. +15125551234

  -- Money (stored in cents to avoid float issues)
  subtotal_cents  INTEGER NOT NULL DEFAULT 0,
  tax_cents       INTEGER NOT NULL DEFAULT 0,
  total_cents     INTEGER NOT NULL DEFAULT 0,
  currency        TEXT NOT NULL DEFAULT 'usd',

  -- Status / lifecycle
  status     invoice_status NOT NULL DEFAULT 'draft',
  issued_at  TIMESTAMPTZ,         -- when "sent" first happened
  due_at     TIMESTAMPTZ,         -- payment due date
  paid_at    TIMESTAMPTZ,
  voided_at  TIMESTAMPTZ,

  -- Public access token (random, unguessable). Used in /i/<token> URLs.
  public_token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),

  -- Stripe
  stripe_payment_link_id  TEXT,
  stripe_payment_link_url TEXT,
  stripe_session_id       TEXT,
  stripe_payment_intent   TEXT,

  -- Reminders cadence tracking
  last_reminder_at      TIMESTAMPTZ,
  reminder_count        INTEGER NOT NULL DEFAULT 0,

  -- Notes shown to customer; internal_notes are admin-only
  customer_notes TEXT,
  internal_notes TEXT,

  invoice_number TEXT UNIQUE,  -- human-friendly, e.g. PP-2026-0001
  created_by     TEXT,          -- admin email
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_invoices_status ON public.invoices (status);
CREATE INDEX idx_invoices_public_token ON public.invoices (public_token);
CREATE INDEX idx_invoices_customer_email ON public.invoices (customer_email);
CREATE INDEX idx_invoices_due_at ON public.invoices (due_at);

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
-- No public policies: all access goes through edge functions w/ service role.


CREATE TABLE public.invoice_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL,
  quantity NUMERIC(12,2) NOT NULL DEFAULT 1,
  unit_price_cents INTEGER NOT NULL DEFAULT 0,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_invoice_items_invoice_id ON public.invoice_items (invoice_id);
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;


-- A document to be signed after payment (e.g. service agreement, waiver).
-- One document per invoice for v1; can be promoted to many later.
CREATE TABLE public.invoice_documents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_id UUID NOT NULL UNIQUE REFERENCES public.invoices(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content_html TEXT NOT NULL,    -- the agreement body, rendered as HTML
  required_after_payment BOOLEAN NOT NULL DEFAULT TRUE,

  -- Signature (filled in when customer signs)
  signed_at         TIMESTAMPTZ,
  signer_name       TEXT,
  signer_email      TEXT,
  signature_data_url TEXT,        -- PNG dataURL from canvas
  signer_ip         TEXT,
  signer_user_agent TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_invoice_documents_invoice_id ON public.invoice_documents (invoice_id);
ALTER TABLE public.invoice_documents ENABLE ROW LEVEL SECURITY;


-- Audit trail: every meaningful event for an invoice.
CREATE TABLE public.invoice_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  type TEXT NOT NULL, -- created | sent | viewed | reminded | paid | signed | voided
  channel TEXT,       -- email | sms | stripe | web
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_invoice_events_invoice_id ON public.invoice_events (invoice_id, occurred_at DESC);
ALTER TABLE public.invoice_events ENABLE ROW LEVEL SECURITY;


-- ---------------------------------------------------------------------------
-- Updated-at trigger
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_invoices_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE TRIGGER trg_invoices_updated_at
BEFORE UPDATE ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.tg_invoices_updated_at();


-- ---------------------------------------------------------------------------
-- Auto-generated invoice number (PP-<year>-<seq>)
-- ---------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.invoice_number_seq START 1;

CREATE OR REPLACE FUNCTION public.tg_invoices_set_number()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.invoice_number IS NULL THEN
    NEW.invoice_number := 'PP-'
      || to_char(now(), 'YYYY') || '-'
      || lpad(nextval('public.invoice_number_seq')::text, 4, '0');
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_invoices_set_number
BEFORE INSERT ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.tg_invoices_set_number();


-- ---------------------------------------------------------------------------
-- Daily reminder cron (handled inside the edge fn, but we still mark overdue
-- invoices in the DB via cron for redundancy).
--
-- pg_cron must be enabled by Supabase; if it isn't, this section is a no-op.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'invoices-mark-overdue',
      '0 9 * * *', -- every day at 09:00 UTC
      $cron$
        UPDATE public.invoices
        SET status = 'overdue'
        WHERE status IN ('sent','viewed')
          AND due_at IS NOT NULL
          AND due_at < now();
      $cron$
    );
  END IF;
END $$;
