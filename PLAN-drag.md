# Drag Phase 1 Plan - Reach Portal

updated-at: 2026-06-04T18:59:45Z
repo: `/Users/ace/Documents/CURSOR MAIN/THE REACH SMM PORTAL`
scope: read-only Phase 1 drag QA
base SHA: `760e6fd`

## Guardrails

- No Ten80Ten SMM Portal repo evidence is used here.
- No code edits in Phase 1.
- Production Supabase access is read-only in Phase 1.
- Missing runtime evidence is marked missing; it is not inferred.
- Product stages are `ideas`, `awaiting_approval`, `revision_needed`, `approved_scheduled`, and `posted`; there is no DB stage named `published`.

## Current Evidence

- DnD packages are installed: `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` in `package.json:22`.
- `KanbanBoard` registers `PointerSensor`, `TouchSensor`, and `KeyboardSensor` in `src/components/kanban-board.tsx:91`.
- `DndContext` wraps the board columns and overlay in `src/components/kanban-board.tsx:253`.
- `handleDragStart` sets the active card from `event.active.id` in `src/components/kanban-board.tsx:164`.
- `handleDragEnd` resolves `over.id` to a column stage or card stage and calls `moveCard(cardId, targetStage)` in `src/components/kanban-board.tsx:169` and `src/components/kanban-board.tsx:229`.
- Columns are droppable by stage id in `src/components/pipeline-column.tsx:21`.
- Cards are sortable by card id in `src/components/content-card.tsx:21`.
- The drag listeners are attached to the real `aria-label="Drag card"` button in `src/components/content-card.tsx:170`.
- Card body clicks select cards; the card body does not own DnD listeners in `src/components/content-card.tsx:163`.
- Native image drag is disabled in `src/components/content-card.tsx:61`.
- The stage type and column ids match the DB enum in `src/lib/types.ts:1`, `src/lib/types.ts:115`, and `supabase/migrations/0000_baseline.sql:12`.
- Stage mutation is direct Supabase from the browser: `supabase.from("posts").update({ stage: newStage }).eq("id", cardId)` in `src/lib/pipeline-context.tsx:563`.
- The `/api/publish-jobs` route is a post-approval side effect, not the drag stage endpoint, in `src/lib/pipeline-context.tsx:253` and `src/app/api/publish-jobs/route.ts:134`.
- Client and DB both intentionally block human moves into `posted`: `src/components/kanban-board.tsx:187`, `src/lib/pipeline-context.tsx:522`, and `supabase/migrations/0026_publisher_lockdown.sql:99`.
- RLS allows active workspace members with write roles to update posts in `supabase/migrations/0007_rls_v2.sql:79`.
- `load()` provisions workspace membership before selecting posts in `src/lib/pipeline-context.tsx:370` and `src/lib/pipeline-context.tsx:400`.
- `resolveLoadedCards()` treats an empty DB array as truth, not fallback, in `src/lib/pipeline-context.tsx:241`.

## Production Read-Only DB Evidence

Project host observed from Reach `.env.local`: `gxmpmdhmxyfqusdzcemt.supabase.co`.

Current read-only `posts` count: `24`.

Stage counts:

- `ideas`: 1
- `awaiting_approval`: 7
- `revision_needed`: 2
- `approved_scheduled`: 6
- `posted`: 8

Sample row ids by stage:

- `ideas`: `ab3fbde3-d358-4013-8272-9abda6f21db9`
- `awaiting_approval`: `1a40fd5b-0e11-4f77-a06d-890f4f487460`
- `revision_needed`: `9221b39f-13bf-4b5d-b2a9-da54a375c72d`
- `approved_scheduled`: `f0f6cd20-1fff-4945-8115-624a596a0905`
- `posted`: `72c4343f-83a9-41ba-950e-d9dd5106a530`

Recent stage-change audit rows:

- `8ad94c04-f41b-4bee-89a2-13a2ce24ff38`, post `f0f6cd20-1fff-4945-8115-624a596a0905`, `Moved from Awaiting Approval to Approved / Scheduled`, user `Hanes Lawrence Abasola`.
- `9f897b02-b333-4dbf-b94f-54570d7148c5`, post `1a40fd5b-0e11-4f77-a06d-890f4f487460`, `Moved from Ideas to Awaiting Approval`, user `Aldridge Dagos`.
- `ff5018df-e187-4f4b-bfc2-16e3185aef11`, post `b2246691-4bcb-4859-980d-6617a2eedea9`, `Moved from Awaiting Approval to Ideas`, user `Aldridge Dagos`.
- `1f24f2ee-1253-4497-89ef-447299a45993`, post `ba93db39-aeaa-49f3-b2f0-309e8f3cd526`, `Moved from Revision Needed to Approved / Scheduled`, user `Aldridge Dagos`.

Current Reach team/member read-only evidence:

- `team_members`: 5 rows total.
- Active team rows: Aldridge Dagos `superadmin`, Hanes Lawrence Abasola `admin`, Shahannie Manuel `creative_director`.
- Active `workspace_members`: 3 rows, all in workspace `00000000-0000-0000-0000-000000000001`, roles `superadmin`, `admin`, `creative_director`.
- Pending team rows without active workspace rows: Christer Umali `admin`, Stefani Sorenson `admin`.
- Muaaz and Carlo were not present in the current Reach team data returned by the read-only query.

## Missing Evidence

- No live authenticated browser drag DOM event trace was captured in Phase 1.
- No live browser console trace for a completed drag was captured.
- No live browser network trace for a completed drag was captured.
- Browser skill was present, but its required Node execution surface was not exposed after tool discovery.
- A completed live drop would write `posts.stage`, which Phase 1 forbids.

## Lane Plan

Lane A - DnD wiring:

- Confirm provider, sensors, draggable ids, droppable ids, and stage id parity.
- Result: source and DB evidence support coherent wiring; main risk is handle-only interaction, not provider/id mismatch.

Lane B - Handler/event:

- Confirm whether `onDragStart` and `onDragEnd` fire, whether `active.id` and `over.id` resolve, and whether CSS/overlays block pointer/touch.
- Result: source evidence shows handler path and silent no-op conditions; live DOM event evidence is missing.

Lane C - Mutation:

- Trace drop to direct Supabase update, verify payload enum and RLS policy direction.
- Result: mutation path is direct browser Supabase, enum matches, RLS is active-workspace-member gated, `posted` is intentionally blocked.

Lane D - Optimistic vs truth:

- Verify whether UI can accept optimistic state without proving DB row mutation.
- Result: `moveCard` checks only `error`, not returned row/count; this is the highest-confidence implementation gap for false-success persistence.

Lane E - Auth/role gate:

- Verify role resolution and app gating.
- Result: board role gate falls back to `currentUser.role`; drawer role gate does not. Current Reach DB active workspace roles match active team roles.

## Phase 2 Plan

1. Fix persistence honesty first: make `moveCard` prove exactly one row changed before treating the stage move as committed.
2. Keep Iron Law invariants intact: no localStorage fallback on empty DB arrays, preserve provision-before-posts-select, preserve UUID guards.
3. Add focused regression coverage for stage update truth: success returns one row; zero-row/no-row result rolls back and surfaces an honest error.
4. Review drawer role fallback separately if approval buttons are in scope; do not mix this with board drag if only DnD is failing.
5. Only after code changes, run live write verification with temporary QA rows and cleanup, because Phase 1 intentionally did not mutate production rows.
