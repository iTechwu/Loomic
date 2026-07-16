-- Keep new workspaces immediately usable without relying on an external auth trigger.
create or replace function initialize_workspace_credits() returns trigger language plpgsql as $$
begin
  insert into subscriptions (workspace_id, plan) values (new.id, 'free') on conflict do nothing;
  insert into credit_balances (workspace_id, balance) values (new.id, 0) on conflict do nothing;
  return new;
end;
$$;
drop trigger if exists workspaces_initialize_credits on workspaces;
create trigger workspaces_initialize_credits after insert on workspaces
for each row execute function initialize_workspace_credits();
