-- Allowlist of email addresses that may access the admin inbox.
-- Authentication itself is handled by Supabase Auth (magic-link OTP);
-- this table gates which authenticated users are admins.

CREATE TABLE public.admin_users (
  email TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;

-- Allow any authenticated user to check whether THEIR own email is in the
-- list. They cannot read other rows or modify anything. The edge function
-- uses the service role and bypasses RLS for the actual gate check.
CREATE POLICY "Users can read their own admin row"
ON public.admin_users
FOR SELECT
TO authenticated
USING (lower(email) = lower((auth.jwt() ->> 'email')));

INSERT INTO public.admin_users (email) VALUES
  ('ornelasedward@rocketmail.com'),
  ('mbmckinney98@gmail.com'),
  ('getprettypotty@gmail.com')
ON CONFLICT (email) DO NOTHING;
