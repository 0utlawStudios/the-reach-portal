-- 0024_user_presence.sql
-- Five-path "last seen + online status" system. Schema + triggers + RPCs.
--
-- Identity: user_presence.user_id references auth.users(id), which is what
-- auth.uid() returns and what audit_log_v2.actor_user_id references. team_members
-- joins to presence via team_members.email = auth.users.email (lowercased).
--
-- Five independent write paths populate last_seen_at:
--   1. Audit-log trigger (server-side, runs on every record_audit_event call)
--   2. Client 60s heartbeat → touch_my_presence(true)
--   3. Client route-change ping → touch_my_presence_throttled() (60s server throttle)
--   4. Departure beacon → /api/presence/departure → touch_my_presence(false)
--   5. Realtime presence channel (live online/idle/away — not a DB write)
--
-- Strictly additive: IF NOT EXISTS everywhere, no drops, no enum changes.
-- Safe to apply on a live database.

-- ─── TABLE ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.user_presence (
  user_id        uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  last_active_at timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_presence_last_seen
  ON public.user_presence(last_seen_at DESC);

ALTER TABLE public.user_presence ENABLE ROW LEVEL SECURITY;

-- Read: everyone authenticated can see presence (it's a team feature).
DROP POLICY IF EXISTS "all_read_presence" ON public.user_presence;
CREATE POLICY "all_read_presence" ON public.user_presence
  FOR SELECT TO authenticated USING (true);

-- Write: only the row owner can insert/update their own row.
DROP POLICY IF EXISTS "self_insert_presence" ON public.user_presence;
CREATE POLICY "self_insert_presence" ON public.user_presence
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "self_update_presence" ON public.user_presence;
CREATE POLICY "self_update_presence" ON public.user_presence
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- No DELETE policy. last_seen_at must be durable.

-- ─── RPC: full touch ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.touch_my_presence(activity boolean DEFAULT true)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  INSERT INTO public.user_presence (user_id, last_seen_at, last_active_at)
  VALUES (auth.uid(), now(), now())
  ON CONFLICT (user_id) DO UPDATE
    SET last_seen_at   = now(),
        last_active_at = CASE WHEN activity THEN now() ELSE user_presence.last_active_at END,
        updated_at     = now();
END;
$func$;

REVOKE ALL ON FUNCTION public.touch_my_presence(boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.touch_my_presence(boolean) TO authenticated;

-- ─── RPC: throttled touch (server-side 60s throttle) ────────────────────

CREATE OR REPLACE FUNCTION public.touch_my_presence_throttled()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.user_presence (user_id, last_seen_at, last_active_at)
  VALUES (auth.uid(), now(), now())
  ON CONFLICT (user_id) DO UPDATE
    SET last_seen_at = now(),
        updated_at   = now()
    WHERE user_presence.last_seen_at < now() - interval '60 seconds';
END;
$func$;

REVOKE ALL ON FUNCTION public.touch_my_presence_throttled() FROM public;
GRANT EXECUTE ON FUNCTION public.touch_my_presence_throttled() TO authenticated;

-- ─── TRIGGER: sync presence from audit_log_v2 ───────────────────────────
--
-- Every record_audit_event() call inserts a row to audit_log_v2 with
-- actor_user_id derived from auth.uid(). We piggyback on those inserts to
-- update user_presence.last_seen_at. This is THE server-side write path —
-- it works even if the client is completely silent.

CREATE OR REPLACE FUNCTION public.sync_presence_from_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
BEGIN
  IF NEW.actor_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Defensive: only touch presence if the actor still exists in auth.users.
  -- Cascading deletes mean a stale audit row could outlive its auth user.
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = NEW.actor_user_id) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.user_presence (user_id, last_seen_at, last_active_at)
  VALUES (NEW.actor_user_id, NEW.created_at, NEW.created_at)
  ON CONFLICT (user_id) DO UPDATE
    SET last_seen_at   = GREATEST(user_presence.last_seen_at, NEW.created_at),
        last_active_at = GREATEST(user_presence.last_active_at, NEW.created_at),
        updated_at     = now();

  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS trg_audit_log_v2_sync_presence ON public.audit_log_v2;
CREATE TRIGGER trg_audit_log_v2_sync_presence
  AFTER INSERT ON public.audit_log_v2
  FOR EACH ROW EXECUTE FUNCTION public.sync_presence_from_audit();

-- ─── BACKFILL ───────────────────────────────────────────────────────────
--
-- Populate user_presence for every existing auth.users row from the best
-- historical signal we have: max(audit_log_v2.created_at) or
-- auth.users.last_sign_in_at, whichever is more recent. Skipping users
-- with no history at all (their row gets created on first ping).

WITH last_audit AS (
  SELECT actor_user_id AS user_id, MAX(created_at) AS ts
  FROM public.audit_log_v2
  WHERE actor_user_id IS NOT NULL
  GROUP BY actor_user_id
),
last_signin AS (
  SELECT id AS user_id, last_sign_in_at AS ts
  FROM auth.users
  WHERE last_sign_in_at IS NOT NULL
),
combined AS (
  SELECT
    u.id AS user_id,
    GREATEST(
      COALESCE(la.ts, '-infinity'::timestamptz),
      COALESCE(ls.ts, '-infinity'::timestamptz)
    ) AS best_ts
  FROM auth.users u
  LEFT JOIN last_audit la ON la.user_id = u.id
  LEFT JOIN last_signin ls ON ls.user_id = u.id
)
INSERT INTO public.user_presence (user_id, last_seen_at, last_active_at)
SELECT user_id, best_ts, best_ts
FROM combined
WHERE best_ts > '-infinity'::timestamptz
ON CONFLICT (user_id) DO UPDATE
  SET last_seen_at   = GREATEST(user_presence.last_seen_at, EXCLUDED.last_seen_at),
      last_active_at = GREATEST(user_presence.last_active_at, EXCLUDED.last_active_at),
      updated_at     = now();

-- ─── VIEW: forensics + hydration ────────────────────────────────────────
--
-- Joins team_members (display info) → auth.users (identity) → user_presence
-- (live tracking) plus the historical fallback signals. The UI reads this
-- view to render the label hierarchy: presence_last_seen > audit_last >
-- auth_last_sign_in > "Never signed in".
--
-- The view runs with the view owner's permissions (security_invoker=false,
-- the Postgres default) so authenticated users can read it without needing
-- direct access to auth.users.

CREATE OR REPLACE VIEW public.v_user_presence_summary AS
SELECT
  tm.id                AS team_member_id,
  tm.name              AS full_name,
  tm.email             AS email,
  au.id                AS auth_user_id,
  up.last_seen_at      AS presence_last_seen,
  up.last_active_at    AS presence_last_active,
  (
    SELECT MAX(created_at)
    FROM public.audit_log_v2
    WHERE actor_user_id = au.id
  )                    AS audit_last,
  au.last_sign_in_at   AS auth_last_sign_in,
  GREATEST(
    COALESCE(up.last_seen_at, '-infinity'::timestamptz),
    COALESCE(
      (SELECT MAX(created_at) FROM public.audit_log_v2 WHERE actor_user_id = au.id),
      '-infinity'::timestamptz
    ),
    COALESCE(au.last_sign_in_at, '-infinity'::timestamptz)
  )                    AS best_known_seen
FROM public.team_members tm
LEFT JOIN auth.users au ON LOWER(au.email) = LOWER(tm.email)
LEFT JOIN public.user_presence up ON up.user_id = au.id;

GRANT SELECT ON public.v_user_presence_summary TO authenticated;

COMMENT ON VIEW public.v_user_presence_summary IS
  'Joined view of team_members + auth.users + user_presence for label hierarchy. '
  'Read by /api/presence/diag (superadmin forensics) and the team UI hydration path.';
