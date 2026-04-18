# Ten80Ten SMM Portal, One-Phase Full-Authority Remediation Plan

> **For agentic workers:** this is a strategic remediation plan, not a TDD task list. Treat each workstream as a milestone that produces its own PR(s). Use `superpowers:executing-plans` only after the workstream-level ADRs below are approved.

**Author:** Acting CTO (Claude Opus 4.6)
**Date:** 2026-04-15
**Scope:** All 18 findings from the adversarial code review.
**Mode:** Single remediation phase, zero-downtime, live production.
**Status:** For approval before any code change.

---

## 0. Summary & Hard Constraints

The review found 4 CRITICAL, 5 HIGH, 7 MEDIUM, 1 LOW issue. The core problem is not any single bug: security and workflow rules live in the browser, while the database is open to the anon key, and the publish pipeline advertised in the UI does not exist in committed code.

This plan fixes every finding in one remediation phase. It preserves the v1.0 UI/RBAC/n8n contracts that memory marks as permanent by treating the lock as "public shapes only" and rewriting the hidden server-side substrate.

Hard constraints:
- Live production with real users. No destructive migrations. No downtime.
- v1.0 UI patterns, RBAC role names, and n8n data contract stay intact.
- Vercel Hobby plan (cron frequency caps, 10s function ceiling).
- Supabase, n8n, Google Drive remain the core.
- Next.js 16 + React Compiler. Not the Next.js you know. Read `node_modules/next/dist/docs/` before any route or file-structure change.
- Permanent feedback rules: never drop or truncate audit logs, never overwrite `team_members`, `placeholder_data`, env, or `brand_playbook` rows.

---

## 1. Threat Model

1. **Anon key abuse.** Any caller with the public anon key reads or writes any table.
2. **Actor spoofing.** Privileged routes trust `requestedBy` from the request body.
3. **Drive bucket abuse.** Public endpoints let attackers upload and stream company Drive content.
4. **Cross-tenant leakage.** No workspace boundary. Once tenant 2 lands, tenant 1 leaks.
5. **Duplicate publish.** No idempotency, no atomic claim. Two workers or two retries post the same content twice.
6. **Silent drop.** No dead-letter queue, so a poisoned job vanishes.
7. **Token leakage.** Auth tokens travel through URL query strings into logs and referrers.
8. **Email HTML injection.** User-controlled fields land in `<td>...</td>` unescaped.
9. **Public form abuse.** Forgot-password and request-access have no throttling.

---

## 2. Architectural Decisions (ADRs)

### ADR-1. Server-side authority
All privileged reads and writes go through Next.js route handlers that verify a Supabase JWT. The browser Supabase client uses the anon key only for authenticated SELECTs that strict RLS already filters. The service-role key is touched only after the server has verified the actor.

### ADR-2. Workspace-first tenant model
Add `workspaces` and `workspace_members`. Every domain row gets `workspace_id`. The current single-tenant deployment seeds one workspace and backfills. Multi-tenant becomes a config change, not a rewrite.

### ADR-3. Publish job ledger
New tables: `publish_jobs` (one per post), `platform_publish_attempts` (one per platform per post), `oauth_accounts`, `rate_limit_buckets`, `dead_letter_jobs`. Atomic claim via `FOR UPDATE SKIP LOCKED`. n8n stays, but only as a dumb executor reading jobs and writing attempt rows keyed by idempotency token.

### ADR-4. Migration-driven schema
One canonical `supabase/migrations/` directory managed by the Supabase CLI. Delete copy-paste `.sql` files. `supabase gen types typescript` runs in CI. Drift fails the build.

### ADR-5. Server-managed media lifecycle
All Drive operations route through `/api/media/*`, which coordinate DB + Drive atomically. Upload creates a `pending` asset, finalize flips to `ready`, a reaper deletes orphaned `pending` assets older than 60 minutes.

### ADR-6. Cookie-based auth exchange
Replace URL-param token flows with server-side PKCE exchange that sets HttpOnly cookies. Invite, setup, and reset pages read session state from cookies, never from the query string.

### ADR-7. Feature-flag every risky cutover
New `feature_flags(name, enabled, metadata)` table. RLS v2, server-auth v2, drive v2, audit v2, media v2, publish v2, content-validation v2 each ship behind their own flag so a bad cutover flips off in seconds instead of a revert.

### ADR-8. Legacy overlap, not delete
Old code paths live in a `src/legacy/` subtree during the 30-day overlap window. They import the same flag helper and no-op when v2 is on. Nothing gets deleted until the cleanup sprint after the cutover.

---

## 3. Workstream Dependency Graph

```
A (foundation) ──┬── B (auth) ──┬── D (server APIs)
                 │              │
                 └── C (tenant) ┴── E (drive) ── F (publishing)
                                     │              │
                                     └── G (hygiene) ┘
                                     └── H (content)
```

- A blocks everything.
- B and C run in parallel after A.
- D and E start once B and C land their core pieces.
- F starts once C is live and D's auth middleware is available.
- G and H run alongside F.

Calendar: 12 to 15 working days solo, 6 to 8 days with a parallel pair. Internal flags play the role of phases, so the external release remains single-phase.

---

## 4. Workstream A, Foundation

**Goal:** Give every later workstream a clean, gated, trustworthy base.

**Tasks:**
- **A1. Migration infrastructure.** Install `supabase` CLI. Create `supabase/migrations/0000_baseline.sql` via `supabase db dump`. Add `npm run db:diff` and `npm run db:types` scripts. Commit generated `src/lib/database.types.ts`.
- **A2. CI guardrails.** Make `lint`, `typecheck`, and `db:diff` required in CI. Add a secret scanner step. Block merges on lint errors.
- **A3. Lint fix (108 errors to 0).** Targeted passes per file category: React Compiler hook errors, explicit `any`, raw `<a>` navigation, forbidden `require()`. No mass rule-disables. Each intentional exemption gets a per-line comment stating why.
- **A4. Secrets audit and rotation.** Inventory every env var. Rotate any secret referenced in git history. Document rotation cadence.
- **A5. Feature-flag table.** New `feature_flags` table + `src/lib/flags.ts` helper `isFlagOn(name)`. Admin-only toggle UI lives on the settings page.
- **A6. Structured logging.** Add `src/lib/logger.ts` with correlation id, level, route. Every route built from B onward uses it.

**Files:**
- New: `supabase/migrations/0000_baseline.sql`, `supabase/config.toml`, `src/lib/logger.ts`, `src/lib/flags.ts`, `scripts/db-types-check.ts`.
- Modify: `.github/workflows/*`, `package.json`, `eslint.config.mjs`, possibly `next.config.mjs`.

**Acceptance:** `npm run lint && npm run typecheck && npm run db:diff && npm run test` is green. CI blocks on all four.

**Rollback:** Revert the PR. No data touched.

**Addresses finding:** #17.

---

## 5. Workstream B, Auth & Session

**Goal:** Every identity claim comes from a verified JWT or HttpOnly session cookie.

**Tasks:**
- **B1. Server Supabase client factory.** `src/lib/supabase/server.ts` exports `createServerClient(cookies)` and `createServiceClient()`. The service client is for post-verification use only. Uses `@supabase/ssr`. Before touching file layout, read the Next.js 16 route-handler cookie guide at `node_modules/next/dist/docs/`.
- **B2. JWT verification middleware.** `src/lib/auth/require-user.ts` returns `{ user, workspaceMember }` or throws `401`. `requireRole(...roles)` returns `403` on mismatch.
- **B3. Server-side auth code exchange.** New route `src/app/auth/callback/route.ts` consumes the Supabase code, exchanges it for a session, sets HttpOnly cookies, then redirects. Rewrite `src/app/auth/confirm/route.ts:49`, `src/app/auth/setup/page.tsx:30`, `src/app/auth/reset-password/page.tsx:30` to read session from cookies, not query params.
- **B4. Gate app access on active workspace membership.** Modify `src/lib/auth-context.tsx:61,67,132`: after sign-in, query `workspace_members`, block entry unless `status = 'active'`. Remove the auto-activate-on-login path.
- **B5. Logout hardening.** Clear cookies server-side, revoke refresh token via Supabase admin call.

**Files:**
- New: `src/lib/supabase/server.ts`, `src/lib/auth/require-user.ts`, `src/lib/auth/require-role.ts`, `src/app/auth/callback/route.ts`.
- Modify: `src/lib/auth-context.tsx`, `src/app/auth/confirm/route.ts`, `src/app/auth/setup/page.tsx`, `src/app/auth/reset-password/page.tsx`, `src/lib/supabaseClient.ts` (restrict to anon SELECT only), `middleware.ts`.
- Tests: `src/lib/auth/__tests__/require-user.test.ts`, integration test that fuzzes every `/api/*` route without a cookie and expects 401.

**Acceptance:**
- Manual: invite flow end to end produces no tokens in any URL.
- Integration: every privileged route with (a) no cookie returns 401, (b) valid user outside workspace returns 403, (c) valid member returns 200.
- Regression: password reset works via cookie flow.

**Rollback:** Flag `server_auth_v2`. If off, legacy paths still work during overlap. After 7 days clean, retire legacy.

**Addresses findings:** #2 (partial), #8, #9.

---

## 6. Workstream C, Tenant Model & Schema Reconciliation

**Goal:** Every domain row carries `workspace_id`. Schema matches the code. Role enum covers `superadmin`, `admin`, `approver`, `creative_director`, `editor`, `viewer`.

**Tasks:**
- **C1. Tenant tables.**
  ```sql
  create table workspaces (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    slug text unique not null,
    timezone text not null default 'Asia/Dubai',
    created_at timestamptz default now()
  );
  create table workspace_members (
    workspace_id uuid references workspaces(id) on delete cascade,
    user_id uuid references auth.users(id) on delete cascade,
    role text not null check (role in
      ('superadmin','admin','approver','creative_director','editor','viewer')),
    status text not null default 'pending' check (status in ('pending','active','suspended')),
    created_at timestamptz default now(),
    primary key (workspace_id, user_id)
  );
  ```
- **C2. Seed the baseline workspace.** Insert `Ten80Ten` with the current production timezone. Copy every existing `team_members` row into `workspace_members` keyed on `user_id`. `team_members` stays for read compatibility during overlap.
- **C3. `workspace_id` on every domain table.** Nullable at first on: `posts`, `media_assets`, `comments`, `activity_log`, `audit_log`, `notifications`, `signup_requests`, `placeholder_data`, `brand_playbook`. Backfill with the seed workspace id. Alter to `NOT NULL` + FK + index on `(workspace_id, ...)` for hot queries.
- **C4. Role enum reconciliation.** Add missing values to the `team_members.role` check constraint. Never drop old values.
- **C5. Column drift reconciliation.** Add `posts.source_vault`, `posts.asset_source`, `posts.license_file_id`, `posts.created_by`, `team_members.phone`, and any other column the code writes that the schema lacks. Create `signup_requests` if missing (per review line 49).
- **C6. RLS v2.** Drop each `FOR ALL USING (true) WITH CHECK (true)` policy. Replace with workspace-scoped policies:
  ```sql
  create policy "posts_read" on posts for select using (
    workspace_id in (
      select workspace_id from workspace_members
      where user_id = auth.uid() and status = 'active'
    )
  );
  create policy "posts_write" on posts for insert with check (
    workspace_id in (
      select workspace_id from workspace_members
      where user_id = auth.uid() and status = 'active'
        and role in ('superadmin','admin','approver','creative_director','editor')
    )
  );
  ```
  Repeat per table with the correct role set. Ship behind flag `rls_v2`. Keep the old permissive policies alongside in shadow mode (log without enforce) for 48 hours before enforcing.
- **C7. Typegen and import cleanup.** Run `npm run db:types`. Commit `src/lib/database.types.ts`. Update imports across `src/lib/pipeline-context.tsx:66`, the settings page, and every other consumer.
- **C8. Retire copy-paste SQL.** Move `supabase-schema.sql`, `supabase-setup-all.sql`, `supabase-audit-source-vault.sql` into `supabase/legacy/` with a `DEPRECATED_README.md` that points to `supabase/migrations/`. Do not delete during this phase (tombstone only).

**Files:**
- New: `supabase/migrations/0001_tenant_model.sql`, `0002_backfill_workspace.sql`, `0003_column_drift.sql`, `0004_rls_v2.sql`, `0005_role_enum.sql`.
- Modify: `src/lib/database.types.ts`, `src/lib/auth-context.tsx`, `src/lib/pipeline-context.tsx`, `src/components/pages/settings-page.tsx`.
- Move: legacy SQL files into `supabase/legacy/`.

**Acceptance:**
- `select count(*) from posts where workspace_id is null` returns 0. Same for every other domain table.
- Penetration test: valid anon-key client can only SELECT rows for its `auth.uid()` workspace. Insert or update without membership fails.
- Every page renders for existing users after the cutover.
- 48-hour shadow log shows zero legitimate policy denials before switch to enforce.

**Rollback:** `rls_v2` flag off reverts to permissive policies. Backfill migrations are additive with no column drops.

**Addresses findings:** #1, #5, #7.

---

## 7. Workstream D, Server-Authoritative APIs

**Goal:** No route handler trusts identity from the request body. Every pipeline transition runs through a server function with transition guards and optimistic locking.

**Tasks:**
- **D1. Privileged route rewrite.** For each of `invite/route.ts:59`, `approve-request/route.ts:31`, `remove-member/route.ts:29`, `resend-invite/route.ts:39`, `request-access/route.ts:22,49`, and any other `/api/team/*` endpoint: replace `requestedBy / reviewedBy` body fields with `const { user, workspaceMember } = await requireUser(req)`. Derive role from `workspace_members`. Apply `requireRole(...)` guards.
- **D2. Pipeline transition RPC.** New Postgres function:
  ```sql
  create or replace function rpc_transition_post(
    p_card_id uuid,
    p_from_stage text,
    p_to_stage text,
    p_expected_version int
  ) returns posts language plpgsql security definer as $$
  declare
    v_row posts;
    v_role text;
  begin
    select role into v_role from workspace_members
      where user_id = auth.uid() and status = 'active'
      limit 1;
    if v_role is null then
      raise exception 'forbidden' using errcode = 'P0001';
    end if;
    if not allowed_transition(v_role, p_from_stage, p_to_stage) then
      raise exception 'forbidden' using errcode = 'P0001';
    end if;
    update posts set
      current_stage = p_to_stage,
      version = version + 1,
      updated_at = now()
    where id = p_card_id
      and current_stage = p_from_stage
      and version = p_expected_version
    returning * into v_row;
    if v_row.id is null then
      raise exception 'stale_update' using errcode = 'P0002';
    end if;
    insert into activity_log(workspace_id, post_id, actor_user_id, action, metadata)
    values (v_row.workspace_id, v_row.id, auth.uid(), 'transition',
            jsonb_build_object('from', p_from_stage, 'to', p_to_stage));
    return v_row;
  end $$;
  ```
  Companion table `stage_transitions(role, from_stage, to_stage)` seeds the `allowed_transition` helper.
- **D3. Optimistic locking column.** Migration `0006_optimistic_locking.sql` adds `posts.version int not null default 0`.
- **D4. Client call sites.** Modify `src/lib/pipeline-context.tsx:226,341` to replace direct `.update(...).eq('id', cardId)` with `supabase.rpc('rpc_transition_post', ...)`. On `stale_update`, refetch and prompt the user.
- **D5. Review drawer.** Modify `src/components/asset-review-drawer.tsx:872`: route approval through the RPC, not a direct update. Block the approve button unless platform validators (H1) pass.
- **D6. Full audit of direct writes.** Grep every `.update(`, `.insert(`, and `.delete(` on sensitive tables. Anything that should go through a server boundary gets a replacement route or RPC.

**Files:**
- New: `supabase/migrations/0006_optimistic_locking.sql`, `0007_rpc_transition_post.sql`, `0008_stage_transitions.sql`.
- Modify: all `/api/team/*` routes, `src/lib/pipeline-context.tsx`, `src/components/asset-review-drawer.tsx`, `src/app/api/team/request-access/route.ts`, any other `.update` call site that D6 surfaces.
- Tests: RPC tests via `supabase test db` or integration harness.

**Acceptance:**
- Two concurrent transitions from the same `from_stage`: one succeeds, one returns `stale_update`.
- Non-approver role calling approval RPC returns `forbidden`.
- No `/api/team/*` route reads actor identity from the body.
- Grep for `requestedBy` or `reviewedBy` in `src/app/api/` returns zero.

**Rollback:** Flag `server_rpc_writes`. If off, client falls back to direct updates for one release window only.

**Addresses findings:** #2 (completes), #6.

---

## 8. Workstream E, Drive Security Boundary

**Goal:** No unauthenticated caller reads or writes the company Drive.

**Tasks:**
- **E1. Auth on every `/api/drive/*` route.** Wrap `proxy-upload/route.ts:21`, `upload/route.ts:20`, `finalize/route.ts:6`, `stream/route.ts:19` with `requireUser` + workspace-member check.
- **E2. Ownership check on stream and finalize.** Look up `media_assets` row by Drive file id, verify `workspace_id` matches the caller's workspace. Return 403 on mismatch.
- **E3. Signed-URL proxy.** Remove `anyone` Drive permissions on company files. Replace with `/api/media/signed-url?asset_id=...` that returns a short-lived (10 minute) server-proxied URL. The proxy streams from Drive using the service account, after checking ownership. For n8n's need to read media during publish, issue a separate `publish_token` scoped to a single `publish_job_id` (see F).
- **E4. Upload limits.** Per-route hard cap on file size, mime allowlist, per-workspace per-day quota stored as a Postgres counter in `rate_limit_buckets`.
- **E5. Rate limiting middleware.** Shared with G3. Postgres-backed token bucket keyed by `(scope, ip, user_id)` so Vercel Hobby does not need Upstash.

**Files:**
- Modify: all four `src/app/api/drive/*` routes.
- New: `src/app/api/media/signed-url/route.ts`, `src/lib/rate-limit.ts`, `supabase/migrations/0009_rate_limit_buckets.sql`.
- Tests: e2e that anonymous calls return 401 and cross-workspace calls return 403.

**Acceptance:**
- Public Drive permissions audit shows no `anyone` grants on owned files.
- Anonymous curl against every Drive route returns 401.
- Signed URLs expire after 10 minutes.
- Cross-workspace ownership check blocks access in integration test.

**Rollback:** Flag `drive_auth_v2`. Legacy routes stay in `src/legacy/drive/` during overlap.

**Addresses findings:** #3, and partial coverage of #12 and #14.

---

## 9. Workstream F, Publishing Infrastructure

**Goal:** A post scheduled for any platform publishes exactly once, is visible in ops, and is recoverable from any failure.

**Tasks:**
- **F1. Ledger schema.**
  ```sql
  create table oauth_accounts (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references workspaces(id),
    platform text not null check (platform in
      ('instagram','facebook','linkedin','x','tiktok','youtube')),
    external_account_id text not null,
    display_name text,
    access_token_ciphertext bytea not null,
    refresh_token_ciphertext bytea,
    expires_at timestamptz,
    scopes text[],
    created_at timestamptz default now(),
    unique (workspace_id, platform, external_account_id)
  );
  create table publish_jobs (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references workspaces(id),
    post_id uuid not null references posts(id),
    scheduled_at timestamptz not null,
    state text not null default 'pending'
      check (state in ('pending','claimed','running','partial','succeeded','failed','dead')),
    claim_expires_at timestamptz,
    worker_id text,
    correlation_id uuid not null default gen_random_uuid(),
    created_at timestamptz default now(),
    updated_at timestamptz default now()
  );
  create unique index publish_jobs_post_idx on publish_jobs(post_id);
  create table platform_publish_attempts (
    id uuid primary key default gen_random_uuid(),
    job_id uuid not null references publish_jobs(id) on delete cascade,
    platform text not null,
    oauth_account_id uuid references oauth_accounts(id),
    idempotency_key text not null,
    state text not null default 'pending',
    external_post_id text,
    response_payload jsonb,
    error_code text,
    error_message text,
    attempt_count int not null default 0,
    next_retry_at timestamptz,
    created_at timestamptz default now(),
    updated_at timestamptz default now(),
    unique (job_id, platform),
    unique (job_id, idempotency_key)
  );
  create table dead_letter_jobs (
    id uuid primary key default gen_random_uuid(),
    origin_job_id uuid references publish_jobs(id),
    payload jsonb not null,
    reason text not null,
    created_at timestamptz default now()
  );
  ```
- **F2. Atomic claim function.**
  ```sql
  create or replace function claim_publish_job(p_worker text, p_horizon int default 30)
  returns setof publish_jobs language plpgsql as $$
  begin
    return query
    update publish_jobs pj set
      state = 'claimed',
      worker_id = p_worker,
      claim_expires_at = now() + make_interval(secs => p_horizon),
      updated_at = now()
    where pj.id = (
      select id from publish_jobs
      where state = 'pending' and scheduled_at <= now()
      order by scheduled_at
      for update skip locked
      limit 1
    )
    returning *;
  end $$;
  ```
- **F3. Worker contract.** n8n (or a Next.js cron route) calls `claim_publish_job`, receives 0 or 1 job. For each attempt: call the platform API with the idempotency key, write the result back via `/api/publish/attempt/:key`, advance state or schedule `next_retry_at` with exponential backoff. After 5 attempts, the job moves to `dead` and inserts a `dead_letter_jobs` row.
- **F4. Platform validator layer.** `src/lib/platforms/<platform>.ts` per platform, each exporting `validate({ caption, media, thread, hashtags })` returning `{ ok, errors }`. Every module encodes max caption length, media type/aspect/size/duration, carousel count, hashtag rules, thread rules. Called at approval time and again inside the worker before every attempt.
- **F5. Timezone-correct scheduling.** Migration adds `posts.scheduled_at timestamptz` and `posts.scheduled_timezone text`. Backfill from existing `scheduled_date` + `scheduled_time` using the workspace default timezone. Keep the old columns as read-only until the cleanup sprint. Modify `src/components/create-post-modal.tsx:337` to capture timezone and store TIMESTAMPTZ. Modify `src/app/api/health/deep-check/route.ts:56` to compare against TIMESTAMPTZ, not server ISO date.
- **F6. OAuth account model.** New `Settings → Connected Accounts` page runs the OAuth code flow via a server route. Tokens encrypted at rest using `pgcrypto` (pick AES-256 GCM with a project key stored in Supabase Vault). Refresh-token rotation cron runs daily.
- **F7. n8n contract redesign.** n8n workflow polls `/api/publish/claim` (authenticated by a shared secret tied to a dedicated `n8n-worker` system user), receives a job, posts results to `/api/publish/attempt/:idempotency_key`. Remove any business logic from n8n. The existing `n8n-health-check.json` is untouched (v1.0 lock).
- **F8. Claim-expiry watchdog.** Cron every minute resets `claimed` jobs whose `claim_expires_at < now()` back to `pending`. Recovers crashed workers automatically.
- **F9. Ops visibility.** New Settings → Publishing panel showing per-job rows, state, attempts, external ids, errors, correlation id. Log lines include `correlation_id`.

**Files:**
- New migrations: `0010_publish_ledger.sql`, `0011_oauth_accounts.sql`, `0012_publish_rpcs.sql`, `0013_scheduled_at_tstz.sql`.
- New code: `src/lib/platforms/{instagram,facebook,linkedin,x,tiktok,youtube,validator}.ts`, `src/app/api/publish/claim/route.ts`, `src/app/api/publish/attempt/[key]/route.ts`, `src/app/api/publish/watchdog/route.ts`, `src/components/pages/publishing-ops-page.tsx`.
- Modify: `src/lib/types.ts:8`, `src/components/create-post-modal.tsx:121,177,329,337`, `src/components/asset-review-drawer.tsx:872`, `src/app/api/health/deep-check/route.ts:56`, `src/components/pages/settings-page.tsx:691` (replace hardcoded status).

**Acceptance:**
- A post scheduled for 5 platforms produces 5 `platform_publish_attempts` rows.
- Idempotency: calling the attempt endpoint twice with the same key returns the same external id and does not post twice. Enforced by the `(job_id, idempotency_key)` unique index plus platform idempotency headers where the API supports them.
- Chaos test: kill the worker mid-claim, the watchdog reclaims within 1 minute.
- Timezone test: a post scheduled for "Mon 9 AM Asia/Dubai" fires at the correct UTC instant across a DST flip.
- DLQ test: a platform API that returns 500 five times lands in `dead_letter_jobs` and stops retrying.

**Rollback:** Flag `publish_v2`. Since nothing is committed today, rollback = flag off, no data loss.

**Addresses findings:** #4, partial #10, partial #11, partial #16.

---

## 10. Workstream G, Data Integrity & Hygiene

**Goal:** Close every medium-severity leakage, injection, or blind-spot vector.

**Tasks:**
- **G1. Media lifecycle.** New atomic upload flow: `POST /api/media/upload` creates a `media_assets` row in `pending`, returns a signed Drive upload URL. `POST /api/media/finalize` flips to `ready` after the client confirms. `DELETE /api/media/:id` deletes the DB row and the Drive object together. Reaper cron deletes `pending` rows older than 60 minutes whose post parent is null, along with the Drive object.
- **G2. Email HTML escape.** Audit `src/app/api/notifications/mention/route.ts:70,80` and `src/app/api/notifications/revision/route.ts:79,84`. Route every user-controlled field through the existing `esc()` helper. New `src/lib/email/template.ts` wraps all templates with a `safeEmail()` function; an ESLint rule forbids raw string concat in `/api/notifications/*`.
- **G3. Rate limiting.** `src/lib/rate-limit.ts` with Postgres-backed token buckets keyed by `(scope, key)`. Apply to `forgot-password/route.ts:14`, `request-access/route.ts:22`, `mention/route.ts:29`, `revision`, `drive/*`, `media/*`, `auth/callback`. Defaults: 5/min per IP, 20/hour per IP, 3/hour per account for password reset.
- **G4. Abuse events log.** New table `abuse_events(id, ip, user_id, route, reason, metadata, created_at)` for post-mortem visibility.
- **G5. Audit schema redesign.** Migration `0014_audit_v2.sql` creates `audit_log_v2(id, workspace_id, actor_user_id, actor_role, entity_type, entity_id, action, correlation_id, metadata, created_at)`. `post_id` becomes optional and moves into `entity_id` generically. New helper `writeAudit()` in `src/lib/audit.ts` only runs from server routes and derives `actor_user_id` from the verified session. Best-effort backfill copies existing audit rows into v2. The v1 table is renamed `audit_log_legacy` and kept permanently (per the never-drop-audit rule). Modify `src/app/api/team/invite/route.ts:167`, `src/components/pages/settings-page.tsx:317`, every other audit write site, to use the helper.
- **G6. Real integration health.** New `src/app/api/health/integrations/route.ts` runs live probes: Supabase ping, n8n webhook ping, Drive quota check, SMTP `EHLO` test, publish-worker heartbeat. Modify `src/components/pages/settings-page.tsx:641,691` to render from that endpoint with green/yellow/red plus last-probe timestamp, instead of hardcoded "connected".

**Files:**
- New migrations: `0014_audit_v2.sql`, `0015_abuse_events.sql`.
- New code: `src/lib/rate-limit.ts`, `src/lib/email/template.ts`, `src/app/api/health/integrations/route.ts`, `src/app/api/media/upload/route.ts`, `src/app/api/media/finalize/route.ts`, `src/app/api/media/[id]/route.ts`, `src/app/api/media/reaper/route.ts`.
- Modify: `src/app/api/notifications/mention/route.ts`, `src/app/api/notifications/revision/route.ts`, `src/lib/audit.ts`, `src/components/pages/settings-page.tsx`, `src/components/pages/media-page.tsx:131`, `src/components/create-post-modal.tsx:121,177`, `src/app/api/team/invite/route.ts:167`.

**Acceptance:**
- Email injection test: a post title `<img src=x onerror=alert(1)>` renders as escaped text in the resulting email.
- Rate-limit test: 20 `forgot-password` calls from the same IP in 60 seconds return 429 after the threshold.
- Orphan test: upload a file, kill the browser, the reaper deletes the Drive object within 90 minutes.
- Audit test: an admin action from a server route writes an `audit_log_v2` row with the verified `actor_user_id` and correlation id.
- Health test: stopping n8n shows yellow in the Settings card within one probe cycle.

**Rollback:** Flags `media_v2` and `audit_v2` (writes go to both tables during overlap). Others are additive.

**Addresses findings:** #12, #13, #14, #15, #16.

---

## 11. Workstream H, Content Correctness

**Goal:** No post reaches "approved/scheduled" if any selected platform cannot accept it.

**Tasks:**
- **H1. Platform validator integration.** Each platform module from F4 exports `validate()`. Called from `src/components/create-post-modal.tsx:329,337` on field change (debounced) and on save.
- **H2. Approval gate.** Modify `src/components/asset-review-drawer.tsx:872` to block the approve RPC unless all selected platforms pass validation. Show per-platform error list.
- **H3. Timezone-correct UI.** Scheduler widget captures workspace timezone. Storage is TIMESTAMPTZ. Display times in both client tz and workspace tz.
- **H4. Per-platform preview.** Small mockup per platform with character count, hashtag count, media thumbnails, and a warning chip if validation fails.

**Files:**
- Modify: `src/components/create-post-modal.tsx`, `src/components/asset-review-drawer.tsx`, `src/lib/types.ts:8`.
- New: `src/components/platform-preview.tsx`.

**Acceptance:**
- A LinkedIn-only post longer than 3000 characters cannot be approved.
- An IG Reel upload with a 1:1 aspect ratio cannot be approved.
- Scheduling "Mon 9 AM Asia/Dubai" produces a `scheduled_at` that equals the correct UTC instant across a DST flip.

**Rollback:** Flag `content_validation_v2`. If off, validation warnings appear but do not block save (soft mode).

**Addresses findings:** completes #10 and #11.

---

## 12. Acceptance Gates (Go / No-Go)

Before any flag flips to production-on:

1. `npm run lint && npm run typecheck && npm run db:diff && npm run test` passes.
2. RLS penetration: anon-key SELECT to every table without auth returns 0 rows. 48-hour shadow log shows no legitimate denials.
3. API fuzz: every `/api/*` route called without a cookie returns 401, except `/api/health/*` and `/api/auth/callback`.
4. End-to-end: invite a new user, accept the invite, land in the app gated to the correct workspace, approve a post, see all 5 platform attempts succeed against a staging mock.
5. Timezone regression passes across a DST boundary.
6. Media orphan reaper runs clean on staging for 24 hours.
7. Health dashboard shows green for every integration or a documented reason why not.
8. Traceability matrix (§15) has every finding linked to a closing commit.

---

## 13. Rollback Strategy

- Every workstream ships behind a feature flag (§2 ADR-7).
- Database migrations are additive. New tables, new columns (nullable first, `NOT NULL` after backfill), new policies alongside old. No `DROP TABLE`, no `DROP COLUMN` in this phase.
- Legacy code lives in `src/legacy/` during the 30-day overlap. Flag off = legacy path.
- Rollback of a single workstream = flip the flag off. No revert commit required.
- Exception: A4 (secret rotation) cannot be rolled back. Practice in staging, deploy during low traffic, keep previous secret accessible for 15 minutes.

---

## 14. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| RLS v2 locks out a legitimate role | Medium | High | 48-hour shadow mode before enforcing. Staging dry-run with every role. |
| Backfill on large tables is slow | Low | Medium | Batch 1000 rows. Under 60s for current row counts. |
| n8n contract change breaks the health workflow | Low | Low | Health workflow is not touched. Only publish flows change. |
| OAuth token encryption key rotation | Medium | High | Documented rotation plan. Re-encryption job tested on staging. Keep old key accessible for 30 days. |
| Publish worker race across two Vercel instances | High | Critical | `SKIP LOCKED` claim + unique index on `(post_id)`. Chaos test before go-live. |
| Email injection test misses a field | Medium | Medium | ESLint rule forbids raw concat in `/api/notifications/*`. All templates go through `safeEmail()`. |
| Forgot-password rate limit blocks real users | Low | Medium | Per-IP + per-account exponential cooldown, not a hard wall. Admin override path. |
| Lint fix churn breaks UI | Medium | Medium | Playwright smoke against 7 hot paths (dashboard, pipeline, review drawer, create post, media, settings, team) before merging A3. |
| Schema drift discovered mid-cutover | Medium | Medium | A1 generates types from the live schema. C7 imports the new types everywhere. CI blocks drift after that. |
| Hobby plan cron frequency cap (daily only on Vercel Hobby) | High | High | Run the watchdog as a Supabase cron (pg_cron) instead of Vercel cron. Shared Postgres = right place for the lock anyway. |

---

## 15. Traceability Matrix

| # | Severity | Finding | Workstream(s) |
|---|---|---|---|
| 1 | CRITICAL | RLS permissive + public anon key | C6 |
| 2 | CRITICAL | Service-role APIs trust body identity | B2, D1 |
| 3 | CRITICAL | Public Drive boundary | E1, E2, E3 |
| 4 | CRITICAL | No publish queue, ledger, or OAuth store | F1 through F9 |
| 5 | HIGH | Schema/code drift | A1, C5, C7 |
| 6 | HIGH | Non-atomic pipeline transitions | D2, D3, D4, D5 |
| 7 | HIGH | No tenant model | C1, C2, C3 |
| 8 | HIGH | Login auto-activates, no workspace gate | B4 |
| 9 | HIGH | Tokens via URL params | B3 |
| 10 | MEDIUM | Scheduling without timezone | F5, H3 |
| 11 | MEDIUM | No per-platform validation | F4, H1, H2 |
| 12 | MEDIUM | Media orphan leaks | E3, G1 |
| 13 | MEDIUM | Email HTML injection | G2 |
| 14 | MEDIUM | No rate limiting on public routes | E5, G3, G4 |
| 15 | MEDIUM | Audit schema mismatch | G5 |
| 16 | MEDIUM | Hardcoded "connected" integration status | G6, F9 |
| 17 | LOW | 108 ESLint errors | A3 |

Note: there are 17 distinct findings. The review labels 4 critical / 5 high / 7 medium / 1 low (17 total). My earlier mention of "18 issues" in the brief was an off-by-one. Every row above is covered.

---

## 16. Out of Scope (Explicit)

- Rewriting the UI layer. The v1.0 lock stays.
- Changing the n8n health-check workflow (immutable).
- Migrating off Supabase.
- Changing hosting provider.
- Adding a new ORM. Direct Supabase + migration SQL stays.
- Replacing Google Drive with S3 or R2 in this phase.

Revisit after the cleanup sprint, not during this remediation.

---

## 17. First 72 Hours

1. Merge A1 through A6 (foundation). Unblocks every other workstream and makes CI trustworthy.
2. Start B and C in parallel on separate branches from the new baseline.
3. Dry-run the C migrations on a Supabase branch database.
4. Shadow-log RLS v2 decisions for 48 hours.
5. Run the Playwright hot-path smoke after A3 lands.

Then proceed through D, E, F, G, H in dependency order.

---

## 18. Approval Needed

This plan requires explicit sign-off on:

- The workspace-first tenant model (ADR-2).
- The publish-ledger shape (ADR-3).
- The cookie-based auth flow (ADR-6).
- The 30-day legacy overlap window before cleanup.
- Running the publish watchdog on Supabase pg_cron instead of Vercel cron.

Once approved, execution proceeds through the workstream dependency graph without further gating until the go/no-go in §12.

---

## 19. One-Liner for the Team

Close 17 findings in one gated remediation phase: lock down auth, add a workspace tenant model, rewrite RLS, put every privileged write behind a verified JWT, build a real publish ledger with idempotency and a dead-letter queue, harden Drive, fix the email injection, replace the hardcoded "connected" cards with real probes, and land the missing 108 lint fixes, all behind feature flags with a 30-day legacy overlap.
