# Drag Final Audit - Reach Portal

updated-at: 2026-06-04T19:24:04Z
repo: `/Users/ace/Documents/CURSOR MAIN/THE REACH SMM PORTAL`
scope: drag/stage persistence, role enforcement, production DB proof

## Status

The source and production database enforcement defects found after Phase 1 are fixed and verified.

Live authenticated browser DOM/event evidence is still missing. No screenshot, console trace, network trace, or pointer-event trace was captured, so this audit does not claim visual/browser proof.

## Fixed Findings

### P0 - Posted posts could move out of Posted

Fixed at the database and UI/provider layers.

- DB: `supabase/migrations/0046_post_stage_transition_guard.sql:21` rejects browser-authenticated stage changes where `OLD.stage = 'posted'`.
- DB: service-role recovery remains allowed by the same guard in `supabase/migrations/0046_post_stage_transition_guard.sql:22`.
- Board: `src/components/kanban-board.tsx:184` blocks dragging a `posted` source card.
- Provider: `src/lib/pipeline-context.tsx:567` blocks direct `moveCard()` attempts from a `posted` source card.

Production proof with temporary rows only:

- Stamp `qa-0046-1780601151490-2d4054`.
- Editor `posted -> ideas` rejected with `POSTED_LOCKDOWN` on post `ec1a772e-f3a2-448e-8f47-0d6a1985f5c0`.
- Service-role `posted -> ideas` recovery succeeded on post `a2ddbf99-7daa-4a81-8127-10878002a5e1`.

### P1 - DB did not enforce approver-only approval

Fixed at the database layer and aligned with the client role helper.

- DB: `supabase/migrations/0046_post_stage_transition_guard.sql:48` checks every transition into `approved_scheduled`.
- DB: `supabase/migrations/0046_post_stage_transition_guard.sql:52` reads `public.workspace_members` for the active user/workspace.
- DB: `supabase/migrations/0046_post_stage_transition_guard.sql:56` limits approval to `superadmin`, `admin`, `owner`, `approver`, and `creative_director`.
- Helper: `src/lib/roles.ts:1` centralizes the approver role set.
- Board: `src/components/kanban-board.tsx:117` uses the shared helper with `team_members` role and auth-role fallback.
- Drawer: `src/components/asset-review-drawer.tsx:48` uses the same helper and fallback.

Production proof with temporary rows only:

- Editor `awaiting_approval -> approved_scheduled` rejected with `APPROVAL_LOCKDOWN` on post `e3e339fc-990a-40cf-a4f4-bb0444d761e3`.
- Creative director `awaiting_approval -> approved_scheduled` succeeded on post `70269cb3-d802-4820-8f19-831af9c5f6bc`.

### P1 - Board and drawer role logic disagreed

Fixed by replacing component-local role checks with `isPipelineApproverRole()`.

- Shared helper: `src/lib/roles.ts:9`.
- Board lookup/fallback: `src/components/kanban-board.tsx:112`.
- Drawer lookup/fallback: `src/components/asset-review-drawer.tsx:44`.

### P2 - Drawer/modal success before persistence proof

Fixed by moving success toasts into confirmed provider commit paths and using neutral "saving" copy from callers.

- Stage moves request the updated row via `.select("id, stage").maybeSingle()` in `src/lib/pipeline-context.tsx:605`.
- `assertStageMoveCommitted()` rejects missing/wrong returned rows in `src/lib/pipeline-context.tsx:251`.
- Supabase/PostgREST plain-object errors are formatted by `formatPipelineError()` in `src/lib/pipeline-context.tsx:267`.
- Reapproval success toast fires after the Supabase write succeeds in `src/lib/pipeline-context.tsx:717`.
- Kickback success toast fires after the Supabase write succeeds in `src/lib/pipeline-context.tsx:821`.
- Drawer revision request now shows neutral saving copy at `src/components/asset-review-drawer.tsx:1030`.
- Drawer next-stage move now shows neutral saving copy at `src/components/asset-review-drawer.tsx:1122`.
- Modal caller success toasts were removed from `src/components/revision-modal.tsx` and `src/components/kickback-modal.tsx`.

## Production DB Verification

Remote migration state:

- `supabase migration list` shows local `0046` and remote `0046`.

Temporary QA data cleanup:

- `postsRemaining=0`
- `auditRowsRemaining=0`
- `workspaceMembersRemaining=0`
- `teamMembersRemaining=0`
- Auth admin delete calls completed for temporary users.

Post-cleanup live board counts:

- Total posts: `24`
- `ideas=1`
- `awaiting_approval=7`
- `revision_needed=2`
- `approved_scheduled=6`
- `posted=8`

## Local Verification

- `npm test -- src/lib/__tests__/iron-law-static.test.ts`: 25/25 passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed with existing warning in `src/lib/ai/worker.ts`.
- `git diff --check`: passed.
- `npm test`: 30 files / 270 tests passed.
- `npm run build`: passed.

## Missing Evidence

- No live authenticated browser DOM drag trace.
- No browser screenshot or visual alignment proof.
- No browser console/network capture for a real drag/drop.
- Current Reach production data still does not contain Muaaz or Carlo team rows, so a named-user matrix for those users cannot be truthfully completed from current DB state.
