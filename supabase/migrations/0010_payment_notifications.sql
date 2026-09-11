-- Payment emails are side effects of retried webhooks, so they need their own
-- durable idempotency record. The browser may never read or write this table;
-- only the service-key webhook can.
create table if not exists public.payment_notifications (
  id                  uuid primary key default gen_random_uuid(),
  provider            text not null,
  provider_subscription_id text not null,
  provider_payment_id text not null,
  kind                text not null,
  recipient           text not null,
  provider_message_id text,
  created_at          timestamptz not null default now(),
  unique (provider, provider_subscription_id, kind)
);

alter table public.payment_notifications enable row level security;

comment on table public.payment_notifications is
  'Durable idempotency receipts for transactional emails sent from payment webhooks.';
