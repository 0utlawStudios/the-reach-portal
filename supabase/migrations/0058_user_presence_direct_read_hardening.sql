-- 0058_user_presence_direct_read_hardening.sql
-- The app reads team presence through v_user_presence_summary, which scopes
-- rows by active workspace membership. The base user_presence table is global
-- by auth user id, so direct authenticated SELECT must not expose every user's
-- raw presence row across tenants.

ALTER TABLE public.user_presence ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "all_read_presence" ON public.user_presence;
DROP POLICY IF EXISTS "self_read_presence" ON public.user_presence;

CREATE POLICY "self_read_presence" ON public.user_presence
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
