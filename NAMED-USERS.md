# Named Users - Reach Portal

updated-at: 2026-06-04T19:40:20Z
repo: `/Users/ace/Documents/CURSOR MAIN/THE REACH SMM PORTAL`
project: Reach Supabase `gxmpmdhmxyfqusdzcemt`
workspace: `00000000-0000-0000-0000-000000000001` (`The Reach`)

## Source SQL

The active Reach users below were verified with this linked Supabase SQL:

```sql
select
  wm.workspace_id,
  wm.user_id,
  wm.role::text as role,
  wm.status::text as workspace_status,
  au.email as auth_email,
  coalesce(au.raw_user_meta_data->>'name', au.raw_user_meta_data->>'full_name') as auth_name,
  tm.name as team_name,
  tm.email as team_email,
  tm.role::text as team_role,
  tm.status::text as team_status
from public.workspace_members wm
join auth.users au on au.id = wm.user_id
left join public.team_members tm on lower(tm.email) = lower(au.email)
where wm.status = 'active'
order by wm.created_at asc;
```

Role availability was verified with:

```sql
select
  wm.role::text as role,
  count(*)::int as active_count
from public.workspace_members wm
where wm.status = 'active'
group by wm.role
order by role;
```

## Active Reach Auth Users

| Persona | Name | Email | auth.users id | workspace_members role | workspace_id | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| Superadmin fallback | Aldridge Dagos | `aldridge@ten80ten.com` | `f4d6c15a-7b94-4e58-ac8b-4de98aa0d644` | `superadmin` | `00000000-0000-0000-0000-000000000001` | `auth.users.id = workspace_members.user_id`, `team_members.status = active` |
| Approver persona | Hanes Lawrence Abasola | `hanes@ten80ten.com` | `952b51be-9037-4da3-8364-5b52bf894347` | `admin` | `00000000-0000-0000-0000-000000000001` | `auth.users.id = workspace_members.user_id`, `team_members.status = active` |
| Author-capable persona | Shahannie Manuel | `shang.ten80ten@gmail.com` | `a7f2165d-d667-4bf8-ab37-383ffc485323` | `creative_director` | `00000000-0000-0000-0000-000000000001` | `auth.users.id = workspace_members.user_id`, `team_members.status = active` |

## Role Notes

- Active Reach role counts are `admin=1`, `creative_director=1`, and `superadmin=1`.
- There is no active lower-role author-only Reach user in `workspace_members`.
- `creative_director` is approver-class under `src/lib/roles.ts`; it is listed as author-capable only because it is a real active Reach user who can write/manage posts. It is not a lower-role author persona.
- Muaaz and Carlo are intentionally not mapped for The Reach Portal. The user clarified they belong to the separate Ten80Ten SMM Portal, not this Reach Portal workspace.
