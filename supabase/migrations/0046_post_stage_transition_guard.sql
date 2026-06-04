-- 0046_post_stage_transition_guard.sql
--
-- Close the remaining stage-transition bypasses:
--   1. Posted posts are immutable from browser-authenticated sessions. The
--      publisher/service-role recovery path may still correct them.
--   2. Only approver-class workspace members may move a post into
--      approved_scheduled. Lower production roles may still edit content, but
--      they cannot approve/schedule by bypassing the UI.

CREATE OR REPLACE FUNCTION public.block_manual_posted_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $func$
DECLARE
  v_actor_role text;
BEGIN
  IF OLD.stage IS NOT DISTINCT FROM NEW.stage THEN
    RETURN NEW;
  END IF;

  IF OLD.stage = 'posted' THEN
    IF current_user NOT IN ('postgres', 'service_role', 'supabase_admin') THEN
      RAISE EXCEPTION
        'POSTED_LOCKDOWN: Published posts cannot be moved out of "posted" by a browser session. Current user: %.',
        current_user
        USING ERRCODE = 'P0001',
              HINT    = 'Create a new post or use a service-role recovery path for deliberate publisher corrections.';
    END IF;
  END IF;

  IF NEW.stage = 'posted' THEN
    IF current_user NOT IN ('postgres', 'service_role', 'supabase_admin') THEN
      RAISE EXCEPTION
        'POSTED_LOCKDOWN: Posts can only be moved to "posted" by the n8n auto-publisher after a successful platform API call. Current user: %.',
        current_user
        USING ERRCODE = 'P0001',
              HINT    = 'Approve the post and let n8n publish it. The card will move to Posted automatically once the post goes live.';
    END IF;

    IF NEW.posted_at IS NULL THEN
      RAISE EXCEPTION
        'POSTED_LOCKDOWN: stage="posted" requires posted_at to be non-null. The publisher must record when the post went live.'
        USING ERRCODE = 'P0001',
              HINT    = 'Set posted_at = now() in the same UPDATE that flips stage to posted.';
    END IF;
  END IF;

  IF NEW.stage = 'approved_scheduled' THEN
    IF current_user NOT IN ('postgres', 'service_role', 'supabase_admin') THEN
      SELECT wm.role::text
        INTO v_actor_role
        FROM public.workspace_members wm
       WHERE wm.workspace_id = NEW.workspace_id
         AND wm.user_id = auth.uid()
         AND wm.status = 'active'
         AND wm.role::text IN ('superadmin', 'admin', 'owner', 'approver', 'creative_director')
       LIMIT 1;

      IF v_actor_role IS NULL THEN
        RAISE EXCEPTION
          'APPROVAL_LOCKDOWN: Only approver-class users can move posts to "approved_scheduled".'
          USING ERRCODE = 'P0001',
                HINT    = 'Allowed roles are superadmin, admin, owner, approver, and creative_director.';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS posts_block_manual_posted ON public.posts;
CREATE TRIGGER posts_block_manual_posted
  BEFORE UPDATE ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.block_manual_posted_transition();
