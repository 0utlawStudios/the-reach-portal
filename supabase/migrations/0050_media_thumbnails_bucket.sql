-- 0050_media_thumbnails_bucket.sql
-- Public CDN-backed poster images for fast card thumbnails.
-- Canonical publishing media remains in Google Drive/source_vault.rawFiles.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'media-thumbnails',
  'media-thumbnails',
  true,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public read media-thumbnails" on storage.objects;
create policy "Public read media-thumbnails" on storage.objects
  for select using (bucket_id = 'media-thumbnails');
