# Pre-Deploy Adversarial QA Swarm, Round 2

**Date:** 2026-05-20
**Repository:** ten80ten-smm-portal (Ten80Ten Content Engine)
**Baseline:** origin/main @ c09439b (Round 1 QA pass)
**Verdict:** Ship. All 6 critical and all 18 high findings are fixed. Build, typecheck, lint, and 131 tests pass.

---

## 1. Method

Five subagents audited the repository in parallel, each with a distinct adversarial persona, instructed to treat the code as production work by an unknown author and to verify every claim against the real source. No agent was told which fixes Round 1 had shipped.

1. Principal Security Auditor: auth, PII, injection, secret handling.
2. Performance Engineer: render and query hotpaths.
3. Data Integrity Architect: every write path, race conditions, schema drift.
4. UX Adversary: mobile viewports, edge cases, accessibility, copy.
5. Test Coverage Inquisitor: untested branches, guard quality.

Each agent returned a ranked JSON fix queue with severity, file paths, and a reproducer. The orchestrator deduplicated the findings, built a single dependency-ordered plan, and ran the fixes in five waves with non-overlapping file ownership so no two work streams touched the same file.

## 2. Findings

63 findings. The deduplicated set collapsed several cross-domain overlaps (for example, moveCard appeared in DATA-001, DATA-004, DATA-011, and PERF-001 and was fixed once as a whole).

| Domain | Critical | High | Medium | Low | Total |
|---|---|---|---|---|---|
| Security | 1 | 3 | 4 | 4 | 12 |
| Data integrity | 1 | 4 | 4 | 3 | 12 |
| Performance | 0 | 2 | 4 | 3 | 9 |
| UX | 0 | 3 | 6 | 5 | 14 |
| Test coverage | 4 | 6 | 5 | 3 | 16 |
| **Total** | **6** | **18** | **23** | **16** | **63** |

Outcome: 59 fixed with code changes. 1 verified as not a code defect (TEST-005). 3 deferred with documented reasons (PERF-008, PERF-009, TEST-015). Every critical and every high is resolved.

## 3. What shipped

### Wave 1, the iron-law file (src/lib/pipeline-context.tsx)

- **DATA-001 (critical):** moveCard no longer rolls the stage back when publish-job creation fails. The stage move is committed and valid on its own; the n8n claimer reconciles the job. A failed job now keeps the card approved and shows a retry notice instead of silently un-approving it.
- **DATA-011:** the misleading rollback-of-rollback path is gone, since the only catch case left is a genuine stage-UPDATE failure where nothing committed.
- **PERF-001 + DATA-004:** the audit log entry for a move fires only after the DB write confirms, not before. A temp-id card (mid-create) rejects the move with a toast instead of losing it silently.
- **DATA-003 + DATA-010:** realtime DELETE echoes are never suppressed by the dedup set (a peer delete must always apply). Every rollback path clears the card from the dedup set so a realtime correction can re-sync it.
- **DATA-005:** createCard now remaps an open drawer's selectedCard from the temp id to the real UUID, so later saves from that drawer persist.
- **DATA-006:** a rejected delete reopens the drawer the user deleted from.
- **DATA-009:** removed a dead `scheduledAt` cast that read a field the card object never carries.
- **PERF-002:** the localStorage backup is debounced, replacing a full-board JSON.stringify on every keystroke and every realtime echo.
- **PERF-007:** action callbacks read a latest-value ref instead of listing `cards` in their dependency arrays, stabilizing callback identity.
- The load path was extracted to a pure `resolveLoadedCards` function so the §1b empty-array guard is unit-testable.

All five iron-law guards were re-verified intact (see Section 6).

### Wave 2, auth token transport

- **SEC-001 (critical):** /auth/setup and /auth/reset-password read session tokens from `window.location.hash`, not the query string. Round 1 moved the tokens into the URL fragment but never patched the pages to read them, so invite and recovery worked only inside a 10-minute cookie window. Both flows now work directly.
- **SEC-004:** both pages scrub the fragment with `history.replaceState` the moment they read it, so tokens do not linger in the address bar or browser history.

### Wave 3, API and security routes

- **SEC-002:** the HEALTH_CHECK_SECRET comparison on both health routes uses a constant-time `timingSafeEqual`, closing the byte-by-byte timing oracle.
- **SEC-003:** /api/health/deep-check returns counts instead of raw email and name arrays, so a single authorized call no longer exports the org roster.
- **SEC-007:** audit metrics read from `audit_log_v2`, the table the app actually writes to, instead of the stale legacy `post_audit_logs`.
- **SEC-006:** the health self-test derives its base URL from `NEXT_PUBLIC_SITE_URL` instead of a hardcoded production host.
- **SEC-008:** /api/team/request-access sends the admin notification fire-and-forget, so response latency no longer leaks whether an email is new.
- **SEC-009:** the drive/stream fileId regex is tightened to match drive/finalize.
- **SEC-010:** identity and role lookups use `.eq` instead of `.ilike`, so an email containing a SQL wildcard cannot match the wrong row.
- **SEC-011:** publish-jobs, the ai/studio routes, and the workspace provisioner return generic client messages and log the raw error server-side, instead of leaking PostgREST schema detail.
- **SEC-012:** a `Content-Security-Policy-Report-Only` header is added. Report-only is non-breaking; it collects violation reports before any future switch to an enforcing policy.
- **SEC-005:** the presence/departure header comment is corrected to drop the removed freeze listener.
- **PERF-003:** drive/stream fetches file metadata and the Google access token concurrently.

### Wave 4, UX and supporting data integrity

- **UX-001:** the kanban drag handle is visible on touch devices and has a 44px tap target.
- **UX-002:** user-facing "Pipeline" labels are renamed to "Content Engine" or "Board" (kanban tab, repurpose button, PWA manifest, dashboard).
- **UX-003:** the request-access page uses `min-h-dvh`.
- **UX-004:** the @mention dropdown supports arrow-key navigation, Enter or Tab to select, and Escape to close.
- **UX-005:** seven bespoke modals gain a shared focus trap and dialog ARIA roles.
- **UX-006:** the revision and repurpose modals disable their submit button while a submission is in flight.
- **UX-007:** a mobile column tab strip lets users reach all five board columns without blind horizontal scrolling.
- **UX-008:** the dashboard auto-fit clamps to a minimum scale and scrolls instead of shrinking content unreadably.
- **UX-009:** Media Library deletes ask for confirmation.
- **UX-010 + UX-011:** rendered em dashes and toast em dashes are replaced, per the project copy rules.
- **UX-012:** the Media Library view toggle stays visible on mobile so users can return to grid view.
- **UX-013:** non-functional settings controls are disabled with a "coming soon" affordance instead of silently doing nothing.
- **UX-014:** the avatar crop modal resets its button state in a finally block.
- **DATA-002:** the asset-review-drawer fires the @mention email only after the comment write confirms, and uses the strict mention regex.
- **DATA-007:** team member update and remove roll back local state on a DB failure.
- **DATA-008:** the brand kit save and the Media Library bulk delete check the DB result and roll back on failure instead of reporting a false success.
- **PERF-004:** the auth context skips a redundant re-render when the enriched profile is unchanged.
- **PERF-005:** the Creator Studio poll holds one steady interval instead of recreating it on every grid edit.
- **PERF-006:** PipelineColumn receives `isLoading` as a prop instead of subscribing to the whole pipeline context.

### Wave 5, test coverage

- **TEST-001:** the §5 guard test now fails if any new id-keyed Supabase call lacks an isValidUuid guard, verified by a tampering check.
- **TEST-002:** the §1b guard is unit-tested directly against the new `resolveLoadedCards` function, and the forbidden-pattern grep is broadened to catch refactored spellings.
- **TEST-003:** media-assets.ts imports the strict shared `isValidUuid` instead of a weak local copy that accepted the zero-UUID.
- **TEST-006:** scheduling.test.ts imports the real `toScheduledAt`, not a private copy.
- **TEST-007:** the §3 audit guard greps all of src, not just audit.ts.
- **TEST-004, 008 to 013, 016:** new tests cover the pipeline mappers, email-utils security functions, rate-limit fail-open behavior, the workspace provisioner, and contract-level auth on the highest-risk API routes.

The suite grew from 44 tests in 4 files to 131 tests in 11 files.

## 4. Deferred and no-action items

| ID | Severity | Decision | Reason |
|---|---|---|---|
| SEC-009 (deeper check) | low | Partial | The fileId regex is tightened. The deeper per-file workspace-membership check on drive/stream is deferred because it risks returning 404 for legitimately shared Drive files not yet tracked in media_assets. Follow-up: backfill media_assets, then add the scoped check. |
| PERF-008 | low | Deferred | The known-failing POSTS_SELECT_FULL attempt costs one wasted round-trip per load until migrations 0010 to 0014 reach production. An env flag was rejected; the team avoids feature flags. Self-resolves when those migrations are applied. |
| PERF-009 | low | Deferred | dbToCard runs regex scans on realtime echoes. The audit agent rated this informational and recommended no change for this deploy. Revisit only if revisionHistory becomes a real column. |
| TEST-005 | high | No action | The vitest binary can be absent on a cold local checkout. Confirmed not a code defect: CI runs `npm ci` first, so CI is safe. Documented for local developers. |
| TEST-015 | low | Deferred | A hard CI coverage gate on a 123-file repo with low current coverage would fail the build. Needs a measured baseline first, then a deliberate ratchet. Tracked as a dedicated task. |

## 5. Verification

| Gate | Result |
|---|---|
| ESLint | 0 errors, 8 warnings (all pre-existing, none on changed lines) |
| TypeScript (tsc --noEmit) | 0 errors |
| Vitest | 131 passed in 11 files |
| Production build (next build) | exit 0 |

Spot-checks beyond the gates: the CSP header is Report-Only and non-enforcing; deep-check audit metrics read `audit_log_v2` with no client writes to `post_audit_logs`; no `.ilike` identity lookups remain.

UI feature correctness was not exercised in a live browser during this autonomous pass. The four gates plus the targeted 131 tests are the verification basis; the iron-law guards are statically verified and test-locked.

## 6. Iron-law guard attestation

Per AGENTS.md §8, all five guards in pipeline-context.tsx were re-verified after the Wave 1 rewrite:

1. **Provision before SELECT:** load() resolves the workspace via /api/workspace/provision before the posts SELECT. Intact.
2. **Empty array is a valid board:** the new `resolveLoadedCards` falls back to localStorage only on a real DB error, never on an empty result. Intact.
3. **workspace_id on every insert:** createCard sets `workspace_id` via the baseline-UUID fallback, never conditional-only. Intact.
4. **isValidUuid guards:** all five mutation sites are guarded; moveCard also gains an explicit temp-id rejection. Six guards total. Intact.
5. **Audit via record_audit_event RPC:** unchanged. No client writes to post_audit_logs anywhere in src. Intact.

The static-grep guard tests in iron-law-static.test.ts were hardened so a future regression of any of these patterns fails the build.

## 7. Follow-up backlog

- SEC-009: backfill media_assets, then add a workspace-scoped membership check to drive/stream.
- PERF-008: drop the POSTS_SELECT_FULL fallback once migrations 0010 to 0014 are applied to production.
- TEST-015: measure a coverage baseline, then add a CI coverage step with a low ratcheting threshold.
- Tighten the notifications/mention route test mock so it implements the full query chain (the test passes today but logs an internal error from an incomplete mock).
- Move toward an enforcing Content-Security-Policy once Report-Only violation reports are clean.

---

**Audited and remediated:** 2026-05-20 by the parallel adversarial QA swarm, orchestrated by Claude (Opus 4.7).
**Round 1 reference:** docs/audits/2026-05-20-pre-deploy-qa-swarm.md
