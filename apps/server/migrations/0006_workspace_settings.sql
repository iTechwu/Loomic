create table if not exists workspace_settings (
  workspace_id uuid primary key references workspaces(id) on delete cascade,
  default_model text not null default 'glm-5.2', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
drop trigger if exists workspace_settings_set_updated_at on workspace_settings;
create trigger workspace_settings_set_updated_at before update on workspace_settings for each row execute function set_updated_at();
