-- 0011_claim_publish_job.sql
-- Atomic claim function for the publish worker. Uses FOR UPDATE SKIP LOCKED so
-- multiple workers can claim different jobs concurrently without stepping on
-- each other. The claim includes an expiry so a crashed worker's job can be
-- reclaimed by a watchdog. Worker contract:
--
--   1. Call claim_publish_job('<worker-id>') to claim 0 or 1 job.
--   2. For each platform in the job, call the platform API with the
--      idempotency key from platform_publish_attempts (inserted on job creation).
--   3. On success, update the attempt row with external_post_id and state.
--   4. On failure, increment attempt_count and schedule next_retry_at with
--      exponential backoff. After 5 attempts, move the job to dead_letter_jobs.
--   5. When all per-platform attempts succeed, mark the job 'succeeded'.
--
-- Runs as security definer so a low-privilege service role can invoke it,
-- but the RLS on publish_jobs still gates reads.
-- Part of Workstream F (F2) of the security remediation.

create or replace function claim_publish_job(
  p_worker_id text,
  p_claim_seconds int default 30
) returns setof publish_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update publish_jobs pj set
    state = 'claimed',
    worker_id = p_worker_id,
    claim_expires_at = now() + make_interval(secs => p_claim_seconds),
    updated_at = now()
  where pj.id = (
    select id from publish_jobs
    where state = 'pending'
      and scheduled_at <= now()
    order by scheduled_at
    for update skip locked
    limit 1
  )
  returning *;
end $$;

revoke all on function claim_publish_job(text, int) from public;
grant execute on function claim_publish_job(text, int) to service_role;

-- Watchdog: reset any claimed jobs whose claim has expired. Should run via
-- pg_cron every minute. On Vercel Hobby we cannot schedule minute-level
-- crons so the watchdog lives in pg_cron (Supabase extension) instead.
create or replace function reclaim_expired_publish_jobs()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  update publish_jobs
  set state = 'pending',
      worker_id = null,
      claim_expires_at = null,
      updated_at = now()
  where state = 'claimed'
    and claim_expires_at < now();
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke all on function reclaim_expired_publish_jobs() from public;
grant execute on function reclaim_expired_publish_jobs() to service_role;

-- Helper: move a publish_job to dead_letter_jobs after repeated failures.
-- Called by the worker when attempt_count exceeds the retry limit.
create or replace function dead_letter_publish_job(
  p_job_id uuid,
  p_reason text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job publish_jobs;
  v_dlq_id uuid;
begin
  select * into v_job from publish_jobs where id = p_job_id for update;
  if v_job.id is null then
    raise exception 'publish_job % not found', p_job_id;
  end if;

  insert into dead_letter_jobs(origin_job_id, workspace_id, payload, reason)
  values (
    p_job_id,
    v_job.workspace_id,
    jsonb_build_object(
      'job', to_jsonb(v_job),
      'attempts', (
        select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb)
        from platform_publish_attempts a
        where a.job_id = p_job_id
      )
    ),
    p_reason
  )
  returning id into v_dlq_id;

  update publish_jobs
  set state = 'dead',
      updated_at = now()
  where id = p_job_id;

  return v_dlq_id;
end $$;

revoke all on function dead_letter_publish_job(uuid, text) from public;
grant execute on function dead_letter_publish_job(uuid, text) to service_role;
