-- 0015_post_safety.sql
-- HARD DATABASE RULES — Post Data Integrity
--
-- Purpose: Make it physically impossible at the database level for any
-- code bug, agent edit, or migration mistake to silently destroy post data.
--
-- Rules enforced:
--   1. ALL post deletes are logged to audit_log_v2 before the row is removed.
--   2. Posts in 'approved_scheduled' or 'posted' stage CANNOT be hard-deleted.
--      They must be moved to a different stage first by a superadmin.
--   3. These triggers complement the code-level rules in AGENTS.md.
--
-- See AGENTS.md for the full set of rules every developer and AI agent must follow.

-- ─── 1. Pre-delete audit logger ───
-- Fires BEFORE every DELETE on posts. Records the full post context into
-- audit_log_v2 so the data is preserved even after the row is gone.

create or replace function log_post_before_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into audit_log_v2 (
    workspace_id,
    actor_user_id,
    entity_type,
    entity_id,
    action,
    metadata
  ) values (
    old.workspace_id,
    auth.uid(),
    'post',
    old.id,
    'post_hard_deleted',
    jsonb_build_object(
      'title',          old.title,
      'stage',          old.stage,
      'platforms',      old.platforms,
      'content_type',   old.content_type,
      'scheduled_date', old.scheduled_date,
      'scheduled_time', old.scheduled_time,
      'caption',        left(coalesce(old.caption, ''), 500),
      'created_at',     old.created_at
    )
  );
  return old;
end;
$$;

drop trigger if exists posts_audit_before_delete on posts;
create trigger posts_audit_before_delete
  before delete on posts
  for each row
  execute function log_post_before_delete();

-- ─── 2. Block deletion of approved / published posts ───
-- Approved posts have been signed off by an approver.
-- Posted posts are live on social media.
-- Neither should ever disappear from the archive without explicit human action.

create or replace function block_protected_post_delete()
returns trigger
language plpgsql
as $$
begin
  if old.stage in ('approved_scheduled', 'posted') then
    raise exception
      'SAFETY BLOCK: Post "%" is in stage "%" and cannot be permanently deleted. '
      'Move it to revision_needed first, or have a superadmin run a direct SQL delete '
      'with service-role credentials if truly required.',
      old.title, old.stage
      using errcode = 'P0001';
  end if;
  return old;
end;
$$;

drop trigger if exists posts_protect_approved_and_posted on posts;
create trigger posts_protect_approved_and_posted
  before delete on posts
  for each row
  execute function block_protected_post_delete();

-- ─── 3. Stage transition audit trigger ───
-- Fires AFTER every UPDATE that changes the stage column.
-- Creates an automatic audit trail without relying on client-side logAudit calls.

create or replace function audit_post_stage_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.stage is distinct from new.stage then
    insert into audit_log_v2 (
      workspace_id,
      actor_user_id,
      entity_type,
      entity_id,
      action,
      metadata
    ) values (
      new.workspace_id,
      auth.uid(),
      'post',
      new.id,
      'stage_changed',
      jsonb_build_object(
        'from_stage', old.stage,
        'to_stage',   new.stage,
        'title',      new.title
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists posts_audit_stage_change on posts;
create trigger posts_audit_stage_change
  after update on posts
  for each row
  execute function audit_post_stage_change();
