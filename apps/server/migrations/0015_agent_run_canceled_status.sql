-- Allow agent_runs.status to record runs that were stopped by the user.
-- We use a separate migration rather than editing 0008_agent_run_metadata.sql
-- so existing deployments pick up the change automatically.
alter table agent_runs drop constraint if exists agent_runs_status_check;
alter table agent_runs add constraint agent_runs_status_check
  check (status in ('accepted', 'running', 'completed', 'failed', 'canceled'));
