-- Permanent bridge from SSO subjects to pre-existing application profiles.
-- New users map to their SSO UUID; a unique email match preserves legacy data.
create table if not exists sso_user_mappings (
  sso_user_id uuid primary key,
  -- The first verified request creates the local profile, so this cannot be a
  -- foreign key during subject resolution.
  data_user_id uuid not null,
  mapping_source text not null check (mapping_source in ('legacy_email_match', 'new_sso_user')),
  matched_email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sso_user_mappings_data_user_idx on sso_user_mappings(data_user_id);
drop trigger if exists sso_user_mappings_set_updated_at on sso_user_mappings;
create trigger sso_user_mappings_set_updated_at before update on sso_user_mappings
for each row execute function set_updated_at();
