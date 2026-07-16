-- Product-visible run metadata is owned by lovart PostgreSQL. LangGraph
-- checkpoint/state tables remain isolated in the `langgraph` schema.
create table if not exists agent_runs (
  id uuid primary key,
  session_id uuid not null references chat_sessions(id) on delete cascade,
  thread_id text not null,
  model text,
  status text not null check (status in ('accepted', 'running', 'completed', 'failed')),
  error_code text,
  error_message text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agent_runs_session_created_idx
  on agent_runs (session_id, created_at desc);

drop trigger if exists agent_runs_set_updated_at on agent_runs;
create trigger agent_runs_set_updated_at before update on agent_runs
for each row execute function set_updated_at();
