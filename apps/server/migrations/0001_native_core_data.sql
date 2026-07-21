-- Native PostgreSQL data plane for lovart.dofe.
-- Authentication is handled by SSO; this database stores only application metadata.
create extension if not exists pgcrypto;

do $$ begin
  create type workspace_type as enum ('personal', 'team');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type workspace_member_role as enum ('owner', 'admin', 'member');
exception when duplicate_object then null;
end $$;

create table if not exists profiles (
  id uuid primary key,
  email text not null,
  display_name text not null check (char_length(btrim(display_name)) > 0),
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists workspaces (
  id uuid primary key default gen_random_uuid(),
  type workspace_type not null,
  name text not null check (char_length(btrim(name)) > 0),
  owner_user_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists workspace_members (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  role workspace_member_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null check (char_length(btrim(name)) > 0),
  slug text not null check (char_length(btrim(slug)) > 0),
  description text,
  brand_kit_id uuid,
  thumbnail_path text,
  created_by uuid references profiles(id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, slug),
  unique (id, workspace_id)
);

create table if not exists canvases (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  name text not null check (char_length(btrim(name)) > 0),
  is_primary boolean not null default false,
  content jsonb not null default '{"elements":[],"appState":{},"files":{}}'::jsonb,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists asset_objects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id uuid,
  bucket text not null check (bucket in ('project-assets', 'user-avatars', 'dofe-system')),
  object_path text not null check (char_length(btrim(object_path)) > 0),
  mime_type text,
  byte_size bigint check (byte_size is null or byte_size >= 0),
  etag text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (bucket, object_path),
  foreign key (project_id, workspace_id)
    references projects (id, workspace_id) on delete cascade
);

create index if not exists profiles_email_idx on profiles (lower(email));
create unique index if not exists workspaces_personal_owner_key
  on workspaces (owner_user_id) where type = 'personal';
create index if not exists workspace_members_user_idx on workspace_members (user_id);
create index if not exists projects_workspace_active_idx on projects (workspace_id, updated_at desc)
  where archived_at is null;
create index if not exists canvases_project_idx on canvases (project_id);
create unique index if not exists canvases_one_primary_per_project_key
  on canvases (project_id) where is_primary;
create index if not exists asset_objects_workspace_idx on asset_objects (workspace_id);
create index if not exists asset_objects_project_idx on asset_objects (project_id);

create or replace function set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on profiles;
create trigger profiles_set_updated_at before update on profiles
for each row execute function set_updated_at();
drop trigger if exists workspaces_set_updated_at on workspaces;
create trigger workspaces_set_updated_at before update on workspaces
for each row execute function set_updated_at();
drop trigger if exists projects_set_updated_at on projects;
create trigger projects_set_updated_at before update on projects
for each row execute function set_updated_at();
drop trigger if exists canvases_set_updated_at on canvases;
create trigger canvases_set_updated_at before update on canvases
for each row execute function set_updated_at();
