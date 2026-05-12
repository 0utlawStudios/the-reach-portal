# Adversarial QA + Fix Plan — Ten80Ten Content Engine

**Date:** 2026-05-13
**Author:** Head Developer / Principal QA Architect pass
**Scope:** Full app audit. App is LIVE at smm.ten80ten.com. All fixes must be additive and non-breaking.
**Reviewer mandate:** Iron laws in `AGENTS.md` are non-negotiable.

---

## Executive Summary

20 fixes across 3 priority tiers. The system is well-structured around its iron laws (workspace_id, RLS, audit triggers), but the perimeter has six P0 holes that allow privilege escalation, cross-workspace presence leakage, and an unauthenticated admin endpoint that can run service-role queries from the public internet.

| Tier | Count | Theme |
|------|------:|-------|
| P0 — Data-loss / auth-bypass | 7 | Unauthed admin endpoint, permissive team_members RLS, spoofable team RBAC, client-side self-promotion, open drive stream, deleteCard ghost, realtime echo bug |
| P1 — Broken flow / RLS gap | 12 | Logout scope, enumeration, mention regex, presence channel, rollback resilience, email validation, security headers, rate limits, a11y |
| P2 — Polish | 1 bundle | Timezone label, calendar bounds, scroll memory, pulse cap, alt fallbacks |

---

## P0 Findings (fix immediately)

### P0-1 — `/api/admin/backfill-media` is publicly callable as service role
`src/app/api/admin/backfill-media/route.ts:10`. `export async function POST()` has no auth handler. A `curl -X POST https://smm.ten80ten.com/api/admin/backfill-media` from any IP runs the full scan and writes against `media_assets` using the service role. **Severity: P0.**
**Fix:** Wrap with `requireRole(req, ["superadmin","admin"])` from `src/lib/auth/require.ts`.

### P0-2 — `team_members` RLS still permissive
`supabase/migrations/0000_baseline.sql:153-154` creates `CREATE POLICY "Allow all for anon" ON team_members FOR ALL USING (true) WITH CHECK (true)`. `0007_rls_v2.sql` only touches `posts`, `media_assets`, `post_comments`, `post_audit_logs`, `brand_playbook` — `team_members` is left wide open. Any authenticated anon JWT can read every team member row (emails, roles, names) and INSERT/UPDATE/DELETE them at will.
**Fix:** Migration `0018_team_members_rls.sql` drops the permissive policy, replaces with workspace-scoped SELECT for active members and admin-only mutate.

### P0-3 — Team APIs trust the body, not the session
`src/app/api/team/invite/route.ts:63`, `team/remove-member/route.ts:33`, `team/resend-invite/route.ts:43`, `team/approve-request/route.ts:31` all run their RBAC check by querying `team_members` with `.eq("email", body.requestedBy)`. The `requestedBy` value comes straight from the request body. Anyone who knows a superadmin's email can invoke these as that admin.

`src/lib/auth/require.ts` already implements `requireRole()` with full server-side verification — but **`grep -r requireRole src/`** shows it is referenced only inside its own file. It was scaffolded but never wired in.
**Fix:** Replace each `requestedBy`-based RBAC block with `requireRole(req, [...])` and use `ctx.user.email` (and the role from the verified session) for the audit log.

### P0-4 — Client-side auto-activation defeats admin approval
`src/lib/auth-context.tsx:70-73` runs `supabase.from("team_members").update({ status: "active" }).eq("email", email)` whenever an authenticated user has a `pending` team_members row. Anyone who acquires a valid Supabase session for a pending email auto-promotes themselves to `active`, sidestepping the whole approval workflow.
**Fix:** Remove the client-side update. Activation belongs in `team/approve-request` or in the magic-link confirm flow (which already calls `update({status:"active"})` at `auth/setup/page.tsx:128`).

### P0-5 — `/api/drive/stream` is open CORS + no auth
`src/app/api/drive/stream/route.ts:7` sets `Access-Control-Allow-Origin: *`, no `Authorization` check, and proxies any Google Drive `fileId` it receives. Any external site can embed media. fileIds are not strictly secret but the streaming endpoint hands them out anyway.
**Fix:** Require a valid Supabase session, narrow CORS to `https://smm.ten80ten.com` + local dev origin, optionally also assert the fileId appears in `media_assets` for an active workspace the caller belongs to.

### P0-6 — `deleteCard` produces a ghost when the safety trigger fires
`src/lib/pipeline-context.tsx:631-644` removes the card from `cards` state, then issues `supabase.from("posts").delete()`. For `approved_scheduled` and `posted` rows the migration 0015 trigger raises an exception, the client logs `console.error`, but the local state already dropped the card. Next refresh restores it — a confusing "did I delete it?" UX and a soft violation of iron law #1's spirit.
**Fix:** On error, restore the card and surface a toast: *"This post is locked because it has been approved/posted. Move it back to Revision Needed first."*

### P0-7 — Realtime dedup key collision
`src/lib/pipeline-context.tsx:616` marks every create with the literal string `"create"`, and `:334` skips any INSERT echo whose dedup key is `"create"`. If user A creates a post at the same moment user B is creating one, B's insert sets `"create"` locally, and the broadcast of A's insert is dropped (because `recentMutations.has("create")` is true). The new card never appears in B's UI until refresh.
**Fix:** Mark the actual tempId on insert, and on the realtime side compare by the row's real id (we won't know the tempId server-side, so simplest fix: just remove the dedup for inserts and rely on the `prev.some(c => c.id === newCard.id)` guard already at line 336).

---

## P1 Findings

### P1-1 — `logout()` only clears the local session
`auth-context.tsx:165` calls `supabase.auth.signOut()` with no scope argument. Supabase default is `local`, leaving the refresh token valid server-side.
**Fix:** `supabase.auth.signOut({ scope: "global" })`.

### P1-2 — Email enumeration in `/api/team/request-access`
Returns HTTP 409 with a distinguishable body if the email already exists. Combined with the IP-based rate limit, an attacker can enumerate registered emails by varying source IP.
**Fix:** Always respond 200 with the same shape; only send the admin notification if the row is new.

### P1-3 — `@mention` detection is `note.includes("@")`
`pipeline-context.tsx:573` triggers a mention email any time the note contains `@`. Any pasted email or URL with `@` fires the notification path. Use a proper token: `/@[a-zA-Z][\w.-]*/`.

### P1-4 — Presence channel is global
`src/lib/use-presence.ts:35` joins `supabase.channel("presence-room")` shared across every authenticated user, regardless of workspace. Cross-workspace identity leak.
**Fix:** `supabase.channel(\`presence-${workspaceId}\`)`. Pass workspaceId from `usePipeline()`.

### P1-5 — `moveCard` rollback can fail silently
`pipeline-context.tsx:461-463` rolls back the stage in DB if the post-update step (publish job or notification) fails, but does not handle the case where the rollback itself fails. State diverges and the user is none the wiser.
**Fix:** Wrap rollback in try/catch, surface a toast and log a critical-divergence event so we can audit in `audit_log_v2`.

### P1-6 — No recipient email validation in notification routes
`notifications/*.ts` accept whatever email shape Supabase returned (or whatever body field was passed). Headers like `attacker@a.com\r\nBcc: leak@x.com` would be passed straight to nodemailer.
**Fix:** Reuse the `EMAIL_RE = /^[^\s@\r\n]+@[^\s@\r\n]+\.[^\s@\r\n]+$/` pattern already used in `team/invite/route.ts` before each `transporter.sendMail`.

### P1-7 — `createCard` insert error is invisible
`pipeline-context.tsx:621-627` only console.errors on insert failure. Local card sticks around with its tempId until refresh, at which point it vanishes.
**Fix:** On error, remove the local tempId entry and toast the user.

### P1-8 — `ensureMediaAsset` SELECT not explicitly workspace-scoped
RLS protects this at the DB layer, but the `.eq("url", url).maybeSingle()` query could in principle return a different workspace's row to a future code path that bypasses RLS (e.g., a future admin client refactor). Belt-and-suspenders.
**Fix:** Add `.eq("workspace_id", wsId)` to both the SELECT and the UPDATE.

### P1-9 — No security headers
`next.config.ts` only sets headers for `/sw.js`. No `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`.
**Fix:** Add a `headers()` block with the standard four. CSP deferred — too brittle in a Drive-streaming app.

### P1-10 — Rate limits missing on hot endpoints
`api/publish-jobs`, `api/drive/upload`, `api/drive/proxy-upload`, `api/drive/finalize`. `src/lib/rate-limit.ts` already exposes `checkRateLimit()`.
**Fix:** 30 req/min/user for publish-jobs, 60 req/min/user for drive endpoints.

### P1-11 — `ValidationErrorModal` has no `role`/focus trap
Screen reader users get nothing. Tab key can escape the modal behind the backdrop.
**Fix:** `role="alertdialog"`, `aria-modal`, focus the dismiss button on mount, focus-trap with `useEffect` ref listener.

### P1-12 — Icon-only buttons missing `aria-label`
Password visibility toggle in `login-screen.tsx`, hamburger in `top-bar.tsx`, copy buttons in `copy-block.tsx`.
**Fix:** Add labels.

---

## P2 Polish Bundle

1. Add a small "Times shown in Central Time" subtitle below every schedule input pair.
2. Calendar nav: disable back/forward at the year-window boundary; show year next to month.
3. CreatePostModal tab scroll position: cache per tab via `useRef<Record<TabId, number>>`.
4. Overdue badge: cap animation iterations.
5. `RawImage`: fall back `alt` to component prop, then to `card.title`.
6. MentionTextarea dropdown: clamp to viewport using `getBoundingClientRect` + measured space.
7. Update Supabase (2.99.3 → 2.105.x) and Next (16.2.0 → 16.2.6) — patch-only.

---

## Order of Operations

Group A (server-side / auth — must ship first):
- P0-1, P0-3, P0-4, P0-5, P1-1, P1-2, P1-6, P1-10

Group B (DB):
- P0-2 (write migration; only **apply** after verification with the user — migration application is a separate authorization step per `feedback_keep_executing` and worktree_paths)

Group C (client / pipeline):
- P0-6, P0-7, P1-3, P1-4, P1-5, P1-7, P1-8

Group D (UI / a11y / config):
- P1-9, P1-11, P1-12, P2 bundle

---

## Verification Strategy

After each group:
1. `npm run lint`
2. `npm run typecheck`
3. Smoke the affected flow locally if possible.

Final verification:
- `npm run build` (full preflight ends with build).
- Spot-check the changed APIs with `curl` for 401/403 paths.
- Confirm no behavior change for authorized users.

---

## Non-Goals (this pass)

- Applying migrations to production Supabase — that requires a separate authorization handshake and a backup snapshot. The plan adds 0018; running it stays a user decision.
- Pre-existing pending migrations 0010-0017 — out of scope here. They were already documented as pending in `AGENTS.md §7`.
- Refactoring the realtime subscription beyond the dedup fix.
- Bulk dependency upgrades (separate bundle if requested).
