-- 0048_remove_sample_placeholders.sql
--
-- The Reach is past demo data. Keep fresh database replays from restoring the
-- original seeded sample/demo posts and placeholder media assets.
--
-- Preserve the post safety trigger: approved_scheduled / posted sample rows are
-- first moved to revision_needed, then deleted normally so posts_audit_before_delete
-- still records the deletion context.

DO $$
DECLARE
  v_workspace uuid := '00000000-0000-0000-0000-000000000001'::uuid;
  v_post_count integer;
  v_media_count integer;
BEGIN
  SELECT count(*)
    INTO v_post_count
    FROM public.posts
   WHERE workspace_id = v_workspace
     AND (
       title ILIKE 'Sample%'
       OR title ILIKE 'Demo Archive Post%'
     );

  SELECT count(*)
    INTO v_media_count
    FROM public.media_assets
   WHERE workspace_id = v_workspace
     AND (
       name ILIKE 'sample%'
       OR name ILIKE 'demo%'
       OR url ILIKE '%unsplash.com%'
     );

  UPDATE public.posts
     SET stage = 'revision_needed'
   WHERE workspace_id = v_workspace
     AND stage IN ('approved_scheduled', 'posted')
     AND (
       title ILIKE 'Sample%'
       OR title ILIKE 'Demo Archive Post%'
     );

  DELETE FROM public.posts
   WHERE workspace_id = v_workspace
     AND (
       title ILIKE 'Sample%'
       OR title ILIKE 'Demo Archive Post%'
     );

  DELETE FROM public.media_assets
   WHERE workspace_id = v_workspace
     AND (
       name ILIKE 'sample%'
       OR name ILIKE 'demo%'
       OR url ILIKE '%unsplash.com%'
     );

  INSERT INTO public.audit_log_v2 (
    workspace_id,
    actor_user_id,
    actor_role,
    entity_type,
    entity_id,
    action,
    metadata
  ) VALUES (
    v_workspace,
    NULL,
    'system',
    'maintenance',
    NULL,
    'sample_placeholder_cleanup_migration',
    jsonb_build_object(
      'details', 'Removed seeded sample/demo posts and placeholder media from The Reach replay.',
      'candidate_post_count', v_post_count,
      'candidate_media_count', v_media_count
    )
  );
END $$;
