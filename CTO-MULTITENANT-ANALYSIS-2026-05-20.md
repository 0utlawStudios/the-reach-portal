# CTO Brief: Ten80Ten SMM Portal — What It Is, What It Isn't, and How To Make It Multi-Tenant

**Date:** 2026-05-20
**Author:** CTO desk (Aldridge + Claude Opus 4.7)
**Status:** Strategy + execution plan. Read before any decision about Ten80Ten Content Engine going to second tenant or third-party clients.
**Local path:** `/Users/ace/Documents/CURSOR MAIN/ten80ten-smm-portal`
**Live URL:** smm.ten80ten.com

---

## 0. Why This Document Exists

The portal was built for one workspace (Ten80Ten itself). Every line of the iron-law architecture was written around a single baseline UUID. Now the question is: can this become a product we sell, white-label, or run for other agencies, without rewriting from scratch?

Short answer: yes, and most of the foundation is already there. The DB knows about workspaces. RLS gates every table on workspace membership. n8n was deliberately built with per-client secret baking. What is missing is the workspace selector, per-tenant branding pipeline, billing, and the operational discipline to safely run more than one customer on the same database.

This document covers:

1. What the portal actually is, in production right now
2. What it is not (so we stop pitching what it can't do)
3. Architecture today, end to end
4. Direct competitor comparison
5. Three real multi-tenant paths (shared, schema-per-tenant, DB-per-tenant)
6. The recommended path with concrete migrations and route changes
7. White-label plan, billing plan, observability plan
8. Risk register, open questions, decision matrix

---

## 1. What Ten80Ten SMM Portal IS

### 1.1 The product, in one paragraph

A team-first social media content engine. Posts move through a kanban pipeline (Ideas → Awaiting Approval → Revision Needed → Approved & Scheduled → Published) with a hard rule baked into the database that no post can vanish, no post can be marked posted by a human, and every state change is audited. An automated n8n publisher claims approved cards every minute, hits each platform's Graph API directly, and writes back the published URLs. A Creator Studio module generates carousel briefs and AI imagery via gpt-image-2. Five platforms ship: Instagram, TikTok, Facebook, YouTube, LinkedIn.

### 1.2 What's actually in the codebase today

| Layer | What's there | Files |
|---|---|---|
| App | Next.js 16.2 App Router, React 19.2, Turbopack, TypeScript strict | `src/app`, `next.config.ts` |
| Auth | Supabase Auth, bearer JWT, no middleware (header-bearer pattern) | `src/lib/auth-context.tsx`, `src/lib/auth/require.ts` |
| DB | Postgres on Supabase (`lczmgquuzuqhalasjnip`), 27 migrations 0000-0026 | `supabase/migrations` |
| RLS | `is_active_workspace_member(workspace_id, allowed_roles)` on every domain table | `0007_rls_v2.sql`, `0018_team_members_rls.sql` |
| Realtime | Supabase Realtime subscriptions for posts, media_assets, presence | `pipeline-context.tsx`, `use-presence.tsx` |
| Storage | Google Drive service account (NOT Supabase Storage). Drive folder per asset. | `src/lib/google-drive.ts`, `/api/drive/*` |
| Publisher | n8n V4 workflow (`n8n/ten80ten-auto-publisher-v4.json`), claim-based, 1 min trigger | n8n |
| AI | OpenAI gpt-image-2 + GPT-5 for caption/brief, $3/row cap, allowlist-gated | `/api/ai/*`, `src/components/pages/studio-page.tsx` |
| Email | Gmail SMTP via nodemailer, branded HTML templates | `/api/notifications/*` |
| PWA | Manifest, SW v3 (`/public/sw.js`), iOS Safari covered | `src/app/layout.tsx`, `public/manifest.json` |

### 1.3 The five iron laws (from `AGENTS.md`)

These are not style guides. They are constraints encoded in DB triggers and tested in production:

1. **Posts never disappear.** Migration `0015_post_safety.sql` adds three triggers: pre-delete audit, hard-block on delete of `approved_scheduled` or `posted`, audit on every stage change. Empty array from a SELECT is a valid result and never falls back to placeholder data.
2. **workspace_id is mandatory on every insert.** No defaults, no nullable column. Code must fall back to baseline UUID, never omit the field.
3. **Audit writes go through `record_audit_event` RPC.** The legacy `post_audit_logs` table has no INSERT RLS policy for authenticated users by design.
4. **RLS gates everything via `is_active_workspace_member`.** No user in `workspace_members` with `status='active'` means no access, period.
5. **`isValidUuid()` guard before every Supabase op on a card id.** Card ids start as temp timestamp strings until the INSERT resolves.

### 1.4 The publisher contract (migration 0026)

This is the most important piece nobody outside the build understands. The DB trigger `block_manual_posted_transition` rejects any UPDATE that flips `stage='posted'` unless the caller is `postgres`, `service_role`, or `supabase_admin` AND `posted_at IS NOT NULL`. That means a human dragging a card to Posted from the kanban will hit error code `POSTED_LOCKDOWN` at the database. Only the n8n auto-publisher, running under service role, can mark a post live, and only after a real platform API returned a post URL.

This single trigger is the difference between "social media planning tool" and "audit-grade publishing system".

### 1.5 Stack snapshot

```
Next.js 16.2.0   App Router, RSC where it helps, client components where state lives
React 19.2.4     Strict mode, react-hooks/purity + set-state-in-effect enforced
Supabase JS 2.99 Bearer JWT only, no cookie auth, no middleware
@dnd-kit          Drag-and-drop for the kanban
framer-motion     Page transitions, modal animations
nodemailer        Gmail SMTP for branded notifications
google-auth-library  Service account for Drive uploads
shadcn-style UI   Tailwind 4, base-ui/react, lucide-react icons
n8n (separate)    Auto-publisher V4, claim-based state machine
```

---

## 2. What This Product IS NOT

Equally important. Selling around these gaps wastes everyone's time.

### 2.1 NOT a generic scheduling tool

Buffer, Later, Hootsuite, Publer, SocialBee all ship "calendar with publish button". This portal forces an approval workflow. If your customer wants one-person, post-now scheduling, this is overkill. Their job is done in three clicks; here it takes four kanban moves and an approval gate. That gate is the value, not the bug.

### 2.2 NOT analytics-first

There is no follower-growth chart, no reach analysis, no best-time-to-post engine, no UTM builder, no competitor benchmark. The dashboard reports pipeline counts and stage throughput, not platform-side performance. This is a content-production system, not a marketing analytics suite. Bolt-on later if needed, but it's not the spine.

### 2.3 NOT multi-tenant today

Single baseline workspace UUID `00000000-0000-0000-0000-000000000001` is hardcoded in nine places across `src/`. The `/api/workspace/provision` route writes every new user into that workspace by default. The `team_members` table has no `workspace_id` column at all (migration 0018 hard-codes the baseline in its RLS policies). Brand playbook uses a singleton id. Email templates carry the Ten80Ten logo URL inline.

The DB schema knows about workspaces. The app does not.

### 2.4 NOT account-of-record for social tokens

OAuth tokens for Facebook, Instagram, LinkedIn, YouTube, TikTok do not live in this database. They live as environment variables baked into the n8n workflow nodes. There is an `oauth_accounts` table in migration 0010 that was never wired up. Moving secrets out of n8n env into Supabase Vault is on the multi-tenant critical path.

### 2.5 NOT HIPAA / SOC2 today

Audit logs are append-only at the policy layer but the DB itself is shared with no schema-level isolation between tenants. No BAA with Supabase. No encryption-at-rest beyond Postgres default. No vendor risk register. No customer-facing data residency choices. Anyone selling this into healthcare or finance is selling a future, not a present.

### 2.6 NOT a CRM, DAM, or full agency OS

Posts have media, media has a folder string, that's the depth of the asset library. No asset versioning, no asset rights tracking past a single `licenseFileId`, no client portal for non-team-members to review, no client billing inside the product, no time tracking. Agency competitors (Sendible, AgencyAnalytics, ContentStudio) include those. We don't.

### 2.7 NOT Meta-ready (today)

Aldridge personally cannot create a Meta Developer App because of a 2019 ads ban that cascaded to developer surface in 2026. Until that unblocks or a clean team profile creates the app, the Meta Graph API publisher path is theoretical. LinkedIn and YouTube work. Facebook/Instagram do not. See [[reference_aldridge_meta_ads_ban]].

---

## 3. Architecture Today (Single-Tenant)

### 3.1 Request lifecycle

```
Browser
  │
  ├─ /sw.js (Service Worker v3)   bypasses HTML navigation, caches static only
  │
  ├─ /api/workspace/provision     GET, Bearer JWT
  │   service-role client checks workspace_members,
  │   self-heals by inserting into baseline workspace
  │   returns { workspaceId }
  │
  ├─ supabase.from("posts").select() with anon JWT
  │   RLS policy posts_select_v2:
  │     is_active_workspace_member(workspace_id, null) = true
  │   filters to rows the user can see
  │
  └─ Realtime channel "posts-{workspaceId}"
      INSERT / UPDATE / DELETE pushed to all sessions
```

The provision route is the seam where multi-tenancy will live. Today it is hardcoded to one workspace. Tomorrow it resolves a workspace by subdomain, custom domain, or user-selector cookie.

### 3.2 Schema, the parts that matter

```
workspaces (id, name, slug, timezone, created_at, updated_at)
   ↑
workspace_members (workspace_id, user_id, role, status)
   ↑
posts (id, workspace_id NOT NULL, stage, ..., posted_at, posted_urls)
media_assets (id, workspace_id NOT NULL, ...)
post_comments (id, workspace_id NOT NULL, ...)
brand_playbook (id, workspace_id NOT NULL, data jsonb, ...)
publish_jobs (id, post_id, state, attempts, last_error, ...)
platform_publish_attempts (id, publish_job_id, platform, state, external_post_id)
audit_log_v2 (id, workspace_id NOT NULL, actor_user_id, entity_type, action, metadata)
user_presence (user_id, last_seen_at, last_active_at) — no workspace_id (single global)
team_members (id, name, email, role, ...) — no workspace_id today
```

Tables that already carry workspace_id: posts, media_assets, post_comments, post_audit_logs, brand_playbook (migration 0004). Tables that don't: team_members, user_presence, feature_flags, rate_limit_buckets, publish_jobs, oauth_accounts. Some of those are global by design; some need fixing.

### 3.3 Auth surface

- Supabase Auth, email+password
- No Google OAuth (Aldridge prefers a controlled allowlist)
- No middleware. Every server route reads `Authorization: Bearer <jwt>` and validates with `admin.auth.getUser(token)`
- `requireBearerTeamRole(req, ['admin','superadmin'])` is the canonical gate

The lack of middleware is a deliberate choice (single-tenant single-domain), and the reason there is no host-based routing today. Adding subdomain-based tenant resolution will introduce middleware. That is a real architecture decision, not a one-liner.

### 3.4 Branding, where it's hardcoded

Counted by grep:

- `src/app/layout.tsx`: metadataBase, title, description, OG image, manifest path, apple-touch-icon. All Ten80Ten-literal.
- `src/components/app-shell.tsx` line 79: `Ten80Ten Social Media Management Platform © 2026` footer
- `src/components/app-shell.tsx` line 194: `<RawImage src="/ten80ten-logo.png" ...>` sidebar logo
- `/public/manifest.json`, `/public/ten80ten-logo.png`, `/public/og-image.png`, `/public/icon-192.png` — all on-disk
- `src/app/api/notifications/*/route.ts`: branded email HTML, logo CID, `https://smm.ten80ten.com/ten80ten-logo.png` (per AGENTS.md rule 6, the product name "Content Engine" is enforced here)
- Auth redirect URLs in Supabase project: `smm.ten80ten.com` only

For a second tenant, every single one of these needs a workspace-aware variant. That's 30-40 file edits, not 3.

### 3.5 Tenant boundary today (full audit)

| Boundary | Status | Risk |
|---|---|---|
| Posts row-level | Workspace_id + RLS | Solid |
| Media assets row-level | Workspace_id + RLS | Solid |
| Comments row-level | Workspace_id + RLS | Solid |
| Brand playbook row-level | Workspace_id + RLS | Solid, but UI assumes singleton id |
| Audit log row-level | Workspace_id + RLS | Solid (audit_log_v2) |
| Team members table | No workspace_id, RLS hardcoded to baseline | Breaks at second tenant |
| Publish jobs | post_id FK to posts which has workspace_id | OK indirectly, but no direct policy |
| n8n workflow | Single workflow, single set of platform tokens | Breaks at second tenant unless cloned |
| Google Drive | Single service account, single root folder | Breaks at second tenant unless folders are namespaced |
| Email sender | aldridge@ten80ten.com Gmail SMTP | Breaks branding at second tenant |
| Storage bucket | `avatars` bucket public-read, no path scoping | Avatars cross-readable |
| Realtime channels | `posts-{workspaceId}`, `presence-{workspaceId}` | Already keyed by workspaceId, fine |
| OAuth tokens | n8n env vars only, oauth_accounts table empty | Breaks at second tenant unless secrets are tenant-scoped |
| Workspace UUID baseline | Hardcoded in 9 src files + 1 RLS migration | Hard rewrite required |

This is the actual punch list for going multi-tenant. Everything orange or red here is a migration ticket.

---

## 4. Competitor Comparison

### 4.1 Direct competitors (kanban + approval first)

**Planable** is the closest thing on the market. They built it for agencies, run a kanban view, support comment-based approval, and charge $11-39/seat/month. Their differentiator is multi-channel preview and grid-view planning. Their weakness is the publishing engine — they rely on third-party APIs and have publishing delays customers complain about publicly.

This portal beats Planable on:
- DB-level publish lockdown (no human can fake a posted status)
- Iron-law audit (every move is logged at trigger level)
- Real claim-based queue with retry/dead-letter
- AI Creator Studio (Planable does not bundle generation)

Planable beats this portal on:
- Multi-tenant from day one
- Stripe billing built-in
- Workspace-per-client UI polish
- Mobile app (real native, not PWA)
- Approval round-trip with external stakeholders (clients can comment without being team members)

**Loomly** — calendar-first, AI tips, $42-359/mo. Lighter approval. Not really a competitor at the agency tier; they sell to SMB.

**ContentStudio** — content curation + AI + auto-publish, $25-99/mo, focus on recycling and Discovery. Different product space.

### 4.2 Adjacent competitors (scheduling-first)

**Buffer** — $0-100/mo, simplest UX. No approval pipeline. Owned by their pricing and brand.
**Later** — $25-80/mo, calendar-first, IG-heavy, link-in-bio. Not workflow.
**Hootsuite** — $99-739/mo, enterprise tier with approval but bloated. Customers actively churning.
**Sprout Social** — $249-499/mo, analytics-heavy, enterprise sales motion.
**Publer** — $12-30/mo, fast, decent UI, no real approval pipeline.

This portal does not compete in the scheduling-first segment unless we ship a "post now" mode that bypasses the pipeline. Easy to ship, but it dilutes the positioning.

### 4.3 Agency-OS competitors

**Sendible** — $29-240/mo, full agency suite with client portals, reports, approval. Has a real moat in client-portal UX. Closest agency-tier feature parity to where Ten80Ten Portal could go.
**AgencyAnalytics** — analytics-first, $79-419/mo. Mostly reporting.
**Cloud Campaign** — white-label-first, $349-2400/mo. Agency-only.

If multi-tenant ships well, Sendible and Cloud Campaign are the comparables, not Buffer.

### 4.4 AI content competitors

**Predis.ai** — $32-87/mo, generates posts from a URL. Lightweight.
**Ocoya** — $19-159/mo, ChatGPT inside, e-commerce focus.
**FeedHive** — $19-99/mo, recycling-focused.

The portal's Creator Studio is comparable in capability but currently single-tenant and bound to a $3/row cap. With Stripe metering, this becomes a $19-49/mo upsell.

### 4.5 Where this product wins, where it loses, on day-one of multi-tenant

| Dimension | Win / Lose | Why |
|---|---|---|
| Approval workflow | Win | Iron-law trigger discipline beats every kanban competitor |
| Audit trail | Win | DB-level immutable + actor-resolved view |
| Auto-publisher safety | Win | Lockdown trigger + retry + DLQ |
| AI generation | Tie | Comparable feature set, narrower model coverage |
| Mobile UX | Lose | PWA only, no native app |
| Onboarding time | Lose | Today takes a Slack message; competitors take 60 seconds |
| Stripe billing | Lose | None |
| Client portal (external reviewers) | Lose | No magic-link guest reviewers |
| Analytics | Lose | Effectively absent |
| Templates / library | Lose | No reusable post templates |
| Subdomain per client | Lose | No tenant-routing today |
| White-label | Lose | Hardcoded branding |

### 4.6 Honest market position

This portal today is "Planable, but engineered like a payments system, and only Ten80Ten can use it." Multi-tenant turns it into "agency content engine with audit-grade publish lockdown and bundled AI". Pricing tier: $39-79/seat/mo for agency, $19/seat/mo for SMB. The moat is the engineering discipline visible to a buyer who has been burned by a Planable publish failure.

---

## 5. Three Multi-Tenant Paths

### 5.1 Path A — Shared DB, Shared Schema, RLS-isolated (POOL)

Every tenant lives in the same Postgres database, same tables, separated by `workspace_id` and gated by RLS. This is what the foundation already assumes.

**Pros**
- Lowest cost (one Supabase project, one set of pooled connections)
- Migrations apply once across all tenants
- Realtime, presence, RPC all keep working unchanged
- ~80% of the schema work is already done (workspace_id on domain tables, `is_active_workspace_member` helper exists)

**Cons**
- One RLS bug equals cross-tenant data leak
- One tenant's noisy queries hurt every other tenant's latency
- No physical isolation, hard to claim HIPAA or SOC2 isolation without compensating controls
- Supabase row-count + connection limits eventually pinch (Pro = 60 GB DB, 500 concurrent users)

**Cost profile (Supabase Pro)**
- $25/mo base, scales with rows, egress, function invocations
- Realistic ceiling: 50-100 tenants on one Pro project before you need to split
- For Ten80Ten: 1 tenant + 5-10 white-label agency tenants fits comfortably for years

**Verdict**: Right answer for 95% of cases, including this one. This is what Notion, Linear, Vercel, and Resend all run. Don't fight the standard pattern.

### 5.2 Path B — Shared DB, Schema-per-tenant (SILO)

Each tenant gets its own Postgres schema (e.g., `tenant_ten80ten`, `tenant_acme`). One Supabase project but separate schemas.

**Pros**
- Stronger logical isolation (separate `posts` table per tenant)
- Easier to backup or wipe one tenant
- Cross-tenant queries effectively impossible by accident

**Cons**
- Supabase's RLS, Realtime, and `public` schema assumptions break down at the edges
- Every migration runs N times (per schema)
- supabase-js needs schema option per query, ugly
- Loses RPC discovery for new schemas
- Connection pool penalty (each schema = new search_path)
- Realtime publication needs per-schema config

**Cost profile**: similar to Path A but with ops overhead.

**Verdict**: Don't. Postgres can do it, Supabase fights you the whole way. Only justified if you have one specific tenant with regulatory isolation needs and even then I'd argue for Path C for that one tenant.

### 5.3 Path C — Database-per-tenant (BRIDGE)

Each tenant gets a separate Supabase project, separate Postgres DB, separate URL, separate keys.

**Pros**
- Hardest isolation Postgres can give you
- Sell HIPAA / data-residency / SOC2 isolation honestly
- Tenant X getting DDOS-ed doesn't touch Tenant Y
- Migrations can be staged per tenant safely

**Cons**
- $25/mo minimum per tenant just in Supabase Pro
- Migration tooling: bespoke runner walks N projects
- Realtime + Auth project IDs differ per tenant — the app needs to swap supabase clients dynamically
- Cross-tenant admin (your own back-office) gets hard
- 5 tenants = $125/mo floor. 50 tenants = $1250/mo just in Supabase.

**Verdict**: Hybrid only. Path A is default. Path C is the upgrade for one or two premium tenants that demand isolation.

### 5.4 Recommended path

**Pool by default. Bridge on demand.**

Concretely:
1. Ship Path A first. Use the existing schema. Wire the workspace selector, fix the hardcoded baseline, deploy.
2. After 5+ tenants in production, build a "Dedicated DB" tier that provisions a separate Supabase project for tenants paying $300+/mo or with compliance needs.
3. Keep the app code identical between pool and bridge. The only difference is the Supabase client URL/key resolution at request time.

This is the same model Vercel itself uses (shared Postgres on Hobby/Pro, isolated DB on Enterprise).

---

## 6. The Recommended Multi-Tenant Build, Step by Step

### Phase 0 — Decisions before we touch code

These are blocking and they need a real answer:

1. **Tenant routing model.** Subdomain (`acme.t10t.app`), custom domain (`social.acme.com`), path prefix (`smm.ten80ten.com/t/acme`), or workspace selector cookie?
   - Recommendation: subdomain on a t10t-owned apex, plus optional custom domain via CNAME + Vercel.
   - Why: cleanest auth scope, cleanest cookie isolation, plays well with Vercel's domain attach flow.
2. **Auth scope.** Does a single user account belong to one workspace or many?
   - Recommendation: many. Same user can log in to multiple workspaces. Selector after login.
   - Why: cheaper email management, supports agencies that are members of their own and their clients' workspaces.
3. **Billing model.** Per-seat, per-workspace flat, per-post metered?
   - Recommendation: per-seat with a workspace minimum ($79/mo includes 3 seats, $19/seat after).
   - Why: aligns with how agencies already think.
4. **Custom domain TLS.** Vercel Domains handles it, but who pays the per-domain fee?
   - Recommendation: included in Premium tier, $5/mo upcharge on Standard.
5. **n8n strategy.** One n8n with N tenant-scoped workflows, or N n8n instances?
   - Recommendation: single n8n, one workflow per tenant, JSON-cloned from V4 template with EDIT FOR CLIENT markers.
   - Why: Aldridge already established this pattern in V4 (see `feedback_n8n_multitenant_no_env_vars`).

### Phase 1 — Schema patches (one migration)

Migration `0027_multi_tenant_completion.sql`:

```sql
-- 1. Add workspace_id to team_members (currently missing)
alter table team_members add column if not exists workspace_id uuid
  references workspaces(id) on delete cascade;
update team_members set workspace_id = '00000000-0000-0000-0000-000000000001'
  where workspace_id is null;
alter table team_members alter column workspace_id set not null;
create index if not exists team_members_workspace_idx on team_members(workspace_id);

-- 2. Replace the baseline-hardcoded RLS on team_members with row-level
do $$ declare pol record; begin
  for pol in select policyname from pg_policies
    where schemaname='public' and tablename='team_members'
  loop execute format('drop policy if exists %I on public.team_members', pol.policyname);
  end loop;
end $$;

create policy team_members_select_v3 on team_members for select
  using (is_active_workspace_member(workspace_id, null));
create policy team_members_write_v3 on team_members for all
  using (is_active_workspace_member(workspace_id, array['superadmin','admin','owner']))
  with check (is_active_workspace_member(workspace_id, array['superadmin','admin','owner']));

-- 3. brand_playbook: replace singleton id with one row per workspace
alter table brand_playbook drop constraint if exists brand_playbook_pkey;
alter table brand_playbook add column if not exists id_new uuid default gen_random_uuid();
update brand_playbook set id_new = gen_random_uuid() where id_new is null;
alter table brand_playbook drop column id;
alter table brand_playbook rename column id_new to id;
alter table brand_playbook add primary key (id);
create unique index brand_playbook_workspace_uniq on brand_playbook(workspace_id);

-- 4. publish_jobs: add direct workspace_id for RLS clarity + future cross-tenant operator views
alter table publish_jobs add column if not exists workspace_id uuid;
update publish_jobs pj set workspace_id = p.workspace_id
  from posts p where pj.post_id = p.id and pj.workspace_id is null;
alter table publish_jobs alter column workspace_id set not null;
alter table publish_jobs add constraint publish_jobs_workspace_fkey
  foreign key (workspace_id) references workspaces(id) on delete cascade;
create index if not exists publish_jobs_workspace_idx on publish_jobs(workspace_id);

-- 5. workspace-scoped storage paths
-- (no schema change, but enforce convention in code: avatars/{workspaceId}/{userId}.png)

-- 6. Tenant settings table for branding + SMTP + domain
create table if not exists workspace_settings (
  workspace_id uuid primary key references workspaces(id) on delete cascade,
  display_name text not null,
  logo_url text,
  primary_color text default '#ea580c',
  custom_domain text unique,
  email_from text,
  email_reply_to text,
  smtp_provider text default 'gmail',
  smtp_host text,
  smtp_user text,
  smtp_password_encrypted bytea,
  enabled_platforms text[] default array['instagram','tiktok','facebook','youtube','linkedin'],
  feature_flags jsonb default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table workspace_settings enable row level security;
create policy workspace_settings_read on workspace_settings for select
  using (is_active_workspace_member(workspace_id, null));
create policy workspace_settings_write on workspace_settings for all
  using (is_active_workspace_member(workspace_id, array['superadmin','admin','owner']))
  with check (is_active_workspace_member(workspace_id, array['superadmin','admin','owner']));

-- 7. Tenant social tokens (replace n8n env-baked secrets)
create table if not exists workspace_social_credentials (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  platform text not null check (platform in ('instagram','tiktok','facebook','youtube','linkedin')),
  external_account_id text not null,
  display_name text,
  access_token_encrypted bytea not null,
  refresh_token_encrypted bytea,
  token_expires_at timestamptz,
  scopes text[],
  status text not null default 'active' check (status in ('active','expired','revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, platform)
);
alter table workspace_social_credentials enable row level security;
create policy social_creds_read on workspace_social_credentials for select
  using (is_active_workspace_member(workspace_id, array['superadmin','admin','owner']));
-- writes go through admin client only (service role bypasses RLS)
```

That single migration completes the schema side of multi-tenancy. Plain Postgres, no Supabase-magic, reviewable in one PR.

### Phase 2 — App-layer changes

#### 6.2.1 Tenant resolver (new file)

`src/lib/tenant.ts`:

```ts
// Resolves the active workspaceId for the current request.
// Order of resolution:
//   1. Custom domain (Host header)        → workspace_settings.custom_domain
//   2. Subdomain on apex (acme.t10t.app)  → workspaces.slug
//   3. Cookie t10t_workspace_id           → membership check
//   4. First active workspace_member row  → default

export async function resolveTenant(req: Request, userId: string | null): Promise<string | null> {
  const host = req.headers.get("host") ?? "";
  // 1. custom domain
  const byDomain = await admin.from("workspace_settings")
    .select("workspace_id").eq("custom_domain", host).maybeSingle();
  if (byDomain.data) return byDomain.data.workspace_id;
  // 2. subdomain
  const slug = host.split(".")[0];
  if (slug && slug !== "smm" && slug !== "www") {
    const byslug = await admin.from("workspaces").select("id").eq("slug", slug).maybeSingle();
    if (byslug.data) return byslug.data.id;
  }
  // 3. cookie
  const cookieWs = req.headers.get("cookie")?.match(/t10t_workspace_id=([^;]+)/)?.[1];
  if (cookieWs && userId) {
    const member = await admin.from("workspace_members")
      .select("workspace_id").eq("user_id", userId).eq("workspace_id", cookieWs)
      .eq("status","active").maybeSingle();
    if (member.data) return member.data.workspace_id;
  }
  // 4. default
  if (userId) {
    const first = await admin.from("workspace_members").select("workspace_id")
      .eq("user_id", userId).eq("status","active").order("created_at").limit(1).maybeSingle();
    if (first.data) return first.data.workspace_id;
  }
  return null;
}
```

#### 6.2.2 Middleware for host detection (new file)

`middleware.ts` at project root:

```ts
import { NextRequest, NextResponse } from "next/server";

export const config = {
  matcher: ["/((?!_next|api|favicon|manifest|sw.js|ten80ten-logo).*)"],
};

export function middleware(req: NextRequest) {
  const host = req.headers.get("host") ?? "";
  const res = NextResponse.next();
  // Stamp the resolved tenant subdomain into a request header
  // so RSC pages can read it without re-parsing host.
  res.headers.set("x-t10t-host", host);
  return res;
}
```

Note: per AGENTS.md, this codebase deliberately avoids middleware in favor of bearer-token reads. Adding host-detection middleware is the deliberate exception. It does not touch auth.

#### 6.2.3 Rewrite `/api/workspace/provision`

Today it always inserts into baseline. Change:

```ts
// pseudocode
const ws = await resolveTenant(request, user.id);
if (!ws) return NextResponse.json({ error: "No workspace context" }, { status: 403 });
// check membership; if missing AND user has an invite, accept; else 403.
```

No more "self-heal into baseline". Provisioning now requires a real invite or an admin manually adding the user.

#### 6.2.4 Remove every `00000000-0000-0000-0000-000000000001` fallback

Grep target: nine current hits in `src/`. Each becomes either:
- A read from `workspaceIdRef.current` with a `throw new Error("workspace context missing")` if null, OR
- A read from `tenantContext.workspaceId` (new React context)

The iron-law fallback in `createCard` (AGENTS.md rule 1c) becomes:

```ts
if (!workspaceIdRef.current) {
  toast.error("Workspace not ready. Reloading…");
  await reloadTenantContext();
  return;
}
insertRow.workspace_id = workspaceIdRef.current;
```

This is a real behavior change. The single-tenant safety net is gone. We need:
- A loading skeleton state until tenant resolves
- A fail-loud toast if tenant resolution fails
- Sentry breadcrumb for "tenant_missing" so we see it in production

#### 6.2.5 Workspace switcher UI

New component, top-right of TopBar, only renders if `workspaces.length > 1`:

```
[ Ten80Ten ▾ ]
  ├─ Ten80Ten          ← current
  ├─ Acme Agency
  └─ + Create workspace
```

Selecting writes `t10t_workspace_id` cookie + hard navigates to refresh tenant context. Cheap, correct, no Realtime channel migration needed because every channel is keyed by workspaceId.

#### 6.2.6 Per-tenant branding pipeline

Layout becomes RSC-aware:

```tsx
// app/layout.tsx
export async function generateMetadata({ params, headers }): Promise<Metadata> {
  const host = (await headers()).get("host") ?? "";
  const settings = await getTenantSettingsByHost(host);
  return {
    title: `${settings.display_name} SMM`,
    description: `Content Engine for ${settings.display_name}`,
    metadataBase: new URL(`https://${host}`),
    icons: { icon: settings.favicon_url ?? "/favicon.ico" },
    openGraph: { ... },
  };
}
```

Sidebar logo + footer + email templates read from a `useTenant()` hook that exposes display_name, logo_url, primary_color. CSS custom properties for primary_color drop into globals.css under `--t10t-primary`.

Five files touched, all done.

#### 6.2.7 Per-tenant email

nodemailer transport becomes per-request:

```ts
const settings = await getTenantSettings(workspaceId);
const transport = nodemailer.createTransport({
  host: settings.smtp_host ?? "smtp.gmail.com",
  port: 465,
  auth: { user: settings.smtp_user, pass: decrypt(settings.smtp_password_encrypted) },
});
```

Decrypt uses `pgcrypto` or a Supabase Vault read. SMTP credentials encrypted at rest is table stakes here.

### Phase 3 — n8n multi-tenant

The V4 workflow already bakes secrets into node bodies behind `// EDIT FOR CLIENT` markers (per memory `feedback_n8n_multitenant_no_env_vars`). Multi-tenant n8n flow:

1. Workflow template lives in `n8n/templates/auto-publisher-template.json`
2. CLI script `scripts/clone-workflow.mjs <workspaceId>` reads `workspace_social_credentials`, hydrates the template, posts to n8n REST API to create a new workflow named `auto-publisher--{slug}`
3. Each tenant has one active workflow, claim trigger every 1 min, isolated by `WHERE workspace_id = '...'` on the claim RPC

DB change to `claim_publish_job`:

```sql
create or replace function claim_publish_job(p_workspace_id uuid) returns jsonb ...
```

Each tenant's n8n workflow passes its own workspace_id. Cross-tenant job stealing becomes physically impossible.

### Phase 4 — Storage per tenant

Google Drive root folder per workspace. Today: one shared folder. Tomorrow: `Ten80Ten SMM / {workspace_slug} / {year}-{month}`. The service account is shared but the folder tree is namespaced. Files inherit folder permissions.

Supabase `avatars` storage bucket: change object path to `{workspaceId}/{userId}.png`. Update RLS on `storage.objects`:

```sql
create policy avatars_read on storage.objects for select
  using (bucket_id = 'avatars' and (storage.foldername(name))[1]::uuid in (
    select workspace_id from workspace_members
    where user_id = auth.uid() and status = 'active'
  ));
```

Now avatars don't cross tenants either.

### Phase 5 — Billing

Stripe Billing, not Stripe Checkout. Subscription per workspace, seat metered.

Tables:

```sql
create table workspace_billing (
  workspace_id uuid primary key references workspaces(id),
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  plan text not null default 'trial' check (plan in ('trial','standard','pro','dedicated')),
  seats_purchased int not null default 3,
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  status text not null default 'trialing'
);
```

Webhook handler `/api/billing/stripe/route.ts` updates `workspace_billing.status` on `customer.subscription.updated`. Middleware adds a `x-t10t-billing-status` header so a "subscription paused" UI banner renders on any page.

Seat count gate at `/api/team/invite`: refuse invite if `active members count + 1 > seats_purchased`.

Pricing draft:

| Plan | Price | Includes |
|---|---|---|
| Trial | $0 / 14 days | 3 seats, 1 workspace, all features |
| Standard | $79/mo | 3 seats, 1 workspace, $19/seat after, shared DB |
| Pro | $199/mo | 10 seats, 3 workspaces, $19/seat after, AI Studio included |
| Dedicated | $499+/mo | Isolated Supabase project, custom domain, SLA |

Trial flow: workspace created with `trial_ends_at = now() + 14 days`. Cron job downgrades to read-only after expiry.

### Phase 6 — Onboarding flow

New routes:

- `/signup` — Supabase signup, creates auth.users row only
- `/onboarding/create-workspace` — user names the workspace, picks a slug, picks platforms, sees a $79/mo Stripe checkout
- `/onboarding/connect-socials` — OAuth flow per platform writing to `workspace_social_credentials`
- `/onboarding/invite-team` — bulk email invite, writes to `workspace_invites`
- `/(app)/dashboard` — first kanban view

Each step lives in a clean route group so partial onboarding can resume.

### Phase 7 — Observability

Per-tenant metrics on a single Grafana board (or BetterStack):
- Posts/day, MAU, publish success rate, AI cost / workspace
- Realtime per-tenant query latency
- Stripe MRR per tenant

Tag every Supabase query with `x-workspace-id` for traceability. Supabase logs are queryable by tag.

---

## 7. White-Label Plan

Two tiers:

### 7.1 "Branded" tier ($79+/mo)

- Custom logo, custom primary color
- Custom email from-address ("from Acme <social@acme.com>")
- Custom subdomain on `*.t10t.app`
- Footer still reads "Powered by Ten80Ten"

### 7.2 "White-label" tier ($299+/mo)

- Custom domain (`social.acme.com`)
- No "Powered by" footer
- White-label email templates (no Ten80Ten logo, no Ten80Ten support email)
- Optional custom favicon + apple-touch-icon
- Optional custom OG image
- Optional white-label browser tab title

How it ships, technically:

- Vercel handles TLS for custom domains via the Domains API
- Tenant adds CNAME `social.acme.com → cname.vercel-dns.com`
- We call Vercel REST `POST /v9/projects/{id}/domains` to add it programmatically
- DNS verification check, then auto-issue TLS cert
- `workspace_settings.custom_domain` populated
- `resolveTenant()` matches host to settings row

This is the same playbook Resend, Cal.com, and Supabase Vector use for custom domains. Mature pattern.

---

## 8. Security Hardening (mandatory before second tenant)

1. **Re-audit every RLS policy.** Use a synthetic two-tenant test fixture (`tenant_a`, `tenant_b`), insert posts in both, sign in as a member of A only, and run a SELECT * with no filter. If you see B's row, RLS leaks.
2. **Block service-role calls from client.** Today every server route uses admin client. After multi-tenant, every admin call must also pass `workspace_id` validation. Add a `requireTenant(req, workspaceId)` helper.
3. **Encrypt social tokens at rest.** Use `pgcrypto` AES with a master key in Vercel env (`T10T_SECRETS_KEY`).
4. **Rate-limit per workspace.** Today the rate-limit table is keyed on user + endpoint. Add workspace_id to the composite key so a noisy tenant doesn't starve a quiet one.
5. **Add `pgaudit` extension.** Logs every DDL/DML at the Postgres layer for forensic replay.
6. **Pen-test the cross-tenant boundary.** Hire a third-party pen-tester before opening signups. $3-5k spend, non-negotiable for B2B SaaS at this size.
7. **Disable `RETURNING *` in service-role inserts that touch user-input columns.** Reduces blast radius of any RLS gap.

---

## 9. Cost Model (12-month projection)

Assumptions: 10 tenants by month 12, average 5 seats per tenant, 50 posts per tenant per month.

| Line | Monthly | Annual |
|---|---|---|
| Vercel Pro | $20 | $240 |
| Supabase Pro (Path A pool) | $25 + $0.10/GB egress ≈ $40 | $480 |
| n8n self-hosted (Coolify) | included in Hetzner CX22 = $5 | $60 |
| Hetzner CX22 (n8n + side services) | $5 | $60 |
| OpenAI (Creator Studio, 10 tenants × $30) | $300 | $3,600 |
| Stripe fees (3%) on $7,900 MRR | $237 | $2,844 |
| Pen test (year 1) | — | $4,000 |
| **Total run-rate** | **$607/mo + Stripe** | **$11,284 / yr** |
| **Revenue (10 × $79)** | **$790/mo** | **$9,480** |

At 10 tenants, near break-even. At 25 tenants, comfortable margin. At 50+, time to introduce Path C tier for the high-end and hire a half-time ops engineer.

Cost killer: OpenAI. If Creator Studio usage trends high, meter it and bill at cost+30%.

---

## 10. Risk Register

| Risk | Severity | Likelihood | Mitigation |
|---|---|---|---|
| RLS misconfig leaks cross-tenant data | Critical | Medium | Synthetic two-tenant test fixture, monthly RLS audit, pgaudit |
| Aldridge's Meta ban blocks first non-Ten80Ten tenant | High | Confirmed | Clean team profile creates the Meta app, transfer to Ten80Ten BM |
| Supabase Pro DB outgrows pool model | Medium | Low | 50-100 tenant ceiling gives 18-24 months runway |
| Stripe seat metering edge cases (cancel/refund/dispute) | Medium | High | Treat first 5 customers as design partners, manual reconcile |
| n8n single-instance is SPOF | Medium | Medium | Hetzner backup + Coolify redeploy script; longer-term move to n8n Cloud Pro |
| Google Drive service-account quota | Low | Medium | Migrate to Supabase Storage at tenant #20 |
| Custom domain TLS issuance fails on weird DNS | Low | Medium | Vercel handles it; document the CNAME process clearly |
| iOS Safari PWA service worker quirks at second tenant subdomain | Low | Low | SW already v3-tested; re-verify on `acme.t10t.app` |
| Audit log volume per tenant blowup | Low | Medium | Partition `audit_log_v2` by month, drop partitions older than 90 days |
| Email deliverability when SMTP is tenant-supplied | Medium | High | Default to Resend for all tenants on Standard tier, SMTP only on Pro+ |

---

## 11. Decision Matrix (read this section, ignore the rest)

| Question | Answer | Reason |
|---|---|---|
| Multi-tenant pattern? | **Pool (Path A)** | Foundation already there, lowest cost, industry standard |
| Tenant routing? | **Subdomain + optional custom domain** | Cleanest cookie scope, simplest middleware |
| Auth scope? | **User can belong to many workspaces** | Real-world agencies need it |
| Billing? | **Stripe per-seat with workspace minimum** | Matches agency mental model |
| First non-Ten80Ten tenant? | **Friendly design partner, free for 90 days** | Stress-test multi-tenant cleanly before paid customers |
| Order of work? | **Schema → tenant resolver → RLS audit → branding → n8n → billing → onboarding** | Each step is non-blocking to next; ship behind a feature flag |
| Time estimate? | **4-6 weeks engineering, 1 week ops, 2 weeks security** | Aggressive but realistic for one engineer at full focus |
| Cost to ship? | **~$8-12k including pen test** | Pen test is the only hard line item |

---

## 12. The Six-Sprint Build Plan

### Sprint 1 (week 1): Schema
- Migration 0027 ship to staging
- Two-tenant fixture (tenant_a, tenant_b) in supabase/fixtures
- RLS regression test script
- Done = `npm run test:rls` proves cross-tenant SELECTs return zero rows

### Sprint 2 (week 2): App layer
- Tenant resolver
- Middleware for host detection
- Remove baseline UUID fallbacks (9 sites)
- Workspace switcher UI in TopBar
- Done = manual test: log in as user-in-two-workspaces, switch via dropdown, see different posts

### Sprint 3 (week 3): Branding + email
- `workspace_settings` table + admin UI
- RSC metadata generation per host
- Sidebar logo, footer, primary color all read from settings
- Per-tenant nodemailer transport
- Done = `acme.t10t.app` and `smm.ten80ten.com` look like different products

### Sprint 4 (week 4): n8n + secrets
- `workspace_social_credentials` table with encryption
- OAuth callback routes for each platform writing to that table
- n8n workflow template + CLI clone script
- Done = second tenant publishes a post end-to-end via its own n8n workflow

### Sprint 5 (week 5): Billing + onboarding
- Stripe customer + subscription wiring
- `/signup`, `/onboarding/*`, `/billing` routes
- Seat enforcement gate on invite
- Trial expiry cron
- Done = friend creates an account, picks a plan, gets billed correctly

### Sprint 6 (week 6): Security + observability
- Pen test scheduled
- pgaudit enabled
- Per-tenant Grafana board
- Custom domain TLS automation via Vercel API
- Done = first paid tenant onboarded, both portals visible side-by-side, both publishing, both audited

---

## 13. Open Questions To Resolve Before Sprint 1

1. **Apex domain.** Use `ten80ten.app`, `t10t.app`, or a new one? Already-owned matters.
2. **Pricing teardown.** Are Standard and Pro tiers right, or is there a "Studio Solo" SMB tier at $19/mo we should add?
3. **Free tier.** None today. With ten free tenants at $0 we still pay $40/mo Supabase + $300 OpenAI. Cap free trials at 14 days.
4. **n8n cloud vs self-hosted.** Self-hosted is $5/mo on Hetzner but a SPOF. n8n Cloud Pro is $50/mo but managed. At 5+ tenants, switching saves nights.
5. **Resend vs Gmail SMTP default.** Resend is API-first, has audit logs, supports per-tenant from-addresses. Gmail SMTP is what we use today. Recommend swap to Resend at the same time we add per-tenant email.
6. **Meta Developer App owner.** Until the ban question is resolved, all non-Ten80Ten tenants must connect their own Meta apps. That changes onboarding UX substantially.

---

## 14. Final Read

The portal is closer to multi-tenant than the surface suggests. The hard part (RLS + workspace_id) is already 80% done. The visible work (UI selector, branding, billing) is straightforward but tedious. The risky work (RLS audit, pen test, n8n cloning) is small in surface area but high in consequence.

Six weeks of focused engineering puts a real product in market. The competitive position post-multi-tenant is "Planable with audit-grade publishing and bundled AI", priced at agency tier, and the iron-law architecture is a story we can sell to anyone who has been bitten by a publish failure before.

The single largest risk is not technical. It is that Aldridge's personal Meta ban blocks Facebook + Instagram publishing for tenant #2 until a clean profile creates the Meta App. Resolve that pathway in parallel with Sprint 1 schema work.

Ship Path A. Bridge tier comes later, only when a tenant demands isolation enough to pay for it.

---

*End of document. Suggested follow-up: a one-page customer-facing pricing teardown, a one-page security overview for design-partner conversations, and a one-page "how to invite your client to their workspace" video script.*
