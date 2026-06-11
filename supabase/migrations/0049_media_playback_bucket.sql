-- 0049_media_playback_bucket.sql
-- Public CDN-backed playback copies for browser video preview.
-- Canonical publishing media remains in Google Drive/source_vault.rawFiles.

insert into storage.buckets (id, name, public)
values (
  'media-playback',
  'media-playback',
  true
)
on conflict (id) do update set
  public = excluded.public;

drop policy if exists "Public read media-playback" on storage.objects;
create policy "Public read media-playback" on storage.objects
  for select using (bucket_id = 'media-playback');
