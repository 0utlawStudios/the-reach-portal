-- 0014_create_publish_job_for_post.sql
-- Server-side helper for the portal approval flow. Creates the durable
-- publish_jobs row and per-platform platform_publish_attempts rows when a post
-- enters approved_scheduled, using the canonical scheduled_at timestamp.

create or replace function create_publish_job_for_post(
  p_post_id uuid
) returns publish_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post record;
  v_timezone text;
  v_scheduled_at timestamptz;
  v_job publish_jobs;
begin
  select p.*, w.timezone as workspace_timezone
  into v_post
  from posts p
  join workspaces w on w.id = p.workspace_id
  where p.id = p_post_id
  for update;

  if not found then
    raise exception 'post % not found', p_post_id;
  end if;

  if v_post.stage::text <> 'approved_scheduled' then
    raise exception 'post % is %, expected approved_scheduled', p_post_id, v_post.stage::text;
  end if;

  v_timezone := coalesce(nullif(v_post.scheduled_timezone, ''), v_post.workspace_timezone, 'Asia/Dubai');
  v_scheduled_at := v_post.scheduled_at;

  if v_scheduled_at is null then
    if v_post.scheduled_date is null or v_post.scheduled_time is null then
      raise exception 'post % has no scheduled_at or legacy schedule columns', p_post_id;
    end if;

    v_scheduled_at := ((v_post.scheduled_date::date + v_post.scheduled_time::time) at time zone v_timezone);
  end if;

  update posts
  set scheduled_at = v_scheduled_at,
      scheduled_timezone = v_timezone,
      updated_at = now()
  where id = p_post_id;

  insert into publish_jobs (workspace_id, post_id, scheduled_at, state)
  values (v_post.workspace_id, p_post_id, v_scheduled_at, 'pending')
  on conflict (post_id) do update
    set scheduled_at = excluded.scheduled_at,
        state = 'pending',
        claim_expires_at = null,
        worker_id = null,
        updated_at = now()
    where publish_jobs.state in ('pending', 'failed')
  returning * into v_job;

  if v_job.id is null then
    select * into v_job
    from publish_jobs
    where post_id = p_post_id;
  end if;

  insert into platform_publish_attempts (job_id, platform, idempotency_key)
  select
    v_job.id,
    platform,
    concat(v_job.id::text, ':', platform)
  from unnest(coalesce(v_post.platforms, '{}'::text[])) as platform
  where platform in ('instagram', 'facebook', 'linkedin', 'tiktok', 'youtube')
  on conflict (job_id, platform) do nothing;

  return v_job;
end $$;

revoke all on function create_publish_job_for_post(uuid) from public;
grant execute on function create_publish_job_for_post(uuid) to service_role;
