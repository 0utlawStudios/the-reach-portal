-- 0049_media_playback_bucket.sql
-- Public CDN-backed playback copies for browser video preview.
-- Canonical publishing media remains in Google Drive/source_vault.rawFiles.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'media-playback',
  'media-playback',
  true,
  52428800,
  array['video/mp4', 'video/x-m4v', 'video/quicktime', 'video/webm']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public read media-playback" on storage.objects;
create policy "Public read media-playback" on storage.objects
  for select using (bucket_id = 'media-playback');
