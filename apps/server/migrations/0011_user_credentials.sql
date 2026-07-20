-- Per-user models.dofe.ai credentials (design apikey + seedance asset AK/SK).
--
-- Each lovart user gets their own design apikey (user+team scoped) and seedance
-- asset AK/SK (team scoped), provisioned via models' POST /internal/seedance/credentials.
-- Model calls then authenticate with the user's own key instead of the shared
-- DOFE_MODEL_API_KEY, so usage is billed and isolated per user.
--
-- See apps/server/src/features/credentials/* for provisioning + resolution logic.
create table if not exists user_credentials (
  id uuid primary key default gen_random_uuid(),
  -- profiles.id (= sso_user_mappings.data_user_id). No foreign key: rows are written
  -- during OIDC session creation, before the profile row is guaranteed to exist —
  -- the same one-time-lookup pattern used by sso_user_mappings.data_user_id.
  user_id uuid not null,
  -- SSO team uuid; the asset AK/SK are team-scoped on the models side.
  sso_team_id uuid not null,
  -- models-side gateway_user_api_key row id (kept for future rotation / revocation).
  -- Nullable: only populated once provision_state reaches 'ready'.
  models_api_key_id uuid,
  models_key_prefix text,
  -- Design apikey plaintext (sk-...). AES-256-GCM encrypted when
  -- LOVART_CREDENTIAL_ENCRYPTION_KEY is configured; otherwise a plaintext fallback.
  apikey_ciphertext text,
  -- models-side tenant_asset_credential row id.
  models_credential_id uuid,
  access_key_id text,
  secret_access_key_ciphertext text,
  -- Lifecycle: 'ready' (usable), 'provisioning' (in-flight, guards concurrency),
  -- 'failed' (last attempt errored; retried on next ensureViewer).
  provision_state text not null check (provision_state in ('ready', 'provisioning', 'failed'))
    default 'ready',
  last_provision_error text,
  provisioned_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One credential per (user, team); re-provision rotates by delete + insert.
  unique (user_id, sso_team_id)
);

create index if not exists user_credentials_user_idx on user_credentials(user_id);
create index if not exists user_credentials_user_state_idx on user_credentials(user_id, provision_state);

drop trigger if exists user_credentials_set_updated_at on user_credentials;
create trigger user_credentials_set_updated_at before update on user_credentials
for each row execute function set_updated_at();
