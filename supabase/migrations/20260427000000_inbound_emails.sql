-- Stores inbound emails received via Resend webhooks (email.received).
CREATE TABLE public.inbound_emails (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  resend_email_id TEXT NOT NULL UNIQUE,
  message_id TEXT,
  from_address TEXT NOT NULL,
  to_addresses TEXT[] NOT NULL DEFAULT '{}',
  cc_addresses TEXT[] NOT NULL DEFAULT '{}',
  bcc_addresses TEXT[] NOT NULL DEFAULT '{}',
  subject TEXT,
  text_body TEXT,
  html_body TEXT,
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  raw_event JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at TIMESTAMPTZ
);

ALTER TABLE public.inbound_emails ENABLE ROW LEVEL SECURITY;

-- No public access. Only the service role (used by edge functions) can read/write.

CREATE INDEX idx_inbound_emails_received_at ON public.inbound_emails (received_at DESC);
CREATE INDEX idx_inbound_emails_from_address ON public.inbound_emails (from_address);
