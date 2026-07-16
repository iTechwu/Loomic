create table if not exists subscriptions (
  workspace_id uuid primary key references workspaces(id) on delete cascade,
  plan text not null default 'free' check (plan in ('free', 'starter', 'pro', 'ultra', 'business')),
  billing_period text check (billing_period in ('monthly', 'yearly')),
  stripe_customer_id text,
  stripe_subscription_id text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  canceled_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists credit_balances (
  workspace_id uuid primary key references workspaces(id) on delete cascade,
  balance integer not null default 0 check (balance >= 0), version integer not null default 0,
  updated_at timestamptz not null default now()
);
create table if not exists credit_transactions (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid references profiles(id) on delete set null,
  transaction_type text not null check (transaction_type in ('subscription_grant', 'daily_grant', 'purchase', 'generation_deduct', 'generation_refund', 'admin_adjustment', 'bonus')),
  amount integer not null, balance_after integer not null check (balance_after >= 0), job_id uuid references background_jobs(id) on delete set null,
  description text, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create index if not exists credit_transactions_workspace_created_idx on credit_transactions (workspace_id, created_at desc);
create unique index if not exists credit_transactions_refund_once_idx on credit_transactions (job_id) where transaction_type = 'generation_refund';
create table if not exists daily_credit_claims (
  workspace_id uuid not null references workspaces(id) on delete cascade, claim_date date not null default current_date,
  amount integer not null check (amount >= 0), created_at timestamptz not null default now(), primary key (workspace_id, claim_date)
);
create table if not exists chat_sessions (
  id uuid primary key default gen_random_uuid(), canvas_id uuid not null references canvases(id) on delete cascade,
  title text not null default 'New Chat', thread_id text unique, created_by uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists chat_sessions_canvas_updated_idx on chat_sessions (canvas_id, updated_at desc);
create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(), session_id uuid not null references chat_sessions(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')), content text not null default '', tool_activities jsonb,
  content_blocks jsonb, created_at timestamptz not null default now()
);
create index if not exists chat_messages_session_created_idx on chat_messages (session_id, created_at);
drop trigger if exists subscriptions_set_updated_at on subscriptions;
create trigger subscriptions_set_updated_at before update on subscriptions for each row execute function set_updated_at();
drop trigger if exists chat_sessions_set_updated_at on chat_sessions;
create trigger chat_sessions_set_updated_at before update on chat_sessions for each row execute function set_updated_at();
insert into subscriptions (workspace_id, plan) select id, 'free' from workspaces on conflict do nothing;
insert into credit_balances (workspace_id, balance) select id, 0 from workspaces on conflict do nothing;
