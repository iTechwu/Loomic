-- The local design profile id is not the Models identity. Keep the SSO subject
-- used at Models so retries always target the same tenant/team/user owner.
alter table user_credentials
  add column if not exists sso_user_id uuid;

create index if not exists user_credentials_sso_subject_idx
  on user_credentials (sso_user_id);
