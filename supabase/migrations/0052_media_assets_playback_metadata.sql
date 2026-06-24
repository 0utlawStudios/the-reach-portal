-- 0052_media_assets_playback_metadata.sql
-- Preserve Drive/source and private playback metadata for Media Library rows.
-- This lets videos uploaded directly from the Media Library use the same
-- hardened private playback route as videos uploaded from create/drawer/picker.

alter table media_assets add column if not exists file_id text;
alter table media_assets add column if not exists publish_url text;
alter table media_assets add column if not exists drive_proxy_url text;
alter table media_assets add column if not exists playback_url text;
alter table media_assets add column if not exists playback_storage_key text;
alter table media_assets add column if not exists mime_type text;
alter table media_assets add column if not exists size_bytes bigint;

create index if not exists media_assets_workspace_file_id_idx
  on media_assets(workspace_id, file_id)
  where file_id is not null;
