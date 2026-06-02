-- 0034_reach_demo_posts_ready.sql
-- Make seeded demo cards complete enough to drag during client demos.
-- Real user-created posts are intentionally untouched.

UPDATE public.posts
SET
  title = 'Demo Archive Post 1',
  scheduled_date = DATE '2026-05-20',
  scheduled_time = TIME '10:00',
  scheduled_timezone = 'America/Chicago',
  scheduled_at = (DATE '2026-05-20'::text || ' ' || TIME '10:00'::text)::timestamp AT TIME ZONE 'America/Chicago',
  posted_at = (DATE '2026-05-20'::text || ' ' || TIME '10:00'::text)::timestamp AT TIME ZONE 'America/Chicago'
WHERE title IN ('Sample Archive Post 1', 'Demo Archive Post 1');

UPDATE public.posts
SET
  title = 'Demo Archive Post 2',
  scheduled_date = DATE '2026-05-24',
  scheduled_time = TIME '12:00',
  scheduled_timezone = 'America/Chicago',
  scheduled_at = (DATE '2026-05-24'::text || ' ' || TIME '12:00'::text)::timestamp AT TIME ZONE 'America/Chicago',
  posted_at = (DATE '2026-05-24'::text || ' ' || TIME '12:00'::text)::timestamp AT TIME ZONE 'America/Chicago'
WHERE title IN ('Sample Archive Post 2', 'Demo Archive Post 2');

UPDATE public.posts
SET
  title = 'Demo Archive Post 3',
  scheduled_date = DATE '2026-05-28',
  scheduled_time = TIME '09:00',
  scheduled_timezone = 'America/Chicago',
  scheduled_at = (DATE '2026-05-28'::text || ' ' || TIME '09:00'::text)::timestamp AT TIME ZONE 'America/Chicago',
  posted_at = (DATE '2026-05-28'::text || ' ' || TIME '09:00'::text)::timestamp AT TIME ZONE 'America/Chicago'
WHERE title IN ('Sample Archive Post 3', 'Demo Archive Post 3');

UPDATE public.posts
SET title = 'Sample Posted Content 3'
WHERE title IN ('Sample Archive Post 4', 'Sample Posted Content 3');

UPDATE public.posts
SET title = 'Sample Posted Content 4'
WHERE title IN ('Sample Archive Post 5', 'Sample Posted Content 4');

UPDATE public.posts
SET title = 'Sample Posted Content 5'
WHERE title IN ('Sample Archive Post 6', 'Sample Posted Content 5');

UPDATE public.posts p
SET
  caption = COALESCE(NULLIF(p.caption, ''), 'Demo caption for The Reach. Polished, personal, and ready for approval.'),
  asset_source = COALESCE(NULLIF(p.asset_source, ''), 'Demo seed asset package - approved public sample media'),
  created_by = COALESCE(NULLIF(p.created_by, ''), 'aldridge@ten80ten.com'),
  source_vault = jsonb_build_object(
    'designLink', 'https://thereach.travel/',
    'driveFolder', 'Demo seed assets; uploaded production media is mirrored through the app Drive workflow.',
    'rawFiles', jsonb_build_array(
      jsonb_build_object(
        'name', lower(regexp_replace(p.title, '[^a-zA-Z0-9]+', '-', 'g')) || '-master.jpg',
        'url', COALESCE(NULLIF(p.thumbnail_url, ''), 'https://thereach.travel/'),
        'usageType', 'master',
        'mimeType', 'image/jpeg',
        'size', 512000,
        'uploadedAt', COALESCE(p.created_at, NOW())
      )
    )
  ),
  checklist = jsonb_build_array(
    jsonb_build_object('id', '1', 'label', 'Thumbnail/cover image approved', 'checked', true),
    jsonb_build_object('id', '2', 'label', 'Caption proofread & hashtags added', 'checked', true),
    jsonb_build_object('id', '3', 'label', 'Hook verified (first 3 seconds)', 'checked', true),
    jsonb_build_object('id', '4', 'label', 'Call-to-action included', 'checked', true),
    jsonb_build_object('id', '5', 'label', 'Brand guidelines followed', 'checked', true),
    jsonb_build_object('id', '6', 'label', 'Scheduled date confirmed', 'checked', true)
  )
WHERE p.title ILIKE 'Sample%'
   OR p.title ILIKE 'Demo Archive Post%';
