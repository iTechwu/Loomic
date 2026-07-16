-- SSO identity migration
--
-- Maps an externally authenticated SSO subject to the existing Supabase data
-- principal. This preserves all foreign-keyed projects, workspaces, credits,
-- and assets for legacy accounts without rewriting their IDs.

create table if not exists public.sso_user_mappings (
  sso_user_id uuid primary key,
  data_user_id uuid not null references auth.users(id) on delete restrict,
  matched_email text not null,
  mapping_source text not null check (mapping_source in ('legacy_email_match', 'new_sso_user')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (data_user_id)
);

create index if not exists sso_user_mappings_matched_email_idx
  on public.sso_user_mappings (lower(matched_email));

drop trigger if exists sso_user_mappings_set_updated_at on public.sso_user_mappings;
create trigger sso_user_mappings_set_updated_at
before update on public.sso_user_mappings
for each row
execute function public.set_updated_at();

alter table public.sso_user_mappings enable row level security;

-- No browser policies: mappings are authentication infrastructure and are
-- accessed only by the server's service-role client.
