# Drag Phase 1 Audit - Reach Portal

updated-at: 2026-06-04T18:59:45Z
repo: `/Users/ace/Documents/CURSOR MAIN/THE REACH SMM PORTAL`
base SHA: `760e6fd`
phase: Phase 1 QA Swarm 1, read-only, no code

## Executive Ranking

P0 candidate: stage persistence does not prove row mutation.

- Evidence: `moveCard` optimistically changes local state in `src/lib/pipeline-context.tsx:550`, then calls `supabase.from("posts").update({ stage: newStage }).eq("id", cardId)` and checks only `{ error }` in `src/lib/pipeline-context.tsx:563`.
- Evidence: installed Supabase/PostgREST source says updated rows are not returned by default unless `.select()` is chained in `node_modules/@supabase/postgrest-js/src/PostgrestQueryBuilder.ts:1408`; the drag stage update does not request `.select()` or count.
- Impact: all board stage moves that reach `moveCard`; false success can survive locally until refresh or another canonical read.
- Current DB evidence: sampled production audit rows show successful stage changes, including audit row `8ad94c04-f41b-4bee-89a2-13a2ce24ff38` for post `f0f6cd20-1fff-4945-8115-624a596a0905`. This does not prove the gap is currently occurring; it proves the code lacks a truth check.
- Root-cause direction: require a returned row or exact affected count and rollback if the row is missing.

P1 candidate: handle-only drag contract can be perceived as broken whole-card drag.

- Evidence: `useSortable` is on the card component in `src/components/content-card.tsx:21`, but `attributes` and `listeners` are spread only onto the handle button in `src/components/content-card.tsx:170`.
- Evidence: card body click selects the card in `src/components/content-card.tsx:163`; the body does not own DnD listeners.
- Evidence: static regression enforces a real listener button and no `pointer-events-none` in `src/lib/__tests__/iron-law-static.test.ts:266`.
- Verification: `npm test -- src/lib/__tests__/iron-law-static.test.ts -t "pipeline drag handle contract"` passed, 1 focused test passed and 18 skipped.
- Impact: every card, if users drag from the body instead of the handle.
- Root-cause direction: if live complaint is "card body will not drag," decide whether to make the whole card draggable or improve the handle affordance. If live complaint is "handle will not drag," this is not sufficient.

P1 candidate: `handleDragEnd` has silent no-op exits for missing target or same-stage target.

- Evidence: `handleDragEnd` returns when `over` is missing in `src/components/kanban-board.tsx:172`.
- Evidence: target stage resolution returns if no target or same stage in `src/components/kanban-board.tsx:185`.
- Evidence: the board scroller uses `overflow-x-auto` and `touch-pan-x` in `src/components/kanban-board.tsx:276`; column lanes use `overflow-y-auto` in `src/components/pipeline-column.tsx:35`.
- Missing evidence: no live pointer trace, `elementFromPoint`, computed CSS, or `DragEndEvent` payload was captured in Phase 1.
- Impact: drag starts but snaps back without an honest error if the drop target resolves to null or same-stage.
- Root-cause direction: instrument or test `active.id`, `over.id`, target stage, and gate reason in Phase 2/QA.

P1 candidate: drawer approval role resolution can deny valid approvers.

- Evidence: board approver gate falls back to `currentUser.role` in `src/components/kanban-board.tsx:120`.
- Evidence: drawer approver gate reads only `members.find((m) => m.email === currentUser.email)` and returns false if missing in `src/components/asset-review-drawer.tsx:43`.
- Evidence: drawer approval calls `moveCard(selectedCard.id, "approved_scheduled")` in `src/components/asset-review-drawer.tsx:1054`.
- Impact: drawer buttons, not DnD start/drop. This can look like approval movement is blocked even when board drag role state is okay.
- Root-cause direction: align drawer role fallback with board role resolution if approval buttons are included in Phase 2.

Intentional behavior, not a bug: human drag to `posted`.

- Evidence: `posted` is part of the frontend and DB stage set, not `published`, in `src/lib/types.ts:1` and `supabase/migrations/0000_baseline.sql:12`.
- Evidence: `KanbanBoard` blocks `targetStage === "posted"` in `src/components/kanban-board.tsx:187`.
- Evidence: `moveCard` blocks `newStage === "posted"` in `src/lib/pipeline-context.tsx:522`.
- Evidence: DB trigger `block_manual_posted_transition()` rejects non-service-role transitions into `posted` in `supabase/migrations/0026_publisher_lockdown.sql:99`.
- Impact: all human users. Cards move to Posted only through the auto-publisher.

## Lane A - DnD Wiring

Hypothesis: provider/sensor/id wiring is internally coherent; no source evidence supports a provider/id mismatch.

Evidence:

- DnD dependencies exist in `package.json:22`.
- `KanbanBoard` imports and uses `DndContext`, sensors, and overlay in `src/components/kanban-board.tsx:5` and `src/components/kanban-board.tsx:253`.
- Sensors are registered in `src/components/kanban-board.tsx:91`.
- `handleDragStart` uses active card id in `src/components/kanban-board.tsx:164`.
- `handleDragEnd` maps `over.id` to column/card stage and calls `moveCard` in `src/components/kanban-board.tsx:179` and `src/components/kanban-board.tsx:229`.
- Droppable ids are `column.id` in `src/components/pipeline-column.tsx:21`.
- Sortable card ids are `card.id` in `src/components/content-card.tsx:21`.
- Sortable context items are `cards.map((c) => c.id)` in `src/components/pipeline-column.tsx:41`.

DB row evidence:

- Read-only production rows exist in all stages:
  `ab3fbde3-d358-4013-8272-9abda6f21db9` (`ideas`),
  `1a40fd5b-0e11-4f77-a06d-890f4f487460` (`awaiting_approval`),
  `9221b39f-13bf-4b5d-b2a9-da54a375c72d` (`revision_needed`),
  `f0f6cd20-1fff-4945-8115-624a596a0905` (`approved_scheduled`),
  `72c4343f-83a9-41ba-950e-d9dd5106a530` (`posted`).

Missing:

- Live DOM event trace for actual drag start/drop.
- Live console/network trace for actual drag.

## Lane B - Handler/Event

Hypothesis: drag start is handle-only; if dragging starts and then snaps back, inspect `over.id`, gate returns, and scroll/drop geometry.

Evidence:

- Handler wiring: `src/components/kanban-board.tsx:164`, `src/components/kanban-board.tsx:169`, `src/components/kanban-board.tsx:257`.
- Silent no-op returns: no `over` in `src/components/kanban-board.tsx:172`; no target or same-stage in `src/components/kanban-board.tsx:185`.
- Drag listeners are on the handle button in `src/components/content-card.tsx:170`.
- Card body click handler is separate in `src/components/content-card.tsx:163`.
- Scroll contexts: board `touch-pan-x` in `src/components/kanban-board.tsx:276`; columns `overflow-y-auto` in `src/components/pipeline-column.tsx:35`.

Missing:

- Completed authenticated DOM drag event.
- Computed CSS at handle/drop point.
- Browser console/network trace.

## Lane C - Mutation

Hypothesis: mutation path is direct browser Supabase, not an API route; enum mismatch is unlikely.

Evidence:

- Direct stage update in `src/lib/pipeline-context.tsx:563`.
- UUID guard before Supabase stage update in `src/lib/pipeline-context.tsx:534` and `src/lib/pipeline-context.tsx:555`.
- Publish-job route is called only after committed approval side effect in `src/lib/pipeline-context.tsx:587` and `src/lib/pipeline-context.tsx:591`.
- Publish-job route requires the post already be `approved_scheduled` in `src/app/api/publish-jobs/route.ts:134`.
- RLS helper checks active `workspace_members` in `supabase/migrations/0007_rls_v2.sql:29`.
- `posts_update_v2` permits active write roles in `supabase/migrations/0007_rls_v2.sql:79`.

DB evidence:

- Current read-only production `posts` count is `24`.
- Current read-only stage counts: `ideas=1`, `awaiting_approval=7`, `revision_needed=2`, `approved_scheduled=6`, `posted=8`.

Missing:

- Live network `PATCH /rest/v1/posts` trace for an actual drag.
- Authenticated denied-write trace.

## Lane D - Optimistic Vs Truth

Hypothesis: false success is possible because the UI optimistically moves first and only checks Supabase `error`.

Evidence:

- Optimistic card state change happens before the async update in `src/lib/pipeline-context.tsx:550`.
- Stage update checks only `error` in `src/lib/pipeline-context.tsx:563`.
- Rollback/toast path exists only for thrown errors in `src/lib/pipeline-context.tsx:569`.
- Realtime canonical updates replace local cards when a DB update event exists in `src/lib/pipeline-context.tsx:443`.
- Refresh reloads DB truth via `resolveLoadedCards` in `src/lib/pipeline-context.tsx:405`.

DB evidence:

- Latest sampled successful stage audit: `8ad94c04-f41b-4bee-89a2-13a2ce24ff38` for post `f0f6cd20-1fff-4945-8115-624a596a0905`.
- Another sampled successful stage audit: `9f897b02-b333-4dbf-b94f-54570d7148c5` for post `1a40fd5b-0e11-4f77-a06d-890f4f487460`.

Missing:

- Live zero-row authenticated update proof.
- Browser trace showing optimistic move then refresh revert.

## Lane E - Auth/Role Gate

Hypothesis: current Reach active members should pass the board approver gate; drawer role resolution is less robust.

Evidence:

- Board approver roles are defined in `src/components/kanban-board.tsx:61`.
- Board role lookup uses `team_members` then `currentUser.role` fallback in `src/components/kanban-board.tsx:120`.
- App render is gated on active provision in `src/components/app-shell.tsx:285`.
- Auth provisioning runs through `/api/workspace/provision` in `src/lib/auth-context.tsx:91`.
- Same-user auth re-emit refresh path preserves mounted state in `src/lib/auth-context.tsx:209`.
- Team refresh runs on mount/focus/visibility in `src/lib/team-context.tsx:99` and `src/lib/team-context.tsx:177`.

DB evidence:

- Active Reach team rows currently returned: Aldridge Dagos `superadmin`, Hanes Lawrence Abasola `admin`, Shahannie Manuel `creative_director`.
- Active workspace member rows currently returned: same active role set, workspace `00000000-0000-0000-0000-000000000001`.
- Current read-only data did not return Muaaz or Carlo rows in Reach.

Missing:

- Live role-state values at the exact moment of a failed drop.

## Phase 2 Entry Criteria

Proceed with code only after this read-only Phase 1 commit is pushed.

Highest-blast-radius fix direction:

1. Update `moveCard` persistence to require a returned row or exact affected row proof.
2. Preserve all Iron Law invariants:
   provision before posts select, empty DB arrays as truth, UUID guards, no hard delete regression, no localStorage fallback on empty DB result.
3. Add focused tests around the persistence truth check.
4. Re-run lint/typecheck/focused tests.
5. Use temporary production QA rows only in Phase 2 verification and clean them up.

## CHANGES

EDITED:

- `PLAN-drag.md`
- `AUDIT-drag.md`
- `PROGRESS.md`

MODIFIED:

- No source code.
- No migrations.
- No production rows.

LEFT UNTOUCHED:

- `src/lib/pipeline-context.tsx`
- `src/components/kanban-board.tsx`
- `src/components/content-card.tsx`
- `src/components/pipeline-column.tsx`
- Supabase data and policies
- `/Users/ace/Documents/CURSOR MAIN/ten80ten-smm-portal`
