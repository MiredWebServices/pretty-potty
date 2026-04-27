# Hosted Invoicing & E-Signature

End-to-end flow for sending invoices, taking payment, and collecting an
e-signature on a service agreement — all on getprettypotty.com, no SaaS fees.

## Architecture

```
Admin UI (/admin/invoices)
   └─> create-invoice  ──> Stripe (Product, Price, Payment Link)
                       └─> Supabase tables: invoices, invoice_items, invoice_documents

Admin clicks "Send"
   └─> send-invoice    ──> Resend (email) + Quo/OpenPhone (SMS)
                            payload contains hosted-invoice link /i/<public_token>

Customer opens /i/<public_token>
   └─> public-invoice (GET)   ──> renders invoice + items + doc
   └─> "Pay with Stripe"      ──> Stripe-hosted Payment Link
   └─> Stripe redirect back   ──> ?paid=1, page polls until webhook confirms

Stripe → stripe-webhook
   └─> sets invoice.status = 'paid', logs invoice_events row

After payment, if a document is attached, customer signs in-page (HTML5 canvas).
   └─> public-invoice (POST sign) ──> stores signature dataURL + IP/UA
                                       sets invoice.status = 'signed'

Daily cron → invoice-reminders
   └─> nudges unpaid invoices at +1d, +3d, +7d via email + SMS
```

## Required env vars (Supabase Dashboard → Functions → Secrets)

| Name | Where used | Notes |
| --- | --- | --- |
| `RESEND_API_KEY` | send-invoice, invoice-reminders | already set |
| `STRIPE_SECRET_KEY` | create-invoice | starts with `sk_live_` (or `sk_test_`) |
| `STRIPE_WEBHOOK_SECRET` | stripe-webhook | from Stripe Dashboard → Webhooks |
| `QUO_API_KEY` (or `OPENPHONE_API_KEY`) | send-invoice, invoice-reminders | from quo.com Settings → API |
| `QUO_FROM_NUMBER` (or `OPENPHONE_FROM_NUMBER`) | send-invoice, invoice-reminders | E.164, e.g. `+15125551234` |
| `CRON_SECRET` | invoice-reminders | any random string; used by cron caller |
| `PUBLIC_SITE_URL` | create-invoice, send-invoice, invoice-reminders | defaults to `https://getprettypotty.com` |

## Stripe setup

1. Create a Stripe account, complete onboarding (bank info etc.).
2. **Dashboard → Developers → API keys** — copy *Secret key*, set `STRIPE_SECRET_KEY` in Supabase.
3. **Dashboard → Developers → Webhooks → Add endpoint**
   - URL: `https://whvuohkpbcpytmwnhriy.supabase.co/functions/v1/stripe-webhook`
   - Events: `checkout.session.completed`, `payment_intent.succeeded`
   - Copy the *Signing secret*, set `STRIPE_WEBHOOK_SECRET` in Supabase.

## Quo / OpenPhone setup

1. Visit https://www.quo.com/docs/mdx/api-reference/authentication to mint an API key.
   Note: API access requires the Business plan (or above).
2. Set `QUO_API_KEY` to the key, `QUO_FROM_NUMBER` to your Quo number in E.164.
3. Make sure 10DLC registration is complete (Quo guides you through it).

## Cron schedule (reminders)

Use Supabase **Database → Cron** to POST `/functions/v1/invoice-reminders` every day at 9am local:

```sql
select cron.schedule(
  'invoice-reminders-daily',
  '0 14 * * *',  -- 14:00 UTC = 9:00 AM Central
  $$
    select net.http_post(
      url := 'https://whvuohkpbcpytmwnhriy.supabase.co/functions/v1/invoice-reminders',
      headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.cron_secret'))
    );
  $$
);
```

(Set `app.cron_secret` to match `CRON_SECRET`, or hard-code the value.)

The reminder cadence is `1 day`, `3 days`, `7 days` after `issued_at`, max 3 reminders.

## Deploying functions

```sh
supabase functions deploy create-invoice
supabase functions deploy send-invoice
supabase functions deploy list-invoices
supabase functions deploy public-invoice
supabase functions deploy stripe-webhook
supabase functions deploy invoice-reminders
```

## Routes

- `/admin/invoices` — admin list/manage
- `/admin/invoices/new` — create new invoice
- `/i/:token` — public hosted invoice page (view, pay, sign)

## Tables

- `invoices` — header data, status, totals, public_token, Stripe IDs
- `invoice_items` — line items
- `invoice_documents` — agreement to sign + signature data + audit trail
- `invoice_events` — full audit log (created/sent/viewed/reminded/paid/signed)

All tables have RLS enabled; access is via service-role edge functions only.

## Security model

- Admin endpoints (`create-invoice`, `send-invoice`, `list-invoices`) require a
  Supabase JWT whose email is in `admin_users`.
- `public-invoice` is anon-accessible but gated by a 24-byte random
  `public_token` per invoice (~10^57 entropy — unguessable).
- `stripe-webhook` verifies the Stripe signature header.
- `invoice-reminders` requires `CRON_SECRET` shared secret.
- Customer-facing JSON never includes `internal_notes`, admin emails, or
  `stripe_payment_intent`.

## Cost summary

- Supabase: free tier (DB + functions + cron + storage)
- Resend: free tier (3,000 emails/mo)
- Quo: included in your existing OpenPhone/Quo Business subscription
- Stripe: 2.9% + 30¢ per successful transaction. No monthly fee.
