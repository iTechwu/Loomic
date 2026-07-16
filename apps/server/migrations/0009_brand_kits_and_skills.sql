create table if not exists brand_kits (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null check (char_length(btrim(name)) > 0),
  is_default boolean not null default false,
  guidance_text text,
  cover_path text,
  created_by uuid not null references profiles(id) on delete restrict,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists brand_kits_default_workspace_key on brand_kits(workspace_id) where is_default;
create index if not exists brand_kits_workspace_updated_idx on brand_kits(workspace_id, updated_at desc);

create table if not exists brand_kit_assets (
  id uuid primary key default gen_random_uuid(),
  kit_id uuid not null references brand_kits(id) on delete cascade,
  asset_type text not null check (asset_type in ('color','font','logo','image')),
  display_name text not null, role text, sort_order integer not null default 0,
  text_content text, object_path text, metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists brand_kit_assets_kit_order_idx on brand_kit_assets(kit_id, sort_order, created_at);

create table if not exists skills (
  id uuid primary key default gen_random_uuid(), name text not null, slug text not null,
  description text not null, author text not null default 'unknown', version text not null default '1.0',
  license text, category text not null, icon_name text, source text not null,
  skill_content text not null, metadata jsonb not null default '{}'::jsonb,
  is_featured boolean not null default false, created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (slug)
);
create table if not exists skill_files (
  id uuid primary key default gen_random_uuid(), skill_id uuid not null references skills(id) on delete cascade,
  file_path text not null, content text not null, mime_type text not null default 'text/plain',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(skill_id, file_path)
);
create table if not exists workspace_skills (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  skill_id uuid not null references skills(id) on delete cascade, enabled boolean not null default true,
  installed_by uuid references profiles(id) on delete set null, installed_at timestamptz not null default now(),
  primary key(workspace_id, skill_id)
);
create index if not exists workspace_skills_enabled_idx on workspace_skills(workspace_id) where enabled;

do $$ declare tab text; begin
  foreach tab in array array['brand_kits','brand_kit_assets','skills','skill_files'] loop
    execute format('drop trigger if exists %I_set_updated_at on %I', tab, tab);
    execute format('create trigger %I_set_updated_at before update on %I for each row execute function set_updated_at()', tab, tab);
  end loop;
end $$;
