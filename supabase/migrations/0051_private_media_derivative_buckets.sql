-- 0051_private_media_derivative_buckets.sql
-- Multitenant hardening: derived media objects must not be world-readable.
-- Playback copies stream through /api/media/playback, which verifies the
-- caller's active workspace before reading the private object with service role.
-- HEIC previews stream through /api/media/image-preview and are cached in the
-- private thumbnails bucket by workspace/file id.

update storage.buckets
set public = false
where id in ('media-playback', 'media-thumbnails');

drop policy if exists "Public read media-playback" on storage.objects;
drop policy if exists "Public read media-thumbnails" on storage.objects;
