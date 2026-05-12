# AI Content Generation MVP — Ten80Ten SMM Portal

**Date:** 2026-05-13
**Author:** Plan generated for Aldridge after the adversarial-audit re-ship
**Stack confirmed:** Next.js 16.2.0 (App Router, Turbopack) · TypeScript strict · React 19.2 · Supabase (Postgres + RLS + Realtime) · Vercel · nodemailer · Google Drive service account
**Status of project:** Live at `smm.ten80ten.com`, just shipped Step 1 + Groups A-E of the security audit (commits `0d6c934` → `f6b9af0`) plus migrations `0015`, `0016`, `0018`, `0019`.

---

## 0. Constraints learned from this conversation

These are not negotiable. Every step below respects them.

1. **`AGENTS.md` iron laws.** Posts never silently vanish. `workspace_id` on every insert. `isValidUuid()` guard before every Supabase op on a card id. `record_audit_event` RPC, not direct writes to `post_audit_logs`.
2. **The provider hierarchy bug** (root cause of the cf20bbd black-screen). `ToastProvider` MUST stay above `PipelineProvider` in `app-shell.tsx`. Any new context that consumes `useToast()` from PipelineProvider land has to land inside this hierarchy.
3. **Service Worker v3 stays bulletproof.** No regressions to navigation interception or the validResponse contract.
4. **Bisectable commits.** Ship in 4-6 small commits so any breakage rolls back fast — same discipline that got us out of the cf20bbd hole.
5. **DB migrations are strictly additive.** No NOT NULL on new columns, no enum value changes, no renames, no drops.
6. **AI must never approve, schedule, publish, or delete.** Server-side guard: every insert/update from AI endpoints forces `stage = 'awaiting_approval'`. The kanban stage transitions remain human-only.

---

## 1. Existing state — what we reuse

### 1.1 Schema (verified live via Supabase Management API earlier this session)

**posts table columns (already present):**
- `id uuid pk`, `title text not null`, `stage pipeline_stage not null default 'ideas'`
- `platforms text[]`, `content_type content_type not null default 'video'`
- `thumbnail_url text`, `scheduled_date date`, `scheduled_time time`
- `scheduled_at timestamptz`, `scheduled_timezone text default 'America/Chicago'`
- `caption text`, `hook text`, `notes text`, `checklist jsonb default '[]'`
- `media_ids text[]`, `source_vault jsonb default '{}'`
- `asset_source text`, `license_file_id text`
- `created_by text`, `workspace_id uuid not null` (no default)
- `created_at timestamptz default now()`, `updated_at timestamptz default now()`

**Stage enum (live):** `ideas`, `awaiting_approval`, `revision_needed`, `approved_scheduled`, `posted`.

**Map the user's stage vocab to the actual enum:**

| User-facing label in prompt | DB stage |
|---|---|
| Awaiting Approval | `awaiting_approval` |
| Revision Needed | `revision_needed` |
| Approved + Scheduled | `approved_scheduled` (merged in our DB) |
| Published | `posted` |

**Triggers on posts (live):** `posts_updated_at`, `posts_audit_before_delete`, `posts_protect_approved_and_posted`, `posts_audit_stage_change`. Iron law enforcement.

**brand_playbook table (live, singleton row id='singleton'):** `data jsonb` with fields `phone`, `website`, `tagline`, `hashtagCore`, `hashtagSeasonal`, `hashtagEngagement`, `hashtagCommercial`, `hooks[]`, `ctas[]`, `whenToPost`, `contentPillars[]`, `brandVoice`. This is the existing brand store — AI uses it.

**audit_log_v2 table (live):** workspace-scoped, write via `record_audit_event(p_entity_type, p_action, p_entity_id, p_metadata)` RPC.

### 1.2 Code surfaces we'll touch or reference

- `src/lib/pipeline-context.tsx` — the iron-law file. `createCard`, `moveCard`, `updateCard`, `submitReapproval`, `submitKickback`, `deleteCard`. Already exposes `workspaceId`. Adds rollback toasts on failure.
- `src/lib/types.ts` — `ContentCard` type, `PIPELINE_COLUMNS`, `PipelineStage` enum.
- `src/lib/auth-context.tsx` — `useAuth()` gives `currentUser`, `accessToken`, `provisionResult`.
- `src/lib/auth/require.ts` — already has `requireBearerTeamRole(req, [...roles])` for server-side gating. Reuse for AI endpoints.
- `src/lib/rate-limit.ts` — `consume(scope, key, limit, windowSeconds)`. Reuse.
- `src/components/kanban-board.tsx` — Ideas column is where AI-generated drafts would normally land if they bypassed the iron law; we route them to `awaiting_approval` instead, so the button lives outside the Ideas column.
- `src/components/create-post-modal.tsx` — manual creation. AI generation goes BESIDE this, not inside it.
- `src/components/asset-review-drawer.tsx` — opens when a card is selected. "Revise with AI" lives here.
- `src/components/content-card.tsx` — the card UI. "AI Generated" badge lives here.
- `src/components/app-shell.tsx` — provider hierarchy. ToastProvider wraps PipelineProvider as of commit `4ab846d`. Do NOT reorder.

### 1.3 Env already in `.env.local`

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ACCESS_TOKEN` ✓
- SMTP_*, GOOGLE_*, N8N_* ✓
- **MISSING for this feature:** `OPENAI_API_KEY`, `OPENAI_MODEL` (default suggested below)

---

## 2. New schema — migration 0020

`supabase/migrations/0020_ai_content_fields.sql`. **Strictly additive.** Every new column nullable except `revision_count` which gets a default of 0.

```sql
-- 0020_ai_content_fields.sql
-- Additive: adds AI-generation metadata + content-strategy fields to posts.
-- All new columns nullable so the old client keeps inserting without them.
-- revision_count defaults to 0 (existing rows will be backfilled to 0 by
-- the column default at ALTER time).
--
-- Pairs with the AI generation MVP routes /api/ai/* (2026-05-13).

ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS content_pillar       text,
  ADD COLUMN IF NOT EXISTS target_audience      text,
  ADD COLUMN IF NOT EXISTS business_objective   text,
  ADD COLUMN IF NOT EXISTS visual_brief         text,
  ADD COLUMN IF NOT EXISTS post_format          text,
  ADD COLUMN IF NOT EXISTS carousel_outline     jsonb,
  ADD COLUMN IF NOT EXISTS hashtags             text[],
  ADD COLUMN IF NOT EXISTS cta                  text,
  ADD COLUMN IF NOT EXISTS source_notes         jsonb,
  ADD COLUMN IF NOT EXISTS quality_score        smallint
    CHECK (quality_score IS NULL OR (quality_score BETWEEN 1 AND 10)),
  ADD COLUMN IF NOT EXISTS approval_notes       text,
  ADD COLUMN IF NOT EXISTS generated_by_model   text,
  ADD COLUMN IF NOT EXISTS prompt_version       text,
  ADD COLUMN IF NOT EXISTS revision_count       integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS approved_by          text,
  ADD COLUMN IF NOT EXISTS approved_at          timestamptz;

-- Index to surface AI-generated posts cheaply in the UI.
CREATE INDEX IF NOT EXISTS idx_posts_generated_by_model
  ON posts(generated_by_model)
  WHERE generated_by_model IS NOT NULL;
```

**Why additive:** the rolled-back code from `7889a94` keeps working — `dbToCard` ignores unknown columns, `cardToDb` only emits known fields. The new client emits the new fields once it ships.

**Stage transitions for AI:**
- AI generate → insert with `stage = 'awaiting_approval'` (server-forced, ignores anything the model returns)
- AI revise → update existing row with `stage = 'awaiting_approval'`, `revision_count = revision_count + 1`
- AI **cannot** write `approved_scheduled` or `posted` — server validates and rejects

---

## 3. New server modules

### 3.1 `src/lib/ai/types.ts`

```ts
export type BusinessObjective =
  | "awareness" | "authority" | "engagement"
  | "lead_generation" | "trust_building" | "education";

export type PostFormat =
  | "carousel" | "reel" | "static graphic" | "text post"
  | "short video" | "story" | "thread";

export type AiPlatform =
  | "LinkedIn" | "Instagram" | "Facebook" | "TikTok"
  | "YouTube Shorts" | "Multi-platform";

export interface AiDraftRequest {
  date: string;                    // YYYY-MM-DD
  platform: AiPlatform | AiPlatform[];
  content_pillar?: string;
  post_format?: PostFormat;
  target_audience?: string;
  topic?: string;
  campaign?: string;
  notes?: string;
}

export interface AiDraftResponse {
  status: "Awaiting Approval";     // always; server overrides if not
  date: string;
  recommended_time: string;        // HH:MM, CST
  platform: AiPlatform | AiPlatform[];
  content_pillar: string;
  post_format: PostFormat;
  target_audience: string;
  business_objective: BusinessObjective;
  hook: string;
  caption: string;
  visual_brief: string;
  carousel_or_video_outline: string[];
  cta: string;
  hashtags: string[];
  source_notes: string[];
  quality_score: number;           // 1-10
  approval_notes: string;
}
```

### 3.2 `src/lib/ai/system-prompt.ts`

Holds the verbatim system prompt from the user request, plus a `PROMPT_VERSION` constant we can bump when we iterate. Exports `buildSystemPrompt(brand: BrandPlaybook)` which interpolates the live `brand_playbook` row into the prompt.

### 3.3 `src/lib/ai/openai-client.ts`

Thin server-side wrapper around the OpenAI Responses API. No SDK — native `fetch` to `https://api.openai.com/v1/responses`. Why:
- One fewer dependency to audit
- Easier to swap models / endpoints
- No bundle bloat in the server build

```ts
export async function callResponsesApi(args: {
  model: string;
  instructions: string;
  input: string | unknown[];
  schema: object;                 // JSON schema for response_format
}): Promise<unknown>
```

Implementation notes:
- Reads `OPENAI_API_KEY` from env (`assertEnv`)
- Sends `response_format: { type: "json_schema", json_schema: { name, schema, strict: true } }`
- 30s timeout via `AbortController`
- 3-attempt exponential backoff on 429/500/502/503/504
- Permanent failures (400/401/403/404) throw immediately
- Returns parsed `output_text` JSON or throws

### 3.4 `src/lib/ai/validation.ts`

Validates the parsed AI response against `AiDraftResponse` shape. Hand-rolled (no zod dependency to avoid bundle changes). Rules from the user spec:

- `status === "Awaiting Approval"` (warn + force, never reject)
- `caption.trim().length > 0`
- `platform` is one of the valid values (string or string[])
- `hashtags` is an array (max 30 entries, each <= 100 chars)
- `quality_score` is an integer 1-10
- `business_objective` is one of the enum
- `post_format` is one of the enum

Returns a typed `{ ok: true, value } | { ok: false, error }` result.

### 3.5 `src/lib/ai/persist.ts`

Translates an `AiDraftResponse` into a posts-table row. Owns the iron-law guarantees:

- `stage = 'awaiting_approval'` (hardcoded, never trusts the model)
- `workspace_id` from the authenticated caller's session (server-derived)
- `generated_by_model`, `prompt_version`, `created_by = "ai:<actor email>"`
- `content_type` mapped from `post_format` (carousel→carousel, reel→reel, video/short video→video, static graphic→image, etc.)
- `platforms` normalized to a lowercased array matching the existing enum values
- `revision_count = 0` on insert; `+= 1` on revise

Records every insert and revise to `audit_log_v2` via `record_audit_event` with metadata `{ model, prompt_version, tokens_in, tokens_out, latency_ms }`.

---

## 4. New API routes

All three live under `src/app/api/ai/`. All three:
- Require Bearer + writer-class role via `requireBearerTeamRole(req, [...])`. Writers: superadmin, admin, owner, approver, creative_director, editor, social_media_specialist, video_editor, graphic_designer, specialist.
- Use the service-role admin client to do the actual posts insert/update, after the auth check.
- Rate-limited via `consume()`.
- Server-only — never expose `OPENAI_API_KEY` to the client.
- Return `{ post: PostRow }` on success, `{ error: string }` on failure.

### 4.1 `POST /api/ai/generate-draft`

`src/app/api/ai/generate-draft/route.ts`

**Rate limit:** 20 req/min per user+IP.
**Input:** `AiDraftRequest` (see types).
**Flow:**
1. `requireBearerTeamRole(req, [writer roles])` → `{ user, role }`
2. `consume("ai-generate:user", "user:<uid>|ip:<ip>", 20, 60)`
3. Load `brand_playbook` row (service-role read).
4. Load the 20 most recent posts in the caller's workspace (id, title, hook, caption, content_pillar) — context for "avoid repetition".
5. Build OpenAI request:
   - `model = process.env.OPENAI_MODEL || "gpt-5-mini"` (cheap default; configurable)
   - `instructions = buildSystemPrompt(brand)` + the "don't repeat these recent posts" appendix
   - `input = JSON.stringify(req.body)` plus a list of recent post hooks
   - `schema = AI_DRAFT_SCHEMA` (JSON Schema mirroring `AiDraftResponse`)
6. `callResponsesApi(...)` → parsed JSON
7. `validateAiDraft(json)` → `{ ok, value }`. On `!ok`, return 502 with the validation error AND log to audit.
8. `persistAiDraft(value, { workspace_id, actor_email, model, prompt_version })` → inserts row, returns row
9. Record audit `ai_draft_generated` with token usage and model.
10. Return `200 { post }`.

### 4.2 `POST /api/ai/revise-draft`

`src/app/api/ai/revise-draft/route.ts`

**Rate limit:** 30/min per user+IP.
**Input:** `{ post_id: uuid, reviewer_notes: string }`
**Flow:**
1. Auth + rate limit (same).
2. Fetch the post via admin client. 404 if not found.
3. Validate: `post.workspace_id` matches caller's `workspace_members` row, and `post.stage === 'revision_needed'`, and `reviewer_notes.trim().length > 0`.
4. Build OpenAI request: instructions + a "revise per these notes" payload that includes the original post fields + reviewer notes.
5. Call → parse → validate.
6. Update the existing row with the new fields: hook, caption, hashtags, visual_brief, carousel_outline, cta, approval_notes, quality_score, content_pillar (if set), target_audience, business_objective, post_format. Force `stage = 'awaiting_approval'`. Increment `revision_count`. Update `updated_at` (the trigger does this).
7. Record audit `ai_draft_revised` with `{ revision_count, reviewer_notes_excerpt }`.
8. Return `200 { post }`.

**Hard guard:** never touch `approved_by`, `approved_at`, `scheduled_at`, `scheduled_date`, `scheduled_time` here. Those stay human-controlled.

### 4.3 `POST /api/ai/generate-calendar` (optional, ship in phase 2)

`src/app/api/ai/generate-calendar/route.ts`

**Rate limit:** 5/min per user+IP, AND a daily cap of 50 generations per workspace (audit_log_v2 query).
**Input:** `{ start_date, end_date, posts_per_day: 1|2|3 }`
**Validation:** `end_date - start_date <= 14 days`, `posts_per_day <= 3`, total <= 42 posts.
**Flow:** For each day × posts_per_day, call the same generate-draft logic (with day rotation through `content_pillar` if not specified). Aggregate `{ inserted: N, skipped: M }`. Each insert is its own audit log entry.

---

## 5. Pipeline-context + types extension

### 5.1 `src/lib/types.ts`

Add to `ContentCard`:

```ts
contentPillar?: string;
targetAudience?: string;
businessObjective?: "awareness"|"authority"|"engagement"|"lead_generation"|"trust_building"|"education";
visualBrief?: string;
postFormat?: "carousel"|"reel"|"static graphic"|"text post"|"short video"|"story"|"thread";
carouselOutline?: string[];
hashtags?: string[];
cta?: string;
sourceNotes?: string[];
qualityScore?: number;
approvalNotes?: string;
generatedByModel?: string;
promptVersion?: string;
revisionCount?: number;
approvedBy?: string;
approvedAt?: string;
```

### 5.2 `src/lib/pipeline-context.tsx`

- Extend `PostRow` / `PostUpdate` types with the new columns.
- Update `dbToCard` to read them.
- Update `cardToDb` to write them (only when the caller passes them — manual creation paths stay untouched).
- The `POSTS_SELECT_FULL` query already uses `*`, so the new columns automatically come back. No realtime tweaks needed.

### 5.3 Realtime echo

INSERT / UPDATE events for AI-generated posts arrive via the existing channel. The current `markMutation` dedup uses tempId + real UUID for client-initiated inserts. AI inserts come from the SERVER and the caller's tab will see the INSERT event for the first time — that's the correct UX (a toast or auto-scroll to it). No code change needed; just be aware the user clicking "Generate AI Draft" gets the new card appearing via realtime within 1-2 seconds.

---

## 6. Frontend UX

Smallest viable surface area. No new routes, no new top-level components.

### 6.1 "Generate AI Draft" — new modal `src/components/ai-generate-modal.tsx`

Triggered by a button in `kanban-board.tsx`, placed in the existing top-bar of the kanban view (next to the "Pipeline / Archive" tab buttons).

Inputs (form fields):
- Date (date input, defaults to tomorrow)
- Platform (multi-select from existing `ALL_PLATFORMS` + "Multi-platform")
- Content pillar (free text, autosuggest from `brand_playbook.data.contentPillars`)
- Post format (select)
- Target audience (free text)
- Topic (free text, optional)
- Campaign (free text, optional)
- Notes (textarea, optional)

Submit calls `/api/ai/generate-draft` with the access token from `useAuth()`. Shows a loading state. On success closes and toasts "Draft created — review it in Awaiting Approval." On failure toasts the error message.

**Provider-hierarchy safety:** modal lives inside the `ToastProvider`+`PipelineProvider` tree per the cf20bbd lesson.

### 6.2 "Revise with AI" button — inside `asset-review-drawer.tsx`

Visible only when `card.stage === 'revision_needed'` AND `card.notes` (the reviewer notes) is non-empty.

On click: prompts confirmation, then POSTs to `/api/ai/revise-draft` with `{ post_id, reviewer_notes: card.notes }`. Toasts result. The realtime UPDATE echo refreshes the card.

### 6.3 "AI Generated" badge — `src/components/content-card.tsx`

When `card.generatedByModel` is set, show a small pill near the top-right of the card: `AI` with a sparkle icon (lucide `Sparkles`). Color: subtle purple/blue tint, consistent with the existing palette.

### 6.4 Display new fields in `asset-review-drawer.tsx`

- `approval_notes` shown above the existing reviewer notes section
- `quality_score` shown as a small ratings indicator (e.g. "AI quality: 7/10")
- `content_pillar`, `target_audience`, `business_objective`, `cta` shown in the Details tab as readonly chips

**No new context required.** Everything piggybacks on `usePipeline()`.

### 6.5 Optional — Calendar generation

A second button in kanban-board, "Generate Calendar", opening a smaller form (start, end, posts_per_day). Defers to phase 2 if scope creeps.

---

## 7. Brand rules — where they live

Two layers:

1. **`brand_playbook` row** — already in the DB, edited via Settings → Brand Kit page. This is the source of truth for hashtags, hooks, ctas, content pillars, brand voice. AI fetches it on every request.
2. **`src/lib/ai/brand-rules.ts`** — code-side constants the model needs that aren't in the playbook today. Specifically: the "do / avoid" lists from the user's prompt (avoid generic motivational quotes, avoid pushy sales, etc.). Lives in code because it's behavior, not data.

The system prompt interpolates both. Updating the `brand_playbook` row immediately changes AI behavior on the next request — no redeploy.

---

## 8. Acceptance criteria (testable)

1. Migration 0020 applies cleanly on prod via the Management API. `\d posts` shows the 14 new columns. Existing rows have `revision_count = 0`.
2. `POST /api/ai/generate-draft` without an `Authorization: Bearer ...` header returns 401.
3. `POST /api/ai/generate-draft` with a viewer-only Bearer returns 403.
4. `POST /api/ai/generate-draft` with a writer Bearer and a valid body:
   - Returns 200 with `post.stage === 'awaiting_approval'`
   - Inserts a row visible in the Kanban "Awaiting Approval" column within 2s via realtime
   - `generated_by_model` and `prompt_version` are populated
   - `audit_log_v2` has an `ai_draft_generated` entry
5. The AI-returned `status` field is ignored if it's anything other than "Awaiting Approval" — server forces it.
6. `POST /api/ai/revise-draft` on a card NOT in `revision_needed` returns 409.
7. `POST /api/ai/revise-draft` with empty reviewer_notes returns 400.
8. `POST /api/ai/revise-draft` on a valid card increments `revision_count` and sets `stage` back to `awaiting_approval`.
9. The "AI" badge appears on cards where `generated_by_model` is non-null.
10. Hitting rate limits returns 429 with a retryable error, not a 500.
11. `OPENAI_API_KEY` is not present in any client bundle (`grep -r OPENAI_API_KEY .next/static` returns nothing).
12. `npm run typecheck` and `npm run lint` both clean after each commit.
13. The original manual post creation, drag-drop, kickback, reapproval, and approval flows are unchanged.

---

## 9. Risks + mitigations

| Risk | Mitigation |
|---|---|
| OpenAI cost runs away on calendar generation | Per-user rate limit + daily workspace cap + per-call token cap via `max_output_tokens` |
| Model returns malformed JSON | JSON Schema enforced via `response_format: { type: "json_schema", strict: true }`; second validation layer in `validation.ts` rejects on any non-conforming output |
| AI bypasses the iron law and writes `approved_scheduled` | Server hardcodes `stage = 'awaiting_approval'` ignoring model output; 0015 trigger blocks any later hard-delete of approved/posted; admin-only DELETE policy |
| Cross-workspace insertion via service-role client | All inserts derive `workspace_id` from `requireBearerTeamRole(req)` result, never from request body |
| Empty `brand_playbook` produces generic AI output | First-run check: if brand_playbook.data has any of the placeholder strings (`"Sample hook 1"`, `"Define your brand voice..."`), return 503 with a clear error directing the admin to update the brand kit first |
| Realtime echo creates duplicate card on the originating tab | Server response is the source of truth; the calling tab inserts via realtime only, no optimistic local insert needed |
| `OPENAI_API_KEY` accidentally exposed | Server-only env (no `NEXT_PUBLIC_`); audit grep at build time; `serverExternalPackages` array unchanged so no client-side import |
| Migration adds NOT NULL by accident | All `ADD COLUMN` calls explicitly `IF NOT EXISTS` and nullable except revision_count (which has a default) |
| Provider hierarchy regression | `app-shell.tsx` change is forbidden in this feature scope; tests cover the AI button rendering path which would crash if hierarchy reverted |
| OpenAI Responses API rate limits | Backoff with 3 attempts, 1s/2s/4s delays; surface 429 to the user with a retry hint |
| Stale brand_playbook cache | Each request fetches the row fresh (no in-process cache) |

---

## 10. Commit plan (bisectable, same discipline as Group A-E)

Each commit ships independently, typechecks, lints, builds, deploys.

1. **Commit 1 — DB only.** Migration 0020 added to repo + applied to prod via Management API. No code changes. Verify via Management API query before committing.
2. **Commit 2 — AI plumbing (server, no UI).** `src/lib/ai/{types,system-prompt,openai-client,validation,persist,brand-rules}.ts` and `src/app/api/ai/generate-draft/route.ts`. Manually testable via `curl` with a valid Bearer.
3. **Commit 3 — Revise endpoint.** `src/app/api/ai/revise-draft/route.ts`.
4. **Commit 4 — Type + pipeline-context plumbing.** Adds new fields to `ContentCard` + `PostRow` + `dbToCard`/`cardToDb`. No new UI yet; just makes the data flow through.
5. **Commit 5 — UI buttons + modal.** `ai-generate-modal.tsx`, kanban button, revise button in drawer, AI badge in content-card. This is the user-facing surface.
6. **Commit 6 — Optional calendar generation.** Only after 1-5 are stable in prod. Defer if scope tight.

Each commit followed by Vercel deploy verification before the next. Roll back via `vercel rollback` if anything regresses, mirroring the recent crisis recovery.

---

## 11. Manual test plan

After commits 1-5 are live:

1. **As admin:**
   - Sign into smm.ten80ten.com
   - Click "Generate AI Draft" in the kanban
   - Fill: Date = tomorrow, Platform = LinkedIn, Content Pillar = "Workflow cleanup", Topic = "5 signs your business needs automation"
   - Submit → should see toast "Draft created" within ~5s
   - Awaiting Approval column should show a new card with the AI badge
   - Open the card → see hook, caption, hashtags, visual brief, carousel outline, quality score, approval notes
2. **Send to revision:**
   - Drag the card to Revision Needed
   - Type reviewer notes: "Make the hook more punchy and remove the 5-step list"
   - Click "Revise with AI"
   - Card should update within ~5s, `revision_count = 1`, stage back to Awaiting Approval
3. **Approve manually:**
   - Drag to Approved/Scheduled → confirms human approval flow still works
4. **Verify in audit_log_v2:**
   - Two events present: `ai_draft_generated`, `ai_draft_revised`
5. **As viewer:**
   - The "Generate AI Draft" button should be hidden OR clicking it gives a 403 toast
6. **Curl negative tests:**
   - `curl -X POST .../api/ai/generate-draft` → 401
   - `curl -X POST .../api/ai/generate-draft -H "Authorization: Bearer FAKE" -d '{}'` → 401
   - Rapid-fire 25 valid requests → 429 after 20
7. **Cost check:**
   - `audit_log_v2` shows token usage per call. Sum for the test session should be reasonable (<$0.05 with gpt-5-mini).

---

## 12. Environment variables to add

```
# OpenAI Responses API — for /api/ai/* routes
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-5-mini
# Optional: bump this to invalidate cached prompts after a system-prompt edit
OPENAI_PROMPT_VERSION=2026-05-13.v1
```

`OPENAI_API_KEY` must be added in **Vercel project env vars** AND in local `.env.local`. Production scope only — leak risk if mirrored to preview.

---

## 13. Out of scope (explicit non-goals)

- No fine-tuning. The MVP uses a stock OpenAI model.
- No image generation. Visual brief is text only; image production stays human.
- No automatic scheduling. AI never sets `scheduled_at`.
- No competitor research. The "load recent posts" context is the only retrieval.
- No vector DB. If we want similarity-based avoidance later, that's a separate plan.
- No streaming responses to the UI. JSON only, single shot per generation.
- No multi-language. English only.
- No webhook ingestion (Linear, Slack, etc.). Future iteration.

---

## 14. Decisions locked in 2026-05-13

1. **Model.** `OPENAI_MODEL=gpt-5-mini` (env-configurable; admin can swap without redeploy).
2. **Allowed roles for AI generation:** `superadmin`, `admin`, `owner`, `creative_director`. Writer roles below creative_director (editor, social_media_specialist, video_editor, graphic_designer, specialist) are excluded — they can still manually create posts but cannot trigger the AI endpoints.
3. **Calendar generation:** **Phase 2.** MVP ships single-draft + revise only. Calendar after we have real token-cost data.
4. **Brand rules location:** **All in DB.** `brand_playbook.data` gains two new JSON arrays:
   - `doFocus` — content topics to focus on (10 entries: Business systems, Workflow cleanup, Automation, AI tools, Virtual assistants, Delegation, Operations support, Founder and operator pain points, Before-and-after process improvements, Practical business education).
   - `doAvoid` — patterns to refuse (8 entries: Generic motivational quotes, Pushy sales language, Fake case studies, Fake testimonials, Too many hashtags, Buzzword-heavy captions, Repetitive hooks, Overpromising).

   No code-side `brand-rules.ts` file. The system prompt builder reads `data.doFocus` and `data.doAvoid` from the singleton row at request time. Admins can edit them through the existing Brand Kit page once the Settings UI is extended (out of MVP scope; can be done in a follow-up).

## 14b. Required role-check change

The role gate is narrower than the original draft. Update `requireBearerTeamRole(req, [...])` call in every `/api/ai/*` route to:

```ts
const ctx = await requireBearerTeamRole(req, [
  "superadmin", "admin", "owner", "creative_director",
]);
```

Document in `src/lib/ai/persist.ts` that anyone outside this set gets a 403 from these endpoints (manual post creation through `/api/team/*` and the pipeline-context flow remains open to all writers).

## 14c. Schema update applied 2026-05-13

Migration 0020 already applied to production Supabase (project `lczmgquuzuqhalasjnip`) via the Management API on 2026-05-13. Verified via `information_schema.columns` query: 16 new columns present with the expected types and nullability. `brand_playbook.data` seeded with `doFocus` + `doAvoid` arrays on the singleton row. The .sql file lives at `supabase/migrations/0020_ai_content_fields.sql` for repo history; it is NOT yet committed.

---

## 15. Ready-to-execute summary

This plan respects every iron law and every lesson from the past 2 hours of crisis. It's:

- **Bisectable** — 5-6 small commits, each independently deployable and rollback-safe
- **Additive** — no destructive schema changes, no provider-hierarchy churn, no removed features
- **Server-isolated** — OpenAI calls never touch the client; API key never reaches the browser
- **Iron-law-compliant** — AI cannot approve, schedule, publish, or delete; the kanban transitions remain human-controlled
- **Auditable** — every AI call leaves a `record_audit_event` row in `audit_log_v2` with model + token + post id
- **Cost-bounded** — rate limits, daily caps, sensible model default

On your go I'll execute commit 1 (migration only), verify the column shape on the live DB, then proceed through commits 2-5 with deploy verification between each.
