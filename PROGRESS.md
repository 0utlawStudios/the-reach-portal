# The Reach Clone Progress

updated-at: 2026-06-04T21:31:00Z

phase: HARDENING

item: Reach Portal drag surface changed from handle-only to whole-card drag. Manual Posted moves are now controlled by an admin-only Settings toggle and persisted through a service-role API route that writes `posted_at`.

last SHA: pending

next:

- User should test locally at `http://localhost:3001` with Settings > Publishing > Manual Posted moves enabled.

blockers:

- Local Playwright drag matrix could not reach `kanban-board` from its injected Supabase storage state; seeded rows/users/workspaces cleaned up successfully.

files:

- `src/components/content-card.tsx`
- `src/components/kanban-board.tsx`
- `src/components/pages/settings-page.tsx`
- `src/lib/pipeline-context.tsx`
- `src/lib/manual-posted-settings.ts`
- `src/app/api/admin/posts/[id]/manual-posted/route.ts`
- `src/lib/__tests__/iron-law-static.test.ts`
- `PROGRESS.md`
- `The Reach/FULL_TECHNICAL_FEATURE_AUDIT.md`

invariants:

- Correct repo only: `/Users/ace/Documents/CURSOR MAIN/THE REACH SMM PORTAL`.
- Left untouched: `/Users/ace/Documents/CURSOR MAIN/ten80ten-smm-portal`.
- No DB schema, RLS, trigger, or migration changes.
- Direct browser-authenticated Supabase writes to `stage='posted'` remain blocked by migration `0046_post_stage_transition_guard.sql`.
- Manual Posted moves use an admin-only Next route with `requireBearerTeamRole(request, ["superadmin", "admin", "owner"])`.
- Posts must never disappear.

evidence:

- `npm run typecheck`: passed.
- `npm test -- --run src/lib/__tests__/iron-law-static.test.ts`: passed, 26 tests.
- `npm run lint`: passed with existing `src/lib/ai/worker.ts` warning.
- `npm test`: passed, 30 files / 271 tests.
- `npm run build`: passed; route table includes `/api/admin/posts/[id]/manual-posted`.
- `git diff --check`: passed.
- `curl -X POST /api/admin/posts/.../manual-posted` without bearer token: `401 Unauthorized`.
- Local Playwright run id `drag-reach-manual-posted`: failed before board render; cleanup counts all zero.

named users:

- Aldridge Dagos, `aldridge@ten80ten.com`, `auth.users.id=f4d6c15a-7b94-4e58-ac8b-4de98aa0d644`, `superadmin`.
- Hanes Lawrence Abasola, `hanes@ten80ten.com`, `auth.users.id=952b51be-9037-4da3-8364-5b52bf894347`, `admin`.
- Shahannie Manuel, `shang.ten80ten@gmail.com`, `auth.users.id=a7f2165d-d667-4bf8-ab37-383ffc485323`, `creative_director`.
- Muaaz and Carlo are intentionally excluded from Reach because the user clarified they belong to the Ten80Ten SMM Portal, not this Reach Portal.

verification:

- `npm run typecheck`: passed.
- `npm run lint`: passed with the existing `src/lib/ai/worker.ts` warning.
- `git diff --check`: passed.
- `npm test`: passed, 30 files / 271 tests.
- `npm run build`: passed.
- `PLAYWRIGHT_BASE_URL=http://127.0.0.1:3001 PLAYWRIGHT_RUN_ID=drag-reach-manual-posted npx playwright test e2e/drag.spec.ts --project=chromium`: failed before drag because `kanban-board` never rendered from the harness auth state; cleanup succeeded.

changes report:

- EDITED: `src/components/content-card.tsx`, `src/components/kanban-board.tsx`, `src/components/pages/settings-page.tsx`, `src/lib/pipeline-context.tsx`, `src/lib/__tests__/iron-law-static.test.ts`, `PROGRESS.md`, `The Reach/FULL_TECHNICAL_FEATURE_AUDIT.md`
- ADDED: `src/lib/manual-posted-settings.ts`, `src/app/api/admin/posts/[id]/manual-posted/route.ts`
- LEFT UNTOUCHED: `/Users/ace/Documents/CURSOR MAIN/ten80ten-smm-portal`, DB migrations, RLS, triggers, design, brand, copy
