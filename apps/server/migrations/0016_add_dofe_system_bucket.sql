-- Allow generated assets to be recorded in the DoFe system bucket without
-- re-downloading them from the gateway output bucket.

alter table asset_objects
  drop constraint if exists asset_objects_bucket_check;

alter table asset_objects
  add constraint asset_objects_bucket_check
  check (bucket in ('project-assets', 'user-avatars', 'dofe-system'));
