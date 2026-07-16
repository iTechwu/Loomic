-- Billing and payment state belongs to models.dofe.ai. Keep lovart's database
-- limited to product metadata, including chat and background-job state.
drop trigger if exists workspaces_initialize_credits on workspaces;
drop function if exists initialize_workspace_credits();

drop table if exists daily_credit_claims;
drop table if exists credit_transactions;
drop table if exists credit_balances;
drop table if exists subscriptions;

alter table if exists background_jobs
  drop column if exists credits_transaction_id,
  drop column if exists credits_cost;

-- 0005_payment_lifecycle.sql existed in earlier local installations. These
-- statements are intentionally idempotent so both old and fresh databases end
-- with the same metadata-only schema.
drop table if exists payment_events;
alter table if exists subscriptions
  drop column if exists lemon_squeezy_subscription_id,
  drop column if exists lemon_squeezy_customer_id;
drop index if exists subscriptions_lemon_squeezy_subscription_id_key;
