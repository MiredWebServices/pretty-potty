# Inbound Email Setup (Resend)

Inbound mail to `getprettypotty.com` (e.g. `hello@`, `support@`) is received by
Resend, posted to a Supabase edge function, stored in the `inbound_emails`
table, and viewable at `/admin/inbox`.

No Gmail involvement. No Google Workspace fees.

## Architecture

```
Sender → Resend MX → Resend webhook (email.received)
                       ↓
            POST /functions/v1/receive-email
                       ↓
   Fetch full email body via Resend API
                       ↓
       INSERT INTO public.inbound_emails
                       ↓
   /admin/inbox (gated by Supabase Auth + admin_users allowlist)
```

## One-time setup

### 1. DNS (custom receiving domain)

In your DNS provider for `getprettypotty.com`, add the **MX records** Resend
provides under **Domains → Receiving** in the Resend dashboard. Heads up: MX
records on the *root* domain may conflict with any existing mail provider
(Workspace, Cloudflare, etc.). If you also need to keep the existing sending
DKIM/SPF, leave those untouched — only the MX records affect inbound delivery.

You can also use a subdomain like `inbox.getprettypotty.com` to avoid
disturbing root-domain mail.

### 2. Apply DB migration

```bash
supabase db push
```

### 3. Deploy edge functions

```bash
supabase functions deploy receive-email
supabase functions deploy list-inbound-emails
supabase functions deploy send-admin-reply
```

### 4. Set secrets

```bash
supabase secrets set RESEND_API_KEY=re_...
supabase secrets set RESEND_WEBHOOK_SECRET=whsec_...   # from Resend webhook page
# Optional: override notification recipient (default: support@getprettypotty.com)
supabase secrets set NOTIFY_TO_EMAIL=support@getprettypotty.com
```

Admin access is via Supabase Auth (email + password). Allowed emails live in
`public.admin_users` — seed migration adds:

- `ornelasedward@rocketmail.com`
- `mbmckinney98@gmail.com`
- `getprettypotty@gmail.com`

To add/remove admins later, just `INSERT`/`DELETE` from that table in the
Supabase SQL editor.

### Creating the auth users (one-time per admin)

Supabase Auth doesn't auto-create users from the allowlist; each admin's
auth account must exist before they can sign in. Two options:

**Option A — Self-serve via "Forgot password" (recommended).** In the Supabase
dashboard, go to **Authentication → Users → Add user** and create each user
with their email; you can leave a placeholder password. Each admin then visits
`/admin/inbox`, clicks **"Forgot password / set initial password"**, gets a
reset email, and chooses their real password.

**Option B — Set passwords directly.** In **Authentication → Users → Add user**,
type each email and set a password yourself, then share it with the admin.

### Supabase Auth settings

In **Authentication → URL Configuration**, add `https://yourdomain.com/admin/inbox`
(and `http://localhost:5173/admin/inbox` for dev) to the **Redirect URLs**
allowlist so password-reset emails can return to the inbox page.

You can also disable **"Allow new users to sign up"** in Auth settings to
prevent random self-signup; admin accounts are created from the dashboard
either way.

### 5. Configure Resend webhook

In the Resend dashboard:

1. **Webhooks → Add Webhook**
2. URL: `https://<project-ref>.supabase.co/functions/v1/receive-email`
3. Event types: `email.received`
4. Save. Copy the signing secret into `RESEND_WEBHOOK_SECRET` (step 4 above) and
   redeploy `receive-email` if you set it after deploy.

### 6. Test

Send an email to `hello@getprettypotty.com` (or the address Resend assigned).
It should appear at `/admin/inbox` within seconds.

## Operational notes

- **Replies**: built in. Each open email in `/admin/inbox` has a composer that
  sends via the `send-admin-reply` edge function. Outbound goes from
  `hello@getprettypotty.com` with `In-Reply-To` / `References` headers so most
  clients (Gmail, Apple Mail) thread the reply with the original. Sent replies
  are logged to `public.outbound_replies`.
- **Attachments**: metadata is stored; binary content is not. Download via the
  Resend dashboard or the Attachments API.
- **Signature verification**: enforced when `RESEND_WEBHOOK_SECRET` is set.
  If unset, the function logs a warning and accepts unsigned requests — only
  acceptable for local dev.
- **Admin auth**: `/admin/inbox` uses Supabase email+password auth gated by the
  `public.admin_users` allowlist. Even if a non-allowlisted user has an auth
  account, the API returns 403. Manage allowlist by editing the table directly;
  manage auth accounts in the Supabase dashboard.
