-- 0012_scheduled_at_tstz.sql
-- Add timezone-aware scheduled_at to posts. Backfill from the legacy
-- scheduled_date + scheduled_time columns using the workspace's timezone
-- (falling back to Asia/Dubai). Old columns stay for read compatibility
-- until a later cleanup sprint.
-- Closes finding #10 (scheduling without timezone) as a migration file.
-- Part of Workstream F (F5) of the security remediation.

alter table posts add column if not exists scheduled_at timestamptz;
alter table posts add column if not exists scheduled_timezone text;

-- Backfill scheduled_at from scheduled_date + scheduled_time.
-- Interpret the legacy wall-clock time in the workspace's timezone.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'posts' and column_name = 'scheduled_date'
  ) then
    update posts p
    set
      scheduled_at = (
        (p.scheduled_date::text || ' ' || coalesce(p.scheduled_time::text, '09:00:00'))::timestamp
        at time zone coalesce(
          (select w.timezone from workspaces w where w.id = p.workspace_id),
          'Asia/Dubai'
        )
      ),
      scheduled_timezone = coalesce(
        (select w.timezone from workspaces w where w.id = p.workspace_id),
        'Asia/Dubai'
      )
    where p.scheduled_at is null
      and p.scheduled_date is not null;
  end if;
end $$;

-- Default timezone for new rows when not explicitly set.
alter table posts alter column scheduled_timezone set default 'Asia/Dubai';

create index if not exists posts_scheduled_at_idx
  on posts(scheduled_at)
  where scheduled_at is not null;

create index if not exists posts_scheduled_at_workspace_idx
  on posts(workspace_id, scheduled_at)
  where scheduled_at is not null;
