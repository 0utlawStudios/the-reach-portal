# AUDIT — The Reach Drive upload/delete hardening (adversarial gate)

Read-only adversarial pass over `4583762..HEAD` on `main` (Drive resumable upload +
delete-sync hardening). Severity P0 (breaks the fix / data loss) → P3 (nit). Every item
cites file:line. **Gate: zero unaddressed P0/P1.**

## Verdict

**PASS — 0 unaddressed P0, 0 unaddressed P1.** Three independent reviewers (correctness,
security, completeness) plus live verification. The single P2 and all P3 findings were
fixed in the hardening pass (commit `b94d81f`); the items below marked *Resolved* cite the
fix. Two residual items are accepted, low-risk, and documented.

## Evidence base (how this was verified, not asserted)

| Check | Result |
|---|---|
| Direct-to-Google 93.89 MB `video/quicktime` resumable commit | session 200 → 47 chunks 308 → final **200 + fileId in 17 s** (test file trashed). Google/storage/size/alignment ruled out as the cause. |
| Authenticated **e2e smoke through the live Vercel routes** (`npm run e2e:prod`) | **2/2 PASS (1.2 m)** — media-library upload (image + video) + create-post upload persisting Drive metadata with **no post loss**. Isolated per-run workspace, full teardown. |
| Full unit/regression suite (`vitest run`) | **544/544 pass** (66 files), incl. the expired-token regression. |
| Load-bearing build (`npm run build`) | exit 0, all routes typed/exported. |

## Findings

### P0 — none
### P1 — none

### P2 (resolved)

**P2-1 — delete-media 404 → permanently undeletable orphan — RESOLVED**
`src/app/api/drive/delete-media/route.ts:142-161`. Previously `getFileMetadata()` threw on
any non-OK including a 404 (file purged from Drive externally), the catch kept the DB row,
and every retry re-404'd — an asset the user could never remove. Fix: new read-only
`getFileMetadataOrNull()` (`src/lib/google-drive.ts:459`) returns `null` only on a
confirmed 404 and still throws on every other status; the route then skips the (moot) trash
and deletes the stale, workspace-scoped row. No cross-workspace effect (the row was loaded
with `.eq("workspace_id", workspaceId)` and no Drive file is touched). Test:
`delete-media/__tests__/route.test.ts` "deletes the stale DB row when the Drive file is
already gone (404)".

### P3 (resolved)

**P3-1 — audit persisted pre-redact error values — RESOLVED (defense-in-depth)**
`src/lib/upload-alerts.ts:200-216`. `notifyUploadFailure` now passes `normalized.errorDetail`
/ `normalized.errorMessage` (already run through `redact()`) to `recordServerUploadFailure`,
matching the email/Telegram path. Secrets can't reach `audit_log_v2` even if a future caller
passes raw text.

**P3-2 — no delete batch cap (resource exhaustion) — RESOLVED**
`src/app/api/drive/delete-media/route.ts:24,87-88,116-118`. `MAX_DELETE_BATCH = 25` caps the
per-request batch (each asset costs up to 3 sequential Drive calls vs. a 60 s function
budget). Overflow ids are returned as explicit `failed` results (not silently dropped) so the
UI restores them; the user retries in batches. Test: "caps the batch at MAX_DELETE_BATCH and
reports overflow as failed".

**P3-3 — admin client recreated per audit call — RESOLVED**
`src/lib/upload-audit.ts:27-35`. Module-level `cachedAdmin` reuses one service-role client
instead of constructing GoTrue/Realtime state on every upload success/failure.

**P3-4 — orphaned setTimeout after Promise.race — RESOLVED**
`src/lib/upload-audit.ts:46-70`. The timeout handle is cleared in a `finally`, so the timer
never lingers after the RPC wins the race.

**P3-5 — folder-creating ensureSubfolder used in a delete path — RESOLVED**
`src/lib/google-drive.ts:191` (`getSubfolderId`, read-only) replaces `ensureSubfolder`
in `delete-media/route.ts:110-114`. The delete path can no longer mint Drive folders; it
looks them up or skips them. Tests assert no POST (create) is ever issued.

**Completeness gap — no isolated expired-token regression — RESOLVED**
`src/lib/__tests__/drive-upload-session.test.ts` "rejects an expired token". Signs with an
expiry 1 s in the past and asserts `verifyDriveUploadSessionToken → false` (then a fresh
token still verifies, isolating expiry from a field mismatch). This is the exact production
failure mode (a slow large upload crossing the old 60-min TTL) that used to surface as the
mislabeled "Storage rejected the upload."

## Residual / accepted (low-risk, documented)

- **R1 — `GOOGLE_DRIVE_IMPERSONATE_EMAIL` remains set in Vercel/.env (no-op).** Code path is
  a documented no-op (`src/lib/google-drive.ts` getAuth comment); removal is a console/env
  chore tracked in CHANGES "Follow-up". No runtime effect.
- **R2 — pending migrations 0010-0015 not yet applied to prod.** `POSTS_SELECT_FULL` falls
  back to `POSTS_SELECT_BASIC` automatically (AGENTS.md §7); upload/delete telemetry uses the
  existing `record_audit_event` RPC + `audit_log_v2`, which are live. No dependency on the
  pending migrations.

## Invariants preserved (spot-checked)

- Posts never disappear: `pipeline-context.tsx` load() and the migration-0015 triggers
  untouched. Iron Law intact.
- Every domain insert carries `workspace_id`; `isValidUuid()` guards card-ID Supabase ops.
- Delete is fail-closed: a row is removed only after Drive trash succeeds OR the file is
  confirmed already gone (404); every other failure keeps the row and the UI restores it.
- `validUploadUri()` SSRF allowlist (`upload-chunk/route.ts`) unchanged; server PUTs only to
  `https://www.googleapis.com/upload/drive/v3/files?...uploadType=resumable&upload_id=...`.
- Honest per-file status: a session/token failure surfaces as `sessionInvalid` (403), never
  the generic "Storage rejected the upload."
