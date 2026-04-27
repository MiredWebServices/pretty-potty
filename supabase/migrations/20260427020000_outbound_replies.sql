-- Replies sent from the admin inbox UI via Resend.
CREATE TABLE public.outbound_replies (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  inbound_email_id UUID REFERENCES public.inbound_emails(id) ON DELETE SET NULL,
  resend_email_id TEXT,
  from_address TEXT NOT NULL,
  to_addresses TEXT[] NOT NULL DEFAULT '{}',
  subject TEXT,
  body_text TEXT,
  body_html TEXT,
  in_reply_to TEXT,
  sent_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.outbound_replies ENABLE ROW LEVEL SECURITY;
-- Service role only; edge function handles all reads/writes.

CREATE INDEX idx_outbound_replies_inbound ON public.outbound_replies (inbound_email_id);
CREATE INDEX idx_outbound_replies_created_at ON public.outbound_replies (created_at DESC);
