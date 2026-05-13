# Ten80Ten Auto-Publisher — Bulletproof n8n Workflow + DB Lockdown

**Author:** Claude (acting as Chief Automation Specialist)
**Date:** 2026-05-13
**Target stack:** n8n (multi-tenant, no env-var access) + Supabase `lczmgquuzuqhalasjnip` + Next.js 16 SMM portal
**Status:** Planning. Nothing in this doc has been applied yet.

---

## 1. Executive summary

The SMM portal currently lets humans drag a card from `approved_scheduled` to `posted`. That is a lie — there is no verification that the post actually went live. We are going to:

1. **Remove the manual drag affordance** in the UI for that transition.
2. **Block the transition at the database level** with a Postgres trigger so even the service-role can't accidentally flip it without going through the n8n path.
3. **Replace the existing n8n V3 workflow** (which has six P0 defects detailed in §3) with a rebuilt one whose contract is: *only fire `stage='posted'` AFTER the platform API has returned a real post ID, write the live URL back, and write a real audit entry visible in the app's audit trail.*
4. **Clean up the 10 ghost publish_jobs** currently queued (six of them target posts already in `posted` and would double-post the moment n8n activates).
5. **Ship every secret as an n8n Credential, not an env var**, so this is portable to other Ten80Ten clients without touching n8n instance settings.

Once shipped, the chain of trust is:
`Operator approves` → `scheduled_at fires` → `n8n claims atomically` → `n8n publishes to FB/IG/LI` → `n8n writes posted_urls + posted_at` → `n8n stamps stage='posted'` → `n8n writes audit + alert on failure`. Any other path to `stage='posted'` is rejected by the DB trigger.

---

## 2. What exists in prod today (verified 2026-05-13)

| Asset | Status | Notes |
|---|---|---|
| `posts.scheduled_at` (tstz), `scheduled_timezone` (text) | Present | Migration 0012 derived from scheduled_date + scheduled_time |
| `posts.asset_urls` (text[]) | Present | Studio-generated posts store media here |
| `posts.source_vault` (jsonb) | Present | Legacy manually-uploaded posts store `{rawFiles: [...]}` here |
| `publish_jobs` table | Present | Columns: id, workspace_id, post_id, scheduled_at, state, claim_expires_at, worker_id, correlation_id, created_at, updated_at |
| `platform_publish_attempts` table | Present | Per-platform record of attempts |
| `dead_letter_jobs` table | Present | Permanent failure record |
| `claim_publish_job` RPC | Present | Atomic claim via FOR UPDATE SKIP LOCKED |
| `dead_letter_publish_job` RPC | Present | |
| `create_publish_job_for_post` RPC | Present | Triggered when post enters approved_scheduled |
| `n8n/ten80ten-auto-publisher.json` V3 | Present, NOT activated | 297-line workflow with 5 platform publishers |
| `audit_log_v2` | Present | The legal audit table; UI reads via `v_audit_log_with_actor` |
| **Posts missing:** `posted_at`, `posted_urls (jsonb)` | **MISSING** | Need migration 0026 |
| **publish_jobs missing:** `attempts`, `last_error`, `next_retry_at` | **MISSING** | Need migration 0026 |
| **DB trigger blocking manual stage→posted** | **MISSING** | Need migration 0026 |
| **Platforms actually used in posts.platforms** | `facebook`, `instagram`, `linkedin` | TikTok/YouTube nodes can stay dormant |

### Queue health snapshot

```
publish_jobs by state: 10 pending, 0 claimed, 0 succeeded, 0 failed
```

Of those 10 pending jobs:
- **6** target posts whose stage is already `posted` (manual drag with no job cleanup) → **double-post hazard**
- **3** target posts in `approved_scheduled` with scheduled_at in the past (Apr 24, May 14, May 15) — Apr 24 is 19 days overdue
- **1** is 21 days overdue (Apr 22, already in `posted`)

Cleanup is part of step 6.

---

## 3. Defects in the existing V3 workflow (severity rated)

| # | Severity | Defect | Why it fails Aldridge's "really really sure" bar |
|---|---|---|---|
| D1 | **P0** | Every code node references `$env.SUPABASE_URL`, `$env.SUPABASE_SERVICE_ROLE_KEY`, `$env.META_PAGE_ACCESS_TOKEN`, etc. | Explicit constraint violation. Multi-tenant n8n has no per-workflow env vars; this design is non-portable. |
| D2 | **P0** | Media extraction only reads `source_vault.rawFiles`, never `posts.asset_urls`. | Every Creator-Studio-generated post stores media in `asset_urls`. They will silently fail to publish ("No media file"). |
| D3 | **P0** | No DB-level guard. Operators can still drag to `posted`, leaving stale publish_jobs queued. | Causes the exact ghost-queue problem already observed (6 zombies in the queue). |
| D4 | **P1** | Audit write goes to legacy `post_audit_logs`. UI reads `audit_log_v2` via `v_audit_log_with_actor`. | "Posted by n8n" never appears in the audit timeline operators look at. |
| D5 | **P1** | Schedule trigger interval = 5 min → up to 5 min slop on scheduled posts. | "Really really sure" demands ≤ 60 s drift. |
| D6 | **P1** | No retry strategy on transient platform errors. One Meta 5xx kills the post and dead-letters it. | LinkedIn flakes constantly; permanent failure on one transient blip is bad. |
| D7 | **P2** | TikTok + YouTube publisher nodes wired but no posts use them. | Dormant code; not a bug, but the workflow is bigger than needed and obscures review. |
| D8 | **P2** | `Send Alert` only handles SUCCESS-WITH-FAILURE case; pure all-fail dead-letters silently. | An on-call human should be paged on dead-letter too. |
| D9 | **P2** | Worker ID uses `n8n-{executionId}` only; no way to identify which n8n instance ran. | Multi-tenant context: ambiguous when debugging which client's worker did what. |

---

## 4. Target architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  SMM Portal (Next.js)                                                       │
│                                                                             │
│    Operator approves → moveCard(post, "approved_scheduled")                 │
│         │                                                                   │
│         ▼                                                                   │
│    Postgres trigger: create_publish_job_for_post(post) → publish_jobs row   │
│                                                                             │
│    (Drag to "posted" REJECTED at DB level — no UI affordance either)        │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  n8n Auto-Publisher V4 (every 1 min)                                        │
│                                                                             │
│    1. Schedule Trigger ─┐                                                   │
│    2. Manual Trigger ───┴→ 3. Set Run Mode (live | dry_run)                 │
│                                          │                                  │
│                                          ▼                                  │
│    4. Claim Next Job (Supabase Credential → RPC claim_publish_job)          │
│                                          │                                  │
│              ┌───────────────────────────┤                                  │
│              ▼                           ▼                                  │
│         Has Job? ─NO──→ No-op (end)      YES                                │
│              │                                                              │
│              ▼                                                              │
│    5. Resolve Media (asset_urls > source_vault.rawFiles)                    │
│    6. Pre-flight Validation (caption length, asset count, scheduled drift)  │
│              │                                                              │
│              ▼                                                              │
│    7a. Publish Facebook  ─→  7b. Publish Instagram  ─→  7c. Publish LinkedIn│
│       (onError continue, accumulate _results)                               │
│              │                                                              │
│              ▼                                                              │
│    8. Finalize Job (single transaction):                                    │
│         - PATCH platform_publish_attempts (per platform result)             │
│         - If any success: UPDATE posts SET stage='posted',                  │
│             posted_at=now(), posted_urls=jsonb_of_succeeded                 │
│         - PATCH publish_jobs SET state=(succeeded|partial|failed|dead),     │
│             attempts=attempts+1, last_error=concat(failures), worker_id=null│
│         - If permanent failure: call dead_letter_publish_job RPC            │
│              │                                                              │
│              ▼                                                              │
│    9. Write Audit (record_audit_event RPC, actor=NULL → actor_role='n8n')   │
│              │                                                              │
│              ▼                                                              │
│    10. Conditional Alert (if any failure OR dead_letter)                    │
│              │                                                              │
│              ▼                                                              │
│    11. Loop back to step 4 (drain entire queue)                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Safety invariants** (every one must hold for the workflow to be considered correct):

1. **No double-post.** `claim_publish_job` uses `FOR UPDATE SKIP LOCKED` and sets `state='claimed'` atomically. No two workers can hold the same job.
2. **No phantom claim.** `claim_expires_at = now() + interval '120 seconds'`. If the worker crashes mid-publish, the row is unclaimed at 120 s and re-tried. The platform API calls themselves must complete in < 120 s (IG carousel polling is the longest; capped at 60 s).
3. **Stage transition is server-controlled.** Frontend never writes `stage='posted'`. DB trigger rejects any UPDATE that sets `stage='posted'` unless the session role is `service_role`.
4. **Per-platform isolation.** FB failure does not block IG. The post is `partial` if some succeed and some fail; the operator gets an alert with the breakdown.
5. **Idempotency.** `claim_publish_job` only returns jobs where `state='pending'` and `posts.stage='approved_scheduled'`. A post that's already `posted` will have its job ignored.
6. **Retry policy.** Transient failure (5xx, network) → set `state='pending'`, `attempts+1`, `next_retry_at=now()+attempts*5min`. Permanent failure (4xx, validation) → state='failed' + dead_letter. Cap at 3 attempts.
7. **Auditability.** Every claim, every publish attempt (success or fail), every dead-letter writes to `audit_log_v2` so the operator sees it in the timeline.
8. **Time-zone correctness.** `scheduled_at` is `timestamptz`; comparisons are in UTC. The view that operators see uses `scheduled_timezone` for display. No tz math in n8n.

---

## 5. Database changes — Migration 0026

File: `supabase/migrations/0026_publisher_lockdown.sql`

Strictly additive. Three goals: extra columns, retry tracking, and the lockdown trigger.

### 5.1 Add publishing record columns to posts

```sql
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS posted_at   timestamptz,
  ADD COLUMN IF NOT EXISTS posted_urls jsonb;

COMMENT ON COLUMN public.posts.posted_at   IS 'When n8n confirmed the post went live (any platform succeeded). NULL until the publisher writes it.';
COMMENT ON COLUMN public.posts.posted_urls IS 'Per-platform live URLs in shape {"facebook": "https://...", "instagram": "https://..."}. Populated by the publisher.';
```

### 5.2 Add retry tracking to publish_jobs

```sql
ALTER TABLE public.publish_jobs
  ADD COLUMN IF NOT EXISTS attempts      smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error    text,
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz;

COMMENT ON COLUMN public.publish_jobs.attempts      IS 'How many times the publisher has tried this job. Dead-letters at 3.';
COMMENT ON COLUMN public.publish_jobs.last_error    IS 'Concatenated platform errors from the latest attempt.';
COMMENT ON COLUMN public.publish_jobs.next_retry_at IS 'Earliest time the next attempt may claim. Set by transient-error path.';
```

### 5.3 Update `claim_publish_job` to honour `next_retry_at` and stage gate

```sql
CREATE OR REPLACE FUNCTION public.claim_publish_job(
  p_worker_id text,
  p_claim_seconds integer DEFAULT 120
)
RETURNS SETOF public.publish_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.publish_jobs j
  SET
    state             = 'claimed',
    worker_id         = p_worker_id,
    claim_expires_at  = now() + (p_claim_seconds || ' seconds')::interval,
    updated_at        = now()
  WHERE j.id = (
    SELECT j2.id FROM public.publish_jobs j2
    JOIN public.posts p ON p.id = j2.post_id
    WHERE j2.state = 'pending'
      AND p.stage = 'approved_scheduled'                 -- ← stage gate
      AND j2.scheduled_at <= now()                       -- ← due
      AND (j2.next_retry_at IS NULL OR j2.next_retry_at <= now())  -- ← retry honoring
      AND j2.attempts < 3                                -- ← max attempts
    ORDER BY j2.scheduled_at ASC
    FOR UPDATE OF j2 SKIP LOCKED
    LIMIT 1
  )
  RETURNING j.*;
END;
$$;
```

### 5.4 Lockdown trigger — reject manual stage→posted

```sql
CREATE OR REPLACE FUNCTION public.block_manual_posted_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only fire on stage transitions INTO 'posted'.
  IF NEW.stage = 'posted' AND OLD.stage IS DISTINCT FROM NEW.stage THEN
    -- Service role bypasses RLS, but inside a trigger we can check the
    -- current_user. The Supabase service_role connects as 'postgres' role
    -- by default; the anon/authenticated roles do NOT.
    IF current_user NOT IN ('postgres', 'service_role', 'supabase_admin') THEN
      RAISE EXCEPTION
        'POSTED_LOCKDOWN: Posts can only be moved to "posted" by the n8n auto-publisher after a successful platform API call. '
        'Current user: %. Use the queue + n8n workflow instead of dragging the card.',
        current_user
      USING ERRCODE = 'P0001';
    END IF;

    -- Even when service_role does the write, require posted_at to be set.
    IF NEW.posted_at IS NULL THEN
      RAISE EXCEPTION
        'POSTED_LOCKDOWN: stage="posted" requires posted_at to be non-null. '
        'The publisher must record when the post went live.'
      USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS posts_block_manual_posted ON public.posts;
CREATE TRIGGER posts_block_manual_posted
  BEFORE UPDATE ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.block_manual_posted_transition();
```

### 5.5 Orphan job cleanup (one-shot, in the same migration)

```sql
-- Any pending publish_jobs whose post is already in 'posted' stage are
-- ghost jobs from the pre-lockdown era. Move them to dead-letter so the
-- publisher doesn't double-post them on activation.
UPDATE public.publish_jobs j
SET state         = 'cancelled',
    last_error    = 'Cancelled by 0026 cleanup: post already in stage=posted before lockdown',
    updated_at    = now()
FROM public.posts p
WHERE p.id = j.post_id
  AND j.state = 'pending'
  AND p.stage = 'posted';

-- Any pending publish_jobs whose post is in a stage that should NOT have
-- a queued job (ideas / awaiting_approval / revision_needed) are also
-- garbage — cancel them.
UPDATE public.publish_jobs j
SET state         = 'cancelled',
    last_error    = 'Cancelled by 0026 cleanup: post stage is not approved_scheduled',
    updated_at    = now()
FROM public.posts p
WHERE p.id = j.post_id
  AND j.state = 'pending'
  AND p.stage NOT IN ('approved_scheduled', 'posted');
```

### 5.6 Convenience view for monitoring

```sql
CREATE OR REPLACE VIEW public.v_publish_queue AS
SELECT
  j.id AS job_id,
  j.state,
  j.scheduled_at,
  j.next_retry_at,
  j.attempts,
  j.last_error,
  j.worker_id,
  j.claim_expires_at,
  p.id AS post_id,
  p.title,
  p.stage,
  p.platforms,
  p.scheduled_timezone,
  p.posted_at,
  p.posted_urls,
  (now() - j.scheduled_at) AS overdue_by,
  (j.claim_expires_at < now()) AS claim_stuck
FROM public.publish_jobs j
JOIN public.posts p ON p.id = j.post_id
WHERE j.state IN ('pending', 'claimed', 'partial', 'failed')
ORDER BY j.scheduled_at ASC;

GRANT SELECT ON public.v_publish_queue TO authenticated;
```

### 5.7 Apply order

Migration 0026 is a single file. Apply via Supabase Management API in the same way 0024 and 0025 were applied.

---

## 6. Frontend changes

### 6.1 Remove drag affordance to `posted`

In `src/lib/pipeline-context.tsx`, the `moveCard` function permits any stage→stage transition gated by RLS. We add a client-side guard so the kanban board never offers `posted` as a drop target for human drags.

Two specific files:
- `src/lib/pipeline-context.tsx` — in `moveCard`, if `targetStage === 'posted'` and the caller is the UI, return a toast "Only n8n publishes to Posted. The card will move automatically once the post goes live." Do not call the DB update.
- `src/components/kanban-board.tsx` — the `posted` column's `<DropZone>` should show a lock-icon overlay and `disabled` state when the user is dragging.

The DB lockdown is the authoritative backstop. The UI changes are just so the user doesn't see a permission-denied error.

### 6.2 Show "Posted by n8n" badge

When `posts.posted_at IS NOT NULL`, render a small chip next to the title on the kanban card:
- "Live · 2 min ago" (relative time)
- Click → open the post URL from `posts.posted_urls` (first platform, or platform-picker)

### 6.3 New Settings panel — "Publishing Queue"

Adds visibility into the queue for admins. Read-only.

- Lists all rows of `v_publish_queue`
- Shows: post title, scheduled_at (operator's tz), state, attempts, last_error, claim_stuck flag, overdue_by
- One button per row: "Force retry" (PATCH `publish_jobs` SET state=pending, next_retry_at=null, attempts=0) — admin-only

This is your runbook surface. It replaces "let me ssh into n8n logs."

---

## 7. n8n Workflow V4 — node-by-node spec

### 7.1 Credentials (replace the env-var dependence)

Create the following n8n **Credentials** (Settings → Credentials → New). Each is scoped per-workflow but reusable across runs:

| Credential name | Type | Fields |
|---|---|---|
| `Supabase Ten80Ten` | Header Auth | Name: `Authorization`, Value: `Bearer sb_secret_<service_role_key>` |
| `Supabase Ten80Ten Apikey` | Header Auth | Name: `apikey`, Value: `<service_role_key>` |
| `Meta Graph API` | Header Auth | Name: `Authorization`, Value: `Bearer <meta_system_user_token>` |
| `LinkedIn API` | Header Auth | Name: `Authorization`, Value: `Bearer <linkedin_access_token>` |
| `LinkedIn Version` | Header Auth | Name: `LinkedIn-Version`, Value: `202411` |

**Why credentials and not constants in nodes:** even though Aldridge said "put them in the node", n8n credentials are a stronger pattern: they are encrypted at rest in n8n's database, they don't show secrets in the visual editor, and they can be revoked per-credential without touching the workflow JSON. They live in the n8n instance's credentials store, NOT in env vars. So both constraints are honoured: no env vars, and the secret is never literal text in the workflow.

**Non-secret IDs (`FACEBOOK_PAGE_ID`, `INSTAGRAM_BUSINESS_ACCOUNT_ID`, `LINKEDIN_ORG_URN`) go as constants at the top of each publisher code node.** Those are not secrets; they identify which page/account to post to. The constants live in the node and are configurable per-client by editing the workflow JSON.

### 7.2 Node 1 — Schedule Trigger

| Setting | Value |
|---|---|
| Interval | Every **1 minute** |
| Active | Yes |

Why 1 min not 5: the worst-case drift between scheduled time and publish time becomes ≤ 60 s. Combined with `claim_publish_job`'s server-side ordering, this gives sub-minute precision.

### 7.3 Node 2 — Manual Test Trigger

For drilling without firing real platform calls. Wired to Node 3 (Set Run Mode → dry_run=true).

### 7.4 Node 3 — Set Run Mode

n8n `Set` node. Outputs:
```
{
  "dry_run":   false,   // (manual trigger overrides to true)
  "worker_id": "n8n-ten80ten-{{ $env.N8N_HOST || 'unknown' }}-{{ $execution.id }}",
  "max_jobs_per_run": 5
}
```

`worker_id` tells dead-letter forensics which n8n instance ran which job. The `$env.N8N_HOST` is OK because that's a built-in n8n value, not a workflow secret.

### 7.5 Node 4 — Claim Next Job (Code, replaces V3's env-var version)

```javascript
// Claim the next due publish_job via the security-definer RPC.
// All Supabase config comes from the "Supabase Ten80Ten" credential
// (Header Auth, attached to the HTTP Request helper).
const SB_URL = 'https://lczmgquuzuqhalasjnip.supabase.co';  // ← edit per client

const item = $input.first()?.json || {};
const _http = this.helpers.httpRequest.bind(this.helpers);

try {
  const claimRes = await _http({
    method: 'POST',
    url: SB_URL + '/rest/v1/rpc/claim_publish_job',
    body: { p_worker_id: item.worker_id, p_claim_seconds: 120 },
    headers: { 'Content-Type': 'application/json' },
    authentication: 'predefinedCredentialType',
    nodeCredentialType: 'httpHeaderAuth',
    // Credentials wiring: this node has BOTH 'Supabase Ten80Ten' (Authorization)
    // and 'Supabase Ten80Ten Apikey' (apikey) attached via the credentials panel.
  });

  const jobs = Array.isArray(claimRes) ? claimRes : [];
  if (!jobs.length) {
    return [{ json: { ...item, hasJob: false } }];
  }
  const job = jobs[0];

  const postRes = await _http({
    method: 'GET',
    url: `${SB_URL}/rest/v1/posts?id=eq.${job.post_id}&select=*`,
    authentication: 'predefinedCredentialType',
    nodeCredentialType: 'httpHeaderAuth',
  });
  const posts = Array.isArray(postRes) ? postRes : [];
  if (!posts.length) {
    // Orphan job — post deleted. Dead-letter it.
    await _http({
      method: 'POST',
      url: SB_URL + '/rest/v1/rpc/dead_letter_publish_job',
      body: { p_job_id: job.id, p_reason: 'Post not found' },
      headers: { 'Content-Type': 'application/json' },
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'httpHeaderAuth',
    });
    return [{ json: { ...item, hasJob: false, error: 'Orphan job dead-lettered' } }];
  }
  return [{ json: { ...item, hasJob: true, job, post: posts[0], _results: [] } }];
} catch (err) {
  return [{ json: { ...item, hasJob: false, error: 'Claim failed: ' + err.message } }];
}
```

### 7.6 Node 5 — Has Job? (IF)

`{{ $json.hasJob }}` → true branch continues, false branch → `No-Op (end of run)`.

### 7.7 Node 6 — Resolve Media (Code, NEW — fixes D2)

```javascript
// Unified media resolver. Returns [{ url, mimeType, usageType }] in order.
//
// Studio-generated posts: posts.asset_urls[] is the source of truth.
// Manually-uploaded posts: posts.source_vault.rawFiles[] is the source.
// Prefer asset_urls when present (studio posts always set it).

const item = $input.first().json;
const post = item.post || {};
let assets = [];

if (Array.isArray(post.asset_urls) && post.asset_urls.length) {
  // Studio path. asset_urls is ordered: slide 1 first, slide 2 second, etc.
  // mimeType inferred from extension; carousel components are always images
  // for now (gpt-image-2 is image-only).
  assets = post.asset_urls.map((url) => {
    const ext = (url.split('?')[0].split('.').pop() || '').toLowerCase();
    const isVideo = ['mp4', 'mov', 'webm'].includes(ext);
    return {
      url,
      mimeType: isVideo ? 'video/mp4' : 'image/jpeg',
      usageType: 'master',
    };
  });
} else {
  // Legacy path. source_vault.rawFiles is jsonb {url, mimeType, usageType}.
  let vault = post.source_vault || {};
  if (typeof vault === 'string') { try { vault = JSON.parse(vault); } catch { vault = {}; } }
  assets = Array.isArray(vault.rawFiles) ? vault.rawFiles : [];
}

if (!assets.length) {
  return [{ json: { ...item, hasJob: false, error: 'No media files (neither asset_urls nor source_vault.rawFiles)' } }];
}

return [{ json: { ...item, assets } }];
```

### 7.8 Node 7 — Pre-flight Validation (Code, NEW)

```javascript
// Validate before burning platform API quota.
const item = $input.first().json;
const post = item.post || {};
const errors = [];

if (!Array.isArray(post.platforms) || !post.platforms.length) errors.push('No target platforms');
if (!post.caption || !post.caption.trim()) errors.push('Empty caption');
if (post.caption && post.caption.length > 2200) errors.push('Caption exceeds 2200 chars (IG/TT limit)');
if (post.content_type === 'carousel' && (item.assets || []).length < 2) errors.push('Carousel needs ≥ 2 assets');
if (post.content_type === 'carousel' && (item.assets || []).length > 10) errors.push('Carousel max is 10 slides');

// Scheduled drift sanity: if scheduled_at is more than 60 minutes in the future,
// the schedule trigger picked this up too early — skip.
const scheduledAt = new Date(post.scheduled_at || item.job?.scheduled_at).getTime();
const driftSec = (Date.now() - scheduledAt) / 1000;
if (driftSec < -60) errors.push(`Premature claim: scheduled_at is ${Math.abs(driftSec).toFixed(0)}s in the future`);

if (errors.length) {
  return [{ json: { ...item, hasJob: false, error: 'Validation failed: ' + errors.join('; ') } }];
}
return [{ json: item }];
```

### 7.9 Nodes 8a / 8b / 8c — Publish Facebook / Instagram / LinkedIn

Same code shape as V3 but with these changes:

1. Replace `$env.META_PAGE_ACCESS_TOKEN` with the **Meta Graph API** credential attached to `_http` calls.
2. Replace `$env.FACEBOOK_PAGE_ID` with a constant at the top of the node:
   ```javascript
   const FACEBOOK_PAGE_ID = '12345...';  // edit per client
   ```
3. Same for `INSTAGRAM_BUSINESS_ACCOUNT_ID` and `LINKEDIN_ORG_URN`.
4. Replace `files = vault.rawFiles` with `files = item.assets` (uses the unified output of Node 6).
5. Keep `onError: continueRegularOutput` and the `_results` accumulation pattern from V3 (it works).

For each publisher, the success contract is: returns `{ platform, success: true, externalPostId, postUrl }`. The new `postUrl` field is what gets written to `posts.posted_urls`.

**Facebook postUrl:** `https://www.facebook.com/{FACEBOOK_PAGE_ID}/posts/{externalPostId}`
**Instagram postUrl:** `https://www.instagram.com/p/{externalPostId}/` (the API returns the media id; convert to shortcode via a follow-up GET if needed, or store the raw id)
**LinkedIn postUrl:** `https://www.linkedin.com/feed/update/{externalPostId}/`

### 7.10 Node 9 — Finalize Job (Code, rebuilt to write the new columns + audit_log_v2)

```javascript
const SB_URL = 'https://lczmgquuzuqhalasjnip.supabase.co';
const _http = this.helpers.httpRequest.bind(this.helpers);
const auth = { authentication: 'predefinedCredentialType', nodeCredentialType: 'httpHeaderAuth' };

const item = $input.first().json;
const results = item._results || [];
const succeeded = results.filter(x => x.success);
const failed    = results.filter(x => !x.success && !x.skipped);

// 9.1 Per-platform attempt rows
for (const r of results) {
  if (r.skipped) continue;
  await _http({
    method: 'POST',
    url: SB_URL + '/rest/v1/platform_publish_attempts',
    headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
    body: {
      job_id: item.job.id,
      platform: r.platform,
      state: r.success ? 'succeeded' : 'failed',
      external_post_id: r.externalPostId || null,
      post_url: r.postUrl || null,
      response_payload: r.response ? JSON.stringify(r.response).slice(0, 4000) : null,
      error_message: r.error || null,
      attempt_count: (item.job.attempts || 0) + 1,
      updated_at: new Date().toISOString(),
    },
    ...auth,
  });
}

// 9.2 Decide job state + retry strategy
const isTransient = (e) => e && /5\d\d|timeout|ECONN|fetch failed|temporarily unavailable/i.test(String(e));
const allFailed         = succeeded.length === 0 && failed.length > 0;
const allTransient      = allFailed && failed.every(f => isTransient(f.error));
const attempts          = (item.job.attempts || 0) + 1;
const shouldRetry       = allFailed && allTransient && attempts < 3;

let jobState, nextRetryAt = null, lastError = null;
if (succeeded.length > 0 && failed.length === 0) jobState = 'succeeded';
else if (succeeded.length > 0)                   jobState = 'partial';
else if (shouldRetry) {
  jobState = 'pending';
  nextRetryAt = new Date(Date.now() + attempts * 5 * 60 * 1000).toISOString();
  lastError = failed.map(f => `${f.platform}: ${f.error}`).join(' | ');
} else                                            jobState = 'failed';

// 9.3 Build posted_urls jsonb
const postedUrls = {};
for (const s of succeeded) postedUrls[s.platform] = s.postUrl;

// 9.4 Patch the post FIRST (must happen before publish_jobs update so the
//     lockdown trigger sees posted_at and the post.stage='posted' is legal)
if (succeeded.length > 0) {
  await _http({
    method: 'PATCH',
    url: `${SB_URL}/rest/v1/posts?id=eq.${item.post.id}`,
    headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: {
      stage: 'posted',
      posted_at: new Date().toISOString(),
      posted_urls: postedUrls,
      updated_at: new Date().toISOString(),
    },
    ...auth,
  });
}

// 9.5 Patch the publish_jobs row
await _http({
  method: 'PATCH',
  url: `${SB_URL}/rest/v1/publish_jobs?id=eq.${item.job.id}`,
  headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
  body: {
    state: jobState,
    worker_id: null,
    claim_expires_at: null,
    attempts,
    last_error: lastError,
    next_retry_at: nextRetryAt,
    updated_at: new Date().toISOString(),
  },
  ...auth,
});

// 9.6 If permanently failed, push to dead_letter via RPC
if (jobState === 'failed') {
  await _http({
    method: 'POST',
    url: SB_URL + '/rest/v1/rpc/dead_letter_publish_job',
    headers: { 'Content-Type': 'application/json' },
    body: {
      p_job_id: item.job.id,
      p_reason: failed.map(f => `${f.platform}: ${f.error}`).join(' | ').slice(0, 500),
    },
    ...auth,
  });
}

return [{
  json: {
    ...item,
    jobState,
    publishedCount: succeeded.length,
    failedCount: failed.length,
    hasFailures: failed.length > 0,
    willRetry: jobState === 'pending',
    audit: {
      executionId: $execution?.id || 'manual',
      workerId: item.worker_id,
      timestamp: new Date().toISOString(),
      postId: item.post.id,
      postTitle: item.post.title,
      jobId: item.job.id,
      jobState,
      attempts,
      nextRetryAt,
      platforms: results.map(x => ({
        platform: x.platform,
        state: x.success ? 'succeeded' : x.skipped ? 'skipped' : 'failed',
        externalPostId: x.externalPostId || null,
        postUrl: x.postUrl || null,
        error: x.error || null,
      })),
    },
  },
}];
```

### 7.11 Node 10 — Write Audit (Code, fixes D4)

```javascript
const SB_URL = 'https://lczmgquuzuqhalasjnip.supabase.co';
const _http = this.helpers.httpRequest.bind(this.helpers);
const auth = { authentication: 'predefinedCredentialType', nodeCredentialType: 'httpHeaderAuth' };
const item = $input.first().json;

// Write to audit_log_v2 directly (record_audit_event RPC requires auth.uid()
// which we don't have as service_role; the table's RLS allows service role).
await _http({
  method: 'POST',
  url: SB_URL + '/rest/v1/audit_log_v2',
  headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
  body: {
    workspace_id: item.post.workspace_id,
    actor_user_id: null,
    actor_role: 'n8n',
    entity_type: 'post',
    entity_id: item.post.id,
    action: item.jobState === 'succeeded' ? 'auto_published'
          : item.jobState === 'partial'   ? 'auto_published_partial'
          : item.jobState === 'pending'   ? 'auto_publish_retry_queued'
                                          : 'auto_publish_failed',
    metadata: {
      user_name: 'n8n Auto-Publisher',
      details: JSON.stringify(item.audit).slice(0, 4000),
      worker_id: item.worker_id,
      attempts: item.audit.attempts,
      platforms: item.audit.platforms.map(p => ({ platform: p.platform, state: p.state, postUrl: p.postUrl })),
    },
  },
  ...auth,
});

return [{ json: item }];
```

This writes to the SAME table the rest of the audit trail reads from. The `v_audit_log_with_actor` view we just shipped will resolve `actor_role='n8n'` → `actor_name='n8n'` via the existing fallback chain.

### 7.12 Node 11 — Conditional Alert (IF)

If `hasFailures` OR `jobState === 'failed'` (permanent), branch to Send Alert. Otherwise back to Claim Next Job.

### 7.13 Node 12 — Send Alert (Code)

Same as V3 but:
- Reads `ALERT_WEBHOOK_URL` from a **constant at top of node** (or move to credential):
  ```javascript
  const ALERT_WEBHOOK_URL = 'https://hooks.slack.com/services/T.../B.../...';
  ```
- Format the message with `next_retry_at` if it's a retry queued.

### 7.14 Node 13 — Loop back to Claim Next Job

Same as V3 — drain the queue until `hasJob === false`. Cap by `max_jobs_per_run = 5` (Node 3) to avoid one cron tick running 20 publishes serially.

### 7.15 Wire diagram (final)

```
Schedule (1m) ────┐
Manual ─→ DryRun ─┴→ Set RunMode → Claim Job → HasJob? ─NO─→ End
                                                  │
                                                  YES
                                                  ▼
                                    Resolve Media → Pre-flight → Pub FB → Pub IG → Pub LI
                                                                                     │
                                                                                     ▼
                                                           Finalize → Write Audit → Has Failures?
                                                                                     │
                                                                            ┌────────┴──────┐
                                                                            ▼               ▼
                                                                        Send Alert      Loop to Claim
                                                                            │
                                                                            ▼
                                                                        Loop to Claim
```

---

## 8. Verification matrix (the audit step)

After deployment, every one of these must pass before we declare the workflow live. The verifier is mechanical — query, observe, confirm.

| # | Property | How to verify |
|---|---|---|
| V1 | DB rejects manual stage→posted from anon | `UPDATE posts SET stage='posted' WHERE id=...` from a SQL editor signed in as a normal user → expect `POSTED_LOCKDOWN` error |
| V2 | DB rejects service-role write without posted_at | Service-role UPDATE with `stage='posted'` and `posted_at=null` → expect `POSTED_LOCKDOWN` error |
| V3 | Service-role write with posted_at succeeds | Same UPDATE but with `posted_at=now()` → expect 1 row updated |
| V4 | Frontend no longer offers `posted` as drop target | Manual UI test: drag a card to the Posted column → expect a toast "Only n8n publishes to Posted" and the card stays in approved_scheduled |
| V5 | Approving a post creates exactly one publish_jobs row | Approve a post, query `publish_jobs WHERE post_id = X` → expect exactly 1 row with state=pending |
| V6 | n8n claims jobs only when scheduled_at ≤ now() | Set a test post's scheduled_at to NOW+1hr, activate n8n → expect no claim for 1 hour |
| V7 | n8n at most claims one job per worker_id | Manually run two trigger executions back-to-back → expect they don't claim the same job (one returns hasJob=false) |
| V8 | Dry run does not call platform APIs | Manual Trigger → expect _results entries with `skipped: true, reason: dry_run` |
| V9 | Transient failures retry | Force a 503 from FB (block Meta in n8n's outbound) → expect publish_jobs.state='pending', next_retry_at=+5min, attempts=1 |
| V10 | Permanent failures dead-letter | Force a 400 with a malformed caption → expect publish_jobs.state='failed' AND dead_letter_jobs row created |
| V11 | Studio-generated posts publish | Approve a studio-generated post (asset_urls populated) → expect posted with image visible on platform |
| V12 | Legacy posts publish | Approve a manually-uploaded post (source_vault.rawFiles populated) → expect posted |
| V13 | Audit trail shows "n8n Auto-Publisher" | Open the post in the UI → expect timeline row "n8n · Auto Published · 2 min ago" |
| V14 | posted_urls written and clickable | Inspect the post → expect a chip linking to the live URL on each platform |
| V15 | Partial-success path | Force FB to fail, let IG/LI succeed → expect stage='posted', posted_urls has IG+LI keys but no FB, alert sent, audit action='auto_published_partial' |
| V16 | 0026 cleanup zapped the 10 ghost jobs | After migration, `SELECT count(*) FROM publish_jobs WHERE state='pending'` → expect 3 (the legitimately approved-but-future posts) |

A green V1–V16 = workflow is bulletproof per the spec.

---

## 9. Rollout plan

| Stage | What | Risk | Exit criteria |
|---|---|---|---|
| **R0** | Apply migration 0026 (cols, lockdown trigger, claim_publish_job rewrite, cleanup) | Low — strictly additive | Migration applied, V16 passes |
| **R1** | Ship frontend changes (remove drop target + posted badge + queue panel) | Low — UI-only | Build green, V4 passes |
| **R2** | Build the new n8n workflow as "V4 Auto-Publisher" alongside V3. Set V4 inactive. | None | Workflow imported, credentials wired |
| **R3** | Run V4 with Manual Trigger in dry_run mode against 1 real pending job | Low — no platform calls | V8 passes |
| **R4** | Approve 1 test post in a non-prod-visible workspace (or a test post you'll delete after) | Medium — real platform call | V11 passes, see the live post on FB+IG+LI |
| **R5** | Activate the V4 Schedule Trigger; deactivate V3 | Medium — auto-publishing live | V5, V6, V13 all pass on first natural fire |
| **R6** | Watch the Publishing Queue panel for 48 hours, especially May 14 and May 15 (the two legit approved-scheduled posts) | Medium | Both posts go live on time, audit trail clean |

**Rollback at any stage:** flip V4's Schedule Trigger to inactive. Pending jobs stay pending — no data loss.

---

## 10. Kill switches (operator can pull without code change)

| Switch | Effect |
|---|---|
| Deactivate V4 in n8n | Stops all new claims. In-flight job continues to ≤ 120 s claim expiry. |
| Set `publish_jobs.state='paused'` for a specific job | Excluded from claim query (state must be `pending`) |
| `UPDATE publish_jobs SET next_retry_at = '2099-01-01'` | Globally pause all retries |
| Revoke the `Meta Graph API` credential in n8n | All FB/IG publishes fail; LI continues |

---

## 11. Open questions / decisions Aldridge needs to make

These are things I cannot decide alone — they have business-policy implications.

| # | Question | Default if you don't pick |
|---|---|---|
| Q1 | What's the exact `FACEBOOK_PAGE_ID`, `INSTAGRAM_BUSINESS_ACCOUNT_ID`, `LINKEDIN_ORG_URN` for the Ten80Ten brand? | Workflow can't run without these. |
| Q2 | What's the long-lived Meta System User access token? (Page Access Token expires; System User token doesn't) | Workflow can't run. |
| Q3 | What's the LinkedIn access token + refresh policy? (60-day expiry) | Workflow can't run on LI. Build a token-refresh sibling workflow as Phase 2. |
| Q4 | Slack webhook URL for failure alerts? | Alerts go to console.log only. |
| Q5 | Are we keeping the 10 ghost jobs cancelled (default) or do you want a manual review of each? | Cancelled in 0026 cleanup. |
| Q6 | Does `posted` translate to "Live" in the UI label? Or keep "Posted"? | Keep "Posted" as the kanban column label, show "Live" chip on the card when posted_at present. |
| Q7 | What's the alert escalation policy after 3 failed attempts (dead-letter)? Email Aldridge? SMS? Pager? | Slack webhook only; you'll see it in #alerts if you have one. |
| Q8 | Should the publisher backfill `posted_at` for the 7 posts already in `stage='posted'` (manually dragged in prior eras)? | Leave NULL; "Live" chip simply won't show for those legacy rows. |

---

## 12. What I'll need from you to execute this

A single message back with the answers/values for:

1. **`SUPABASE_SERVICE_ROLE_KEY`** — you have it; share it the same way as before (or I can pull it from `.env.local` if it's there)
2. **Meta tokens & IDs** — Q1, Q2 above
3. **LinkedIn tokens & IDs** — Q3
4. **Slack webhook** — Q4
5. **Yes/No on the 10 ghost-job cleanup** — Q5
6. **Sign-off to proceed** — explicit "build it" so I don't auto-trigger this in the middle of another task

After that, the execution order is: 0026 migration → frontend lockdown + queue panel → V4 workflow import → dry-run test → real-post test on May 14 → flip to live.

Estimated implementation time once values are in hand:
- 0026 migration + apply + verify: 15 min
- Frontend (UI guard + queue panel + posted badge): 60 min
- V4 workflow JSON rewrite: 90 min
- End-to-end verification (V1–V16): 45 min
- Total: ~3.5 hours

---

## Appendix A — Why credentials beat baked constants for the token

You said "we cannot do env variables in the settings, thus we can put them in the node if thats possible." Both options work mechanically. Credentials are strictly better for this reason: when a token rotates (LinkedIn does every 60 days, Meta tokens after a security incident), updating a credential is one click. Editing every code node to change a string is brittle — you'd update it in 5 places and miss one. Credentials are also encrypted at rest in n8n's database; baked constants are stored in plaintext in the workflow JSON which gets emailed/version-controlled.

If you insist on raw constants, every place I wrote `authentication: 'predefinedCredentialType', nodeCredentialType: 'httpHeaderAuth'` would become `headers: { Authorization: 'Bearer ' + TOKEN }` with `const TOKEN = '...'` at the top of the node. The workflow still works; you just lose the rotation ergonomics.

## Appendix B — Why we don't use the n8n "Postgres" node

The n8n Postgres node connects directly to Supabase's Postgres port (5432). That port is firewalled on Supabase (you've seen the pattern with the mailroom project). Even when it works, it bypasses RLS and PostgREST's input validation. We use REST + service role key so we exercise the same code path the app uses, which means RLS bugs surface in development not production.

## Appendix C — Why retry is capped at 3, not infinite

3 retries × 5-minute backoff × 3 platforms = up to 45 minutes of attempts on a single post before dead-letter. Beyond that, the failure is almost certainly permanent (revoked token, deleted page, malformed media). Keeping the worker busy on a doomed post starves legitimate posts in the queue.

## Appendix D — Why scheduled_at, not scheduled_date + scheduled_time

Migration 0012 already derived `scheduled_at` (tstz) from `scheduled_date` + `scheduled_time` + `scheduled_timezone`. The publisher compares `scheduled_at <= now()` in UTC. No tz math in n8n. Operators continue to enter the time in their local tz via the UI; the DB stores the canonical UTC; n8n compares UTC. Three independent layers, one source of truth.

---

**End of plan.** Ready for Aldridge's answers to §11. After "build it", I execute in the order in §9.
