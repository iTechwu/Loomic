-- Tracking columns for the provisioning state machine used by
-- CredentialsService.ensureProvisioned to prevent duplicate calls to models'
-- non-idempotent POST /internal/seedance/credentials endpoint.
alter table user_credentials
  add column if not exists provisioning_started_at timestamptz,
  add column if not exists provision_attempt_count integer not null default 0;
