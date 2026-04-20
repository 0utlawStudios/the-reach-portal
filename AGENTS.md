<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# CONTENT ENGINE — HARD RULES FOR ALL AGENTS AND DEVELOPERS

These rules are non-negotiable. They exist because bugs in the pipeline
caused posts to silently vanish. Every rule below maps to a real incident.
Violating any of them will cause data loss or broken user-facing behavior.

**This file is read by Claude, Codex, and any future AI agent working on this codebase.**

---

## 1. POSTS MUST NEVER DISAPPEAR — THE IRON LAW

**NEVER write code that causes a user's post to vanish from the board
on a page refresh, a stage move, or any automated operation.**

This is the single most important rule. A post is a user's work product.
Silent data loss is catastrophic. Enforce it at every layer:

### 1a. Database layer (migration 0015)
Three PostgreSQL triggers are in place:
- `posts_audit_before_delete` — logs every delete to audit_log_v2 BEFORE the row is removed
- `posts_protect_approved_and_posted` — BLOCKS hard-delete of posts in `approved_scheduled` or `posted` stage
- `posts_audit_stage_change` — writes a stage-change entry to audit_log_v2 on every UPDATE that changes stage

Do NOT drop or disable these triggers.

### 1b. Code layer — load() in pipeline-context.tsx
The `load()` function MUST:
- Call `/api/workspace/provision` BEFORE querying posts, so workspace membership is established
- Use the DB result even when it returns an empty array. Empty array = empty board. This is correct.
- ONLY fall back to localStorage when `result.error` is truthy (real DB error, not empty result)
- NEVER call `setCards(PLACEHOLDER_CARDS)` or `setCards(loadState(..., PLACEHOLDER_CARDS))` when Supabase is configured and the user is authenticated

The following pattern is FORBIDDEN:
```js
// WRONG — falls back to placeholder on empty result, masking real data
if (!result.error && result.data && result.data.length > 0) {
  setCards(result.data.map(dbToCard));
} else {
  setCards(loadState(STORAGE_KEY, PLACEHOLDER_CARDS)); // ← THIS IS THE BUG
}
```

The correct pattern:
```js
// CORRECT — empty array is a valid state (no posts yet)
if (!result.error && result.data) {
  setCards(result.data.map(dbToCard));
} else {
  setCards(loadState(STORAGE_KEY, PLACEHOLDER_CARDS)); // only on error
}
```

### 1c. createCard — workspace_id is ALWAYS required
Every INSERT to `posts` MUST include `workspace_id`. The column is NOT NULL
with no DEFAULT (migration 0004). If workspace_id is omitted, the insert
silently fails and the card is lost on the next refresh.

ALWAYS use the fallback pattern:
```js
insertRow.workspace_id = workspaceIdRef.current || "00000000-0000-0000-0000-000000000001";
```

NEVER use the conditional-only pattern:
```js
if (workspaceIdRef.current) insertRow.workspace_id = workspaceIdRef.current;
// ← FORBIDDEN: omits workspace_id when ref is null, causing silent insert failure
```

---

## 2. WORKSPACE_ID IS REQUIRED ON EVERY INSERT

Every table in this database has `workspace_id UUID NOT NULL` (migration 0004).
RLS policies (migration 0007) gate all SELECT, INSERT, UPDATE, DELETE on
`is_active_workspace_member(workspace_id, ...)`.

**Before inserting to any of these tables, always include workspace_id:**
- `posts`
- `post_comments`
- `media_assets`
- `brand_playbook`
- `post_audit_logs` (legacy — use audit_log_v2 via RPC instead)

The baseline workspace UUID for this single-tenant deployment:
```
'00000000-0000-0000-0000-000000000001'
```

---

## 3. AUDIT LOGS — USE record_audit_event(), NOT post_audit_logs

The legacy `post_audit_logs` table has NO INSERT RLS policy for authenticated users.
Client-side writes to it are silently blocked (migration 0007 intentionally excluded INSERT).

**All audit writes from client code must use:**
```js
await supabase.rpc("record_audit_event", {
  p_entity_type: "post",
  p_action: actionType,
  p_entity_id: isValidUuid(postId) ? postId : null,
  p_metadata: { user_name: userName, details: details || null },
});
```

Server-side API routes may use the admin client to write to `audit_log_v2` directly,
or call `admin.rpc("record_audit_event", {...})`.

**All audit reads must use `audit_log_v2`, not `post_audit_logs`.**

---

## 4. RLS — WORKSPACE_MEMBERS IS THE GATE FOR EVERYTHING

Every domain table uses `is_active_workspace_member(workspace_id, ...)`.
If a user is not in `workspace_members` with `status = 'active'`, they
cannot SELECT, INSERT, UPDATE, or DELETE any domain row.

The self-healing provisioner at `/api/workspace/provision` (GET) resolves
this on every app load. It uses the service role to add missing users based
on their `team_members` row. Do NOT remove or bypass this call.

---

## 5. isValidUuid() GUARD — REQUIRED BEFORE ALL SUPABASE OPS

Post IDs start as temporary timestamp strings (e.g., `"1713600000000"`) until
the Supabase INSERT resolves. Calling `.eq("id", tempId)` on a UUID column
returns a PostgREST 400 error that triggers the rollback, snapping the card back.

ALWAYS guard Supabase operations that use a card ID:
```js
if (useSupabase && isValidUuid(cardId)) {
  // safe to call supabase here
}
```

This guard is in place for: moveCard, updateCard, deleteCard, submitReapproval, submitKickback.
Do NOT remove it. Do NOT add new Supabase calls that bypass it.

---

## 6. BRANDING — "CONTENT ENGINE", NOT "PIPELINE"

The product is called **Ten80Ten Content Engine** in all user-facing text,
email templates, and notifications. The word "Pipeline" is an internal
technical term only. Check all email HTML templates when editing.

Logo URL: `https://smm.ten80ten.com/ten80ten-logo.png`

---

## 7. PENDING PRODUCTION MIGRATIONS

These migration files are ready but NOT yet applied to production Supabase:
- `0010_publish_ledger.sql`
- `0011_claim_publish_job.sql`
- `0012_scheduled_at_tstz.sql`
- `0013_column_drift.sql`
- `0014_create_publish_job_for_post.sql`
- `0015_post_safety.sql` ← NEW

Until 0010-0014 are applied, POSTS_SELECT_FULL (which joins publish_jobs) will
fail. The code falls back to POSTS_SELECT_BASIC ("*") automatically. Do not
remove this fallback.

---

## 8. BEFORE TOUCHING pipeline-context.tsx OR ANY PIPELINE CODE

Run this mental checklist:
1. Does my change preserve posts across a browser refresh?
2. Does every insert include workspace_id?
3. Does every Supabase call on a card ID check isValidUuid() first?
4. Does load() still NOT fall back to localStorage on an empty DB result?
5. Does the provision endpoint still get called before the posts SELECT?

If any answer is "no" or "I'm not sure" — stop and re-read this file.
