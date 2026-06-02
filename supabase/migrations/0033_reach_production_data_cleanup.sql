-- 0033_reach_production_data_cleanup.sql
-- Keep The Reach clone data clean after the initial Ten80Ten baseline seed.

-- Only Aldridge should be present by default for the new single-tenant company.
DELETE FROM public.workspace_members
WHERE workspace_id = '00000000-0000-0000-0000-000000000001'
  AND user_id IN (
    SELECT id
    FROM auth.users
    WHERE lower(email) IN (
      'christer@ten80ten.com',
      'alex@ten80ten.com',
      'carlo@ten80ten.com',
      'muaaz.ten80ten@gmail.com'
    )
  );

DELETE FROM public.team_members
WHERE lower(email) IN (
  'christer@ten80ten.com',
  'alex@ten80ten.com',
  'carlo@ten80ten.com',
  'muaaz.ten80ten@gmail.com'
);

UPDATE public.team_members
SET
  role = 'superadmin',
  secondary_role = 'Super Admin',
  status = 'active',
  joined_at = DATE '2026-06-02'
WHERE lower(email) = 'aldridge@ten80ten.com';

UPDATE public.workspace_members wm
SET
  role = 'superadmin',
  status = 'active',
  updated_at = NOW()
FROM auth.users au
WHERE wm.user_id = au.id
  AND lower(au.email) = 'aldridge@ten80ten.com'
  AND wm.workspace_id = '00000000-0000-0000-0000-000000000001';

-- Remove old operator names from seeded sample assets.
UPDATE public.media_assets
SET added_by = 'Aldridge'
WHERE lower(coalesce(added_by, '')) IN ('christer', 'alex', 'carlo', 'muaaz');

-- The public Reach brand site is thereach.travel; the app domain remains thereach.ten80ten.com.
UPDATE public.brand_playbook
SET data = jsonb_set(data, '{website}', to_jsonb('www.thereach.travel'::text), true)
WHERE id = 'singleton';

-- Rebase seeded samples into June 2026 so the dashboard, cards, and calendar agree.
WITH sample_dates(title, scheduled_date, scheduled_time, created_at) AS (
  VALUES
    ('Sample Idea Post 1', DATE '2026-06-04', TIME '09:00', TIMESTAMPTZ '2026-06-01 09:00:00+00'),
    ('Sample Idea Post 2', DATE '2026-06-05', TIME '10:30', TIMESTAMPTZ '2026-06-01 10:00:00+00'),
    ('Sample Idea Post 3', DATE '2026-06-06', TIME '11:00', TIMESTAMPTZ '2026-06-01 11:00:00+00'),
    ('Sample Idea Post 4', DATE '2026-06-07', TIME '13:00', TIMESTAMPTZ '2026-06-01 12:00:00+00'),
    ('Sample Awaiting Approval Post 1', DATE '2026-06-08', TIME '10:00', TIMESTAMPTZ '2026-06-02 09:00:00+00'),
    ('Sample Awaiting Approval Post 2', DATE '2026-06-09', TIME '14:00', TIMESTAMPTZ '2026-06-02 10:00:00+00'),
    ('Sample Awaiting Approval Post 3', DATE '2026-06-10', TIME '09:00', TIMESTAMPTZ '2026-06-02 11:00:00+00'),
    ('Sample Awaiting Approval Post 4', DATE '2026-06-11', TIME '12:00', TIMESTAMPTZ '2026-06-02 12:00:00+00'),
    ('Sample Revision Post 1', DATE '2026-06-12', TIME '11:00', TIMESTAMPTZ '2026-06-02 13:00:00+00'),
    ('Sample Revision Post 2', DATE '2026-06-13', TIME '15:00', TIMESTAMPTZ '2026-06-02 14:00:00+00'),
    ('Sample Revision Post 3', DATE '2026-06-14', TIME '08:00', TIMESTAMPTZ '2026-06-02 15:00:00+00'),
    ('Sample Revision Post 4', DATE '2026-06-15', TIME '10:00', TIMESTAMPTZ '2026-06-02 16:00:00+00'),
    ('Sample Scheduled Post 1', DATE '2026-06-16', TIME '09:00', TIMESTAMPTZ '2026-06-03 09:00:00+00'),
    ('Sample Scheduled Post 2', DATE '2026-06-17', TIME '11:00', TIMESTAMPTZ '2026-06-03 10:00:00+00'),
    ('Sample Scheduled Post 3', DATE '2026-06-18', TIME '08:00', TIMESTAMPTZ '2026-06-03 11:00:00+00'),
    ('Sample Scheduled Post 4', DATE '2026-06-19', TIME '14:00', TIMESTAMPTZ '2026-06-03 12:00:00+00'),
    ('Sample Posted Content 1', DATE '2026-06-03', TIME '10:00', TIMESTAMPTZ '2026-06-01 08:00:00+00'),
    ('Sample Posted Content 2', DATE '2026-06-02', TIME '09:00', TIMESTAMPTZ '2026-06-01 09:00:00+00'),
    ('Sample Archive Post 1', DATE '2026-06-03', TIME '13:00', TIMESTAMPTZ '2026-06-01 10:00:00+00'),
    ('Sample Archive Post 2', DATE '2026-06-02', TIME '12:00', TIMESTAMPTZ '2026-06-01 11:00:00+00'),
    ('Sample Archive Post 3', DATE '2026-06-01', TIME '06:00', TIMESTAMPTZ '2026-06-01 12:00:00+00'),
    ('Sample Archive Post 4', DATE '2026-06-01', TIME '10:00', TIMESTAMPTZ '2026-06-01 13:00:00+00'),
    ('Sample Archive Post 5', DATE '2026-06-02', TIME '09:00', TIMESTAMPTZ '2026-06-01 14:00:00+00'),
    ('Sample Archive Post 6', DATE '2026-06-03', TIME '12:00', TIMESTAMPTZ '2026-06-01 15:00:00+00')
)
UPDATE public.posts p
SET
  scheduled_date = d.scheduled_date,
  scheduled_time = d.scheduled_time,
  scheduled_timezone = 'America/Chicago',
  scheduled_at = (d.scheduled_date::text || ' ' || d.scheduled_time::text)::timestamp AT TIME ZONE 'America/Chicago',
  created_at = d.created_at,
  posted_at = CASE
    WHEN p.stage = 'posted'
      THEN (d.scheduled_date::text || ' ' || d.scheduled_time::text)::timestamp AT TIME ZONE 'America/Chicago'
    ELSE p.posted_at
  END
FROM sample_dates d
WHERE p.title = d.title;
