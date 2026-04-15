-- 0010_publish_ledger.sql
-- The durable publish pipeline: per-post publish jobs, per-platform attempts
-- with idempotency keys, encrypted OAuth account storage, and a dead-letter
-- table for poisoned jobs. n8n (or any worker) claims jobs atomically via
-- 0011_claim_publish_job.sql.
--
-- Closes the STRUCTURAL part of finding #4 (no publish queue) as schema.
-- Code that writes to these tables is Workstream F (not yet shipped).
--
-- Depends on workspaces (0002) and posts (0000 baseline).
-- Part of Workstream F (F1) of the security remediation.

-- ─── OAuth account storage (per workspace, per platform, per external account) ───

create table if not exists oauth_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  platform text not null check (platform in (
    'instagram','facebook','linkedin','x','tiktok','youtube'
  )),
  external_account_id text not null,
  display_name text,
  access_token_ciphertext bytea not null,
  refresh_token_ciphertext bytea,
  expires_at timestamptz,
  scopes text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, platform, external_account_id)
);

create index if not exists oauth_accounts_workspace_idx
  on oauth_accounts(workspace_id);
create index if not exists oauth_accounts_platform_idx
  on oauth_accounts(platform);
create index if not exists oauth_accounts_expiry_idx
  on oauth_accounts(expires_at)
  where expires_at is not null;

alter table oauth_accounts enable row level security;

-- Admins can read their workspace's accounts (to display "connected accounts"
-- in settings). Ciphertext columns are still encrypted at rest — reading them
-- does not reveal plaintext secrets.
drop policy if exists "oauth_accounts_select_v2" on oauth_accounts;
create policy "oauth_accounts_select_v2" on oauth_accounts for select
  using (is_active_workspace_member(workspace_id, array['superadmin','admin']));

-- Writes happen through server-side routes using the service role. No client
-- INSERT/UPDATE/DELETE policies.

-- ─── Publish jobs (one per post) ───

create table if not exists publish_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  post_id uuid not null references posts(id) on delete cascade,
  scheduled_at timestamptz not null,
  state text not null default 'pending' check (state in (
    'pending','claimed','running','partial','succeeded','failed','dead'
  )),
  claim_expires_at timestamptz,
  worker_id text,
  correlation_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One job per post. Republishing a post means creating a new row, not
-- mutating the old one. This is enforced for state integrity.
create unique index if not exists publish_jobs_post_uniq
  on publish_jobs(post_id);

create index if not exists publish_jobs_pending_idx
  on publish_jobs(scheduled_at)
  where state = 'pending';
create index if not exists publish_jobs_claimed_idx
  on publish_jobs(claim_expires_at)
  where state = 'claimed';
create index if not exists publish_jobs_workspace_idx
  on publish_jobs(workspace_id, state, scheduled_at);

alter table publish_jobs enable row level security;

drop policy if exists "publish_jobs_select_v2" on publish_jobs;
create policy "publish_jobs_select_v2" on publish_jobs for select
  using (is_active_workspace_member(workspace_id, null));

-- No client INSERT/UPDATE/DELETE policies. Worker uses service role.

-- ─── Per-platform publish attempts ───

create table if not exists platform_publish_attempts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references publish_jobs(id) on delete cascade,
  platform text not null,
  oauth_account_id uuid references oauth_accounts(id) on delete set null,
  idempotency_key text not null,
  state text not null default 'pending' check (state in (
    'pending','running','succeeded','failed'
  )),
  external_post_id text,
  response_payload jsonb,
  error_code text,
  error_message text,
  attempt_count int not null default 0,
  next_retry_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, platform),
  unique (job_id, idempotency_key)
);

create index if not exists platform_publish_attempts_retry_idx
  on platform_publish_attempts(next_retry_at)
  where state = 'pending' and next_retry_at is not null;
create index if not exists platform_publish_attempts_job_idx
  on platform_publish_attempts(job_id);

alter table platform_publish_attempts enable row level security;

drop policy if exists "platform_publish_attempts_select_v2" on platform_publish_attempts;
create policy "platform_publish_attempts_select_v2" on platform_publish_attempts for select
  using (
    job_id in (
      select id from publish_jobs
      where is_active_workspace_member(workspace_id, null)
    )
  );

-- No client INSERT/UPDATE/DELETE.

-- ─── Dead letter queue ───

create table if not exists dead_letter_jobs (
  id uuid primary key default gen_random_uuid(),
  origin_job_id uuid references publish_jobs(id) on delete set null,
  workspace_id uuid references workspaces(id) on delete cascade,
  payload jsonb not null,
  reason text not null,
  created_at timestamptz not null default now()
);

create index if not exists dead_letter_jobs_workspace_idx
  on dead_letter_jobs(workspace_id, created_at desc);

alter table dead_letter_jobs enable row level security;

drop policy if exists "dead_letter_jobs_select_v2" on dead_letter_jobs;
create policy "dead_letter_jobs_select_v2" on dead_letter_jobs for select
  using (
    workspace_id is null
    or is_active_workspace_member(workspace_id, array['superadmin','admin'])
  );

-- No client INSERT/UPDATE/DELETE.
