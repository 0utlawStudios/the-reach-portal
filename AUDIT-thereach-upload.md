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

---

# Session 2 — staleClient root cause, 31-agent QA swarm, P1 fix, every-upload notifications

After the first gate passed, a real user (Shahannie) still hit "uploaded but got the error"
and "saw the video, now it's gone." Live investigation + a fresh adversarial swarm found two
*new* real causes the first pass missed.

## 2A — The real shape of the "uploaded but errored" report (FIXED, live-verified)

The video NEVER persisted (0 Drive files, 0 `upload_succeeded` events — only `sessionInvalid`
failures in `audit_log_v2`). Server verify WORKS for a current client (reproduced live: chunk
1 → 200). Cause = a **stale browser bundle**: a tab running client JS cached from before the
signed `X-Upload-Token` (commit `95f3d4a`, 2026-06-25) sends NO token, so verify can never
pass no matter how many retries — and the old code mislabeled that as `sessionInvalid`/storage.

- New `staleClient` reason (`drive-errors.ts`): a MISSING/malformed token → **409** with an
  actionable "This page is running an older version. Please refresh the page" message; a
  well-formed-but-rejected token stays `sessionInvalid` (403, retry). Both now logged + alerted
  (the stale path was previously silent). Commit `a536bed`.
- `drive-upload.ts`: transient server 5xx/429 now retry IN PLACE on the same resumable session
  (resume by byte offset, never restart from 0); per-chunk Bearer refresh so a multi-hour large
  upload can't die on an expired JWT.
- **Live-verified on deployed code**: full 5 MB `.mov` e2e = PASS; missing-token = 409
  staleClient; garbage-token = 409 staleClient. No fake "storage rejected" wording.

## 2B — 31-agent adversarial QA swarm (7 dimensions, each finding refuted by a skeptic)

13 confirmed after refutation (11 dismissed). Severity after independent verification:
**1 P1, 12 P3** (0 P0/P2). The two dismissed P2s (RR-01 resumable-offset, ET-01 unmapped-4xx)
were refuted at the code level (256 KiB chunk alignment + 308-only-on-full-receipt; and the
only remaining unmapped 4xx is a genuine reason-less 403 → correct `storageRejected`).

### P1 — Deleting an in-use Media Library asset destroyed the post's media — FIXED (`13f07bf`)
`delete-media/route.ts`. Library assets and post cards share ONE underlying Drive file
(`ensureMediaAsset` dedups to one `media_assets` row per `file_id`). Deleting a library asset
that a live post used **trashed the shared Drive file AND removed the row that authorizes the
post's stream** — no guard at any layer. This is the most likely cause of "I think I mistakenly
deleted it." Fix: before trashing, load every workspace post's reference columns once and
**refuse** to trash a file any post references (by Drive file id OR the asset's UUID); **fail
CLOSED** if usage can't be loaded. Client warns in the delete dialog + surfaces the "still used
by N posts" reason. 7 new route tests (block-by-fileid, block-by-uuid, fail-closed, allow +
audit + playback cleanup, file_id-first resolve).

### P3s FIXED in this session
- **delete-sync-4** — resolve the Drive id from the authoritative `file_id` column first, URL
  parsing only as fallback (playback-optimized videos store no `?id=` URL).
- **delete-sync-2** — every trash + 404 stale-row cleanup now writes a `media_trashed` /
  `media_orphan_cleanup` audit row, so a mistaken delete can be matched back from Drive trash.
- **delete-sync-3** — the private Supabase `media-playback` derivative is removed on delete
  instead of orphaned.
- **TEL-02** — the client `upload-failure` audit write now routes through `redact()` (parity
  with the server path; no Bearer/token/secret can land in `audit_log_v2`).
- **ET-02 / ET-03** — log the real Google reason on a chunk PUT failure; log + alert the
  previously-silent "no file id" terminal branch.

### P3s DEFERRED — accepted residuals (low-severity, self-healing or need a background job)
- **CS-1** — `asset-review-drawer` cover-replace persists a `blob:` thumbnail to
  `posts.thumbnail_url`; a tab-close mid-upload leaves a broken cover (single field,
  self-heals on next cover replace). Fix = local preview state, do not route through updateCard.
- **CS-4** — `staleClient` is shown via the 4 s auto-dismiss toast, same weight as a transient
  error; the message is correct + re-appears each retry. Fix = a sticky reload banner (needs
  `toast-context` persistent/action support + 4-surface wiring).
- **CS-2 / CS-3** — a Drive upload whose DB row insert fails (rare 8 s timeout) or an abandoned
  partial create-post batch leaves an orphaned Drive file with no row. NOT data loss (the
  opposite — a file persists that should be trashed). The correct remedy is a background
  reconciliation sweeper; naive trash-on-failure would risk a WORSE data-loss race (the insert
  may have committed while the client timed out). Tracked for a sweeper.
- **TEL-01** — a terminal server failure is alerted by both the server route and the client
  re-report (2 pings, 2 audit rows under distinct actions). Notification hygiene only; single-
  tenant low volume. Fix = suppress the client re-report when the server already alerted.
- **TEL-03** — `playback-upload` records failures but no success parity (no server completion
  route for the client-direct playback copy); accepted.

## 2C — Every-upload notifications (`1ec601f`)
Per owner request, a SUCCESSFUL upload now also pings the owner email + Telegram (not just
failures), so all upload activity is visible. `notifyUploadSuccess` fires from the same success
point as the audit (finalize + proxy-upload), off the request critical path. Opt-out via
`UPLOAD_SUCCESS_NOTIFY=false`. Volume note: one ping per completed file.

## 2D — App data hygiene
Census of the live baseline workspace: **105 media_assets + 4 posts, ALL real user content,
ZERO test artifacts.** Every test this session used an isolated temp user + full teardown
(temp user, memberships, Drive files trashed, fixture rows removed). No test data persists in
the app or the production DB.
