-- 0006_rate_limit.sql
-- Adds the rate_limit_buckets table and the rate_limit_consume RPC used by
-- the server-side rate limiter in src/lib/rate-limit.ts. Postgres-backed so we
-- do not need an external service on Vercel Hobby.
-- Part of Workstream G (G3) of the security remediation.

create table if not exists rate_limit_buckets (
  scope text not null,
  key text not null,
  count int not null default 0,
  window_start timestamptz not null default now(),
  primary key (scope, key)
);

alter table rate_limit_buckets enable row level security;

-- Service-role only. No public access. The consume RPC runs as security definer.
drop policy if exists "rate_limit_buckets_deny" on rate_limit_buckets;
create policy "rate_limit_buckets_deny" on rate_limit_buckets
  for all using (false) with check (false);

-- Atomic fixed-window counter. On conflict, resets count if the window has
-- elapsed, otherwise increments. Returns the current state.
create or replace function rate_limit_consume(
  p_scope text,
  p_key text,
  p_limit int,
  p_window_seconds int
) returns table(allowed boolean, remaining int, reset_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
  v_window_start timestamptz;
begin
  insert into rate_limit_buckets(scope, key, count, window_start)
  values (p_scope, p_key, 1, now())
  on conflict (scope, key) do update
  set count = case
    when rate_limit_buckets.window_start + make_interval(secs => p_window_seconds) < now() then 1
    else rate_limit_buckets.count + 1
  end,
  window_start = case
    when rate_limit_buckets.window_start + make_interval(secs => p_window_seconds) < now() then now()
    else rate_limit_buckets.window_start
  end
  returning rate_limit_buckets.count, rate_limit_buckets.window_start
  into v_count, v_window_start;

  return query select
    v_count <= p_limit,
    greatest(0, p_limit - v_count),
    v_window_start + make_interval(secs => p_window_seconds);
end $$;

revoke all on function rate_limit_consume from public;
grant execute on function rate_limit_consume to service_role;
