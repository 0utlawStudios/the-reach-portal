-- 0008_abuse_events.sql
-- Adds an abuse_events log for rate-limiter deny events, suspicious request
-- patterns, and any other abuse signal that should be queryable after the fact.
-- Service-role only. Never readable from the client.
-- Part of Workstream G (G4) of the security remediation.

create table if not exists abuse_events (
  id uuid primary key default gen_random_uuid(),
  ip text,
  user_id uuid references auth.users(id) on delete set null,
  route text not null,
  reason text not null,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists abuse_events_created_idx
  on abuse_events(created_at desc);
create index if not exists abuse_events_ip_idx
  on abuse_events(ip, created_at desc);
create index if not exists abuse_events_user_idx
  on abuse_events(user_id, created_at desc);
create index if not exists abuse_events_route_idx
  on abuse_events(route, created_at desc);

alter table abuse_events enable row level security;

-- Deny all client access. Inserts happen only via service role.
drop policy if exists "abuse_events_deny" on abuse_events;
create policy "abuse_events_deny" on abuse_events
  for all using (false) with check (false);
