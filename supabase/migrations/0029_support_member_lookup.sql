-- 0029_support_member_lookup.sql
-- resolve_workspace_member(workspace_id, email) -> auth user id, or NULL.
--
-- Depends on: 0002_tenant_model.sql (workspace_members).
--
-- Used by the admin "start a chat" route to turn a picked teammate's email
-- into their auth user id WITHOUT enumerating auth.users. The lookup is
-- workspace-scoped: it only ever returns a user who is an ACTIVE member of the
-- SAME workspace, so a future tenant-A admin can never resolve, or open a chat
-- with, a tenant-B user. SECURITY DEFINER with an empty search_path; EXECUTE is
-- granted to service_role only (server routes), never to the browser roles.

create or replace function public.resolve_workspace_member(
  p_workspace_id uuid,
  p_email        text
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select wm.user_id
  from public.workspace_members wm
  join auth.users u on u.id = wm.user_id
  where wm.workspace_id = p_workspace_id
    and wm.status = 'active'
    and lower(u.email) = lower(trim(p_email))
  limit 1;
$$;

revoke all on function public.resolve_workspace_member(uuid, text) from public;
revoke all on function public.resolve_workspace_member(uuid, text) from anon;
revoke all on function public.resolve_workspace_member(uuid, text) from authenticated;
grant execute on function public.resolve_workspace_member(uuid, text) to service_role;
