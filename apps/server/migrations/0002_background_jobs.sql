-- Product-visible job state remains in PostgreSQL; RabbitMQ provides delivery.
create table if not exists background_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id uuid references projects(id) on delete set null,
  canvas_id uuid references canvases(id) on delete set null,
  session_id uuid,
  thread_id text,
  queue_name text not null,
  job_type text not null check (job_type in ('image_generation', 'video_generation')),
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed', 'canceled', 'dead_letter')),
  payload jsonb not null default '{}'::jsonb,
  result jsonb,
  error_code text,
  error_message text,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 3 check (max_attempts > 0),
  credits_transaction_id uuid,
  credits_cost integer check (credits_cost is null or credits_cost >= 0),
  created_by uuid not null references profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  canceled_at timestamptz
);

create index if not exists background_jobs_owner_created_idx
  on background_jobs (created_by, created_at desc);
create index if not exists background_jobs_worker_poll_idx
  on background_jobs (status, job_type, updated_at);
create index if not exists background_jobs_workspace_idx on background_jobs (workspace_id);

drop trigger if exists background_jobs_set_updated_at on background_jobs;
create trigger background_jobs_set_updated_at before update on background_jobs
for each row execute function set_updated_at();
