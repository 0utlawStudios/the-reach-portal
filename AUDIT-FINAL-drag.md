# Drag Final Audit - Reach Portal

updated-at: 2026-06-04T20:05:26Z
repo: `/Users/ace/Documents/CURSOR MAIN/THE REACH SMM PORTAL`
production target: `https://thereach.ten80ten.com`
status: GREEN

## Result

The Reach Portal drag audit is GREEN. The prior BLOCKED items are closed with a live authenticated Chromium Playwright run, real DOM drag events, Supabase network capture, service-role DB re-query, UI stage readback, hostile server checks, screenshots, and a trace zip.

- Playwright run id: `drag-4748171-r4`
- Matrix evidence: `perf/drag-evidence/drag-4748171-r4/matrix.json`
- Seed/auth evidence: `perf/drag-evidence/drag-4748171-r4/seed.json`
- Trace: `perf/drag-evidence/playwright-results/drag-production-drag-matri-ce3d1-network-DB-and-UI-agreement-chromium/trace.zip`
- Screenshots: `perf/drag-evidence/drag-4748171-r4/*.png`
- Command: `PLAYWRIGHT_RUN_ID=drag-4748171-r4 npm run e2e:prod`
- Result: 1 Chromium test passed.

## Scope Guard

- Correct repo only: `/Users/ace/Documents/CURSOR MAIN/THE REACH SMM PORTAL`.
- Untouched repo: `/Users/ace/Documents/CURSOR MAIN/ten80ten-smm-portal`.
- Muaaz and Carlo are not mapped here because the user clarified they are Ten80Ten SMM Portal users, not Reach Portal users.
- Actual active Reach users are mapped from `auth.users.id = workspace_members.user_id` in `NAMED-USERS.md:43-56`.
- No design, brand, copy, migrations, RLS, or DB guard changes were made in this closeout slice.

## Harness

- Playwright is pinned as `@playwright/test@1.60.0` in `package.json:42-44`.
- Scripts are present in `package.json:15-16`: `e2e` and `e2e:prod`.
- Chromium headless, prod baseURL, traces, failure screenshots, and failure video are configured in `playwright.config.ts:17-29`.
- Playwright output is written under `perf/drag-evidence/playwright-results` in `playwright.config.ts:5` so the final trace is commit-visible while root `test-results/` remains ignored.
- Ignore rules for transient auth and default reports are in `.gitignore:13-17`.

## Browser Instrumentation

- Board telemetry emits `reach:drag-start` and `reach:drag-end` from `src/components/kanban-board.tsx:62-74`.
- Drag start emits active card/source stage evidence at `src/components/kanban-board.tsx:175-183`.
- Drag end emits gate outcomes for posted lock, approver lock, missing fields, kickback, and allowed moves at `src/components/kanban-board.tsx:241-333`.
- The board root exposes `data-testid="kanban-board"` at `src/components/kanban-board.tsx:339-340`.
- Columns and drop zones expose stable test ids and stage attributes at `src/components/pipeline-column.tsx:24-35`.
- Cards and drag handles expose stable test ids and stage attributes at `src/components/content-card.tsx:162-179`.
- The E2E uses real mouse pointer events from handle to drop zone at `e2e/drag.spec.ts:470-487`.
- The E2E records DOM drag events at `e2e/drag.spec.ts:496-519` and Supabase PATCH responses at `e2e/drag.spec.ts:521-535`.
- The E2E asserts DB stage and UI stage agreement at `e2e/drag.spec.ts:489-552`.

## Named Users

The active Reach production users are:

| Persona | Name | Email | auth.users id | Role | Evidence |
| --- | --- | --- | --- | --- | --- |
| Superadmin fallback | Aldridge Dagos | `aldridge@ten80ten.com` | `f4d6c15a-7b94-4e58-ac8b-4de98aa0d644` | `superadmin` | `NAMED-USERS.md:47` |
| Approver persona | Hanes Lawrence Abasola | `hanes@ten80ten.com` | `952b51be-9037-4da3-8364-5b52bf894347` | `admin` | `NAMED-USERS.md:48` |
| Author-capable persona | Shahannie Manuel | `shang.ten80ten@gmail.com` | `a7f2165d-d667-4bf8-ab37-383ffc485323` | `creative_director` | `NAMED-USERS.md:49` |

Reach currently has active role counts `admin=1`, `creative_director=1`, and `superadmin=1`; no active lower-role author-only Reach user exists (`NAMED-USERS.md:51-56`). To verify lower-role behavior without mutating named production users, the Playwright run seeded temporary auth-backed personas:

- Editor: `qa-drag-4748171-r4-editor@example.com`, auth user `3a91e34d-1e4c-4f5a-8f30-3bd2bacc6295`, role `editor`.
- Approver-class: `qa-drag-4748171-r4-creative_director@example.com`, auth user `a796c7a5-f1f1-49e0-b2b3-d36caf5edb53`, role `creative_director`.
- Auth method: Supabase password sign-in, then JWT/session injection into Playwright storageState via `sb-<project-ref>-auth-token` localStorage, implemented at `e2e/drag.spec.ts:596-617` and recorded in `perf/drag-evidence/drag-4748171-r4/seed.json`.

## E2E Drag Matrix

All rows share trace `perf/drag-evidence/playwright-results/drag-production-drag-matri-ce3d1-network-DB-and-UI-agreement-chromium/trace.zip`.

| Case | Role | DB row id | Transition | DOM start/end | Outcome | Network | DB stage | UI stage | Screenshot |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `editor-ideas-awaiting` | `editor` | `2e358ad3-4d3a-47f5-9a5e-6c2bec14d327` | `ideas->awaiting_approval` | true/true | `move_requested` | PATCH 200 body `stage=awaiting_approval` | `awaiting_approval` | `awaiting_approval` | `perf/drag-evidence/drag-4748171-r4/editor-ideas-awaiting.png` |
| `editor-awaiting-approved-blocked` | `editor` | `2e358ad3-4d3a-47f5-9a5e-6c2bec14d327` | `awaiting_approval->approved_scheduled` | true/true | `blocked_approver_required` | none | `awaiting_approval` | `awaiting_approval` | `perf/drag-evidence/drag-4748171-r4/editor-awaiting-approved-blocked.png` |
| `editor-posted-ideas-blocked` | `editor` | `330a22f1-434d-47b4-8cd8-782cbcb617ab` | `posted->ideas` | true/true | `blocked_posted_source` | none | `posted` | `posted` | `perf/drag-evidence/drag-4748171-r4/editor-posted-ideas-blocked.png` |
| `approver-awaiting-approved` | `creative_director` | `1d050466-f828-4949-ad44-759c4ca0f1f2` | `awaiting_approval->approved_scheduled` | true/true | `move_requested` | PATCH 200 body `stage=approved_scheduled` | `approved_scheduled` | `approved_scheduled` | `perf/drag-evidence/drag-4748171-r4/approver-awaiting-approved.png` |
| `approver-revision-awaiting` | `creative_director` | `08e23d07-fe1d-475b-8746-511cfebfc5a6` | `revision_needed->awaiting_approval` | true/true | `move_requested` | PATCH 204 | `awaiting_approval` | `awaiting_approval` | `perf/drag-evidence/drag-4748171-r4/approver-revision-awaiting.png` |
| `approver-approved-ideas` | `creative_director` | `b71f5f26-bb6a-4093-8ed4-b2718dd20580` | `approved_scheduled->ideas` | true/true | `move_requested` | PATCH 200 body `stage=ideas` | `ideas` | `ideas` | `perf/drag-evidence/drag-4748171-r4/approver-approved-ideas.png` |

## Hostile Server Matrix

The hostile checks are implemented at `e2e/drag.spec.ts:407-468`.

| Case | DB row id | Expected | Observed | DB stage after |
| --- | --- | --- | --- | --- |
| `server-editor-approval-bypass` | `2e358ad3-4d3a-47f5-9a5e-6c2bec14d327` | editor cannot force `approved_scheduled` | `APPROVAL_LOCKDOWN` / `P0001` | `awaiting_approval` |
| `server-cross-workspace-update` | `fbba5349-3067-4155-9804-b1a36bacd28e` | cross-workspace update fails closed | HTTP 200 with `data=null` due RLS zero-row denial | `ideas` |
| `server-service-role-posted-recovery` | `330a22f1-434d-47b4-8cd8-782cbcb617ab` | service role can recover a posted row | HTTP 200 body `stage=ideas` | `ideas` |

## Cleanup

The fixture seeds temporary workspaces, auth users, workspace members, team members, and posts at `e2e/drag.spec.ts:152-234`. Cleanup deletes and asserts zero remainders at `e2e/drag.spec.ts:236-286`, including auth-user enumeration at `e2e/drag.spec.ts:632-645`.

Final cleanup evidence from `perf/drag-evidence/drag-4748171-r4/matrix.json`:

- `postsRemaining=0`
- `auditRowsRemaining=0`
- `workspaceMembersRemaining=0`
- `teamMembersRemaining=0`
- `workspacesRemaining=0`
- `authUsersRemaining=0`
- `cleanupErrors=[]`

## Verification

- `PLAYWRIGHT_RUN_ID=drag-4748171-r4 npm run e2e:prod`: passed, 1 Chromium test.
- `npx playwright test --list`: detects the production drag matrix spec.
- `npm run typecheck`: passed.
- `npm run lint`: passed with the existing `src/lib/ai/worker.ts` warning.
- `git diff --check`: passed.
- `npm test`: passed, 30 files / 270 tests.
- `npm run build`: passed.

## Changes

EDITED:

- `playwright.config.ts`
- `package.json`
- `package-lock.json`
- `.gitignore`
- `e2e/drag.spec.ts`
- `src/components/kanban-board.tsx`
- `src/components/pipeline-column.tsx`
- `src/components/content-card.tsx`
- `NAMED-USERS.md`
- `AUDIT-FINAL-drag.md`
- `PROGRESS.md`

ADDED:

- `e2e/.gitkeep`
- `perf/drag-evidence/drag-4748171-r4/seed.json`
- `perf/drag-evidence/drag-4748171-r4/matrix.json`
- `perf/drag-evidence/drag-4748171-r4/*.png`
- `perf/drag-evidence/playwright-results/.last-run.json`
- `perf/drag-evidence/playwright-results/drag-production-drag-matri-ce3d1-network-DB-and-UI-agreement-chromium/trace.zip`

LEFT UNTOUCHED:

- `/Users/ace/Documents/CURSOR MAIN/ten80ten-smm-portal`
- DB migrations, RLS policies, production schema, design, brand, and copy
