-- 0036_reach_demo_health_cleanup.sql
-- Keep cloned demo data production-health friendly without touching user-created posts.

UPDATE public.posts p
SET
  created_by = CASE
    WHEN p.created_by = 'aldridge@ten80ten.com' THEN 'Aldridge Dagos'
    ELSE p.created_by
  END,
  created_at = CASE
    WHEN p.created_at IS NULL OR p.created_at > NOW()
      THEN LEAST(COALESCE(p.updated_at, NOW()), NOW()) - INTERVAL '5 minutes'
    ELSE p.created_at
  END,
  updated_at = CASE
    WHEN p.updated_at IS NULL OR p.updated_at > NOW()
      THEN NOW()
    ELSE p.updated_at
  END
WHERE p.workspace_id = '00000000-0000-0000-0000-000000000001'
  AND (
    p.title ILIKE 'Sample%'
    OR p.title ILIKE 'Demo Archive Post%'
  );
