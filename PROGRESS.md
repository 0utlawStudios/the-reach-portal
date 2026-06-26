# The Reach — Drive upload/delete hardening

updated-at: 2026-06-26T18:40:00+08:00

phase: Session 2 COMPLETE. staleClient root cause fixed + 31-agent QA swarm (1 P1 + 12 P3)
+ P1 data-loss fix + every-upload notifications. All shipped to main + live-verified.

## Session 1 (done, deployed) — the mislabeled session-token 403
- Root cause: the chunk route's `verifyDriveUploadSessionToken` 403 was sanitized into the
  generic "Storage rejected the upload." A full 93.89 MB `.mov` commits direct-to-Google in
  17 s, so storage/size/alignment were never the cause.
- Fixed: `sessionInvalid` taxonomy + 12h token TTL + drop fileName/mimeType from the HMAC +
  500 MB cap + derived chunk rate limit + zero-byte reject + queryable `audit_log_v2` +
  fail-closed delete-media (trash, not DELETE; SA `canTrash` but not `canDelete`).
- Commits `4583762..3a1797f`. AUDIT gate PASS (0 P0/P1). Live e2e 2/2.

## Session 2 (done, deployed) — stale bundle + the real delete data-loss bug
A real user still failed after Session 1. Two NEW real causes were found and fixed:

### staleClient (commit a536bed, LIVE-verified)
- The user's browser ran a bundle cached from before the signed `X-Upload-Token` (95f3d4a),
  so it sent NO token → verify could never pass → mislabeled. The video NEVER persisted
  (0 Drive files, 0 `upload_succeeded`; only `sessionInvalid` events). Nothing was deleted
  by the system on that path.
- Fix: missing/malformed token → **409 staleClient** ("refresh the page"), distinct from a
  well-formed-but-rejected token (403 sessionInvalid). Both logged + alerted. Transient
  5xx/429 retry IN PLACE (resume by offset). Per-chunk Bearer refresh.
- Live: 5 MB e2e PASS; missing-token 409 staleClient; garbage-token 409 staleClient.

### 31-agent QA swarm → 1 P1 + 12 P3 (each finding refuted by an independent skeptic)
- **P1 (commit 13f07bf)** — deleting an in-use Media Library asset trashed the SHARED Drive
  file + removed the `media_assets` row a live post streams from. No guard at any layer. The
  most likely cause of "saw the video, now it's gone — I think I mistakenly deleted it."
  Fix: server refuses to trash a file any post references (by file id OR asset UUID), fail
  CLOSED; client warns in the delete dialog. + file_id-first resolver, delete audit trail,
  playback-object cleanup. 7 new tests.
- **P3 fixed** — TEL-02 redact client audit; ET-02 log Google reason; ET-03 alert the silent
  no-fileId branch.
- **P3 deferred (documented residuals)** — CS-1 blob thumbnail; CS-4 staleClient sticky
  toast; CS-2/CS-3 orphan-on-failure (need a reconciliation sweeper); TEL-01 double-alert;
  TEL-03 playback denominator. All low-severity, none data loss. See AUDIT §2B.

### Every-upload notifications (commit 1ec601f)
- Successful uploads now also ping the owner email + Telegram (not just failures), so all
  upload activity is visible. Opt-out: `UPLOAD_SUCCESS_NOTIFY=false`. One ping per file.

## Verification
- 553 unit tests (66 files) + `npm run build` green before each push.
- Live (deployed): staleClient 3/3; real ~253 MB `.mov` end-to-end — SEE BELOW.
- App hygiene: 105 media_assets + 4 posts, ALL real content, ZERO test residue. Every test
  used an isolated temp user + full teardown.

## Real-file test (the user's actual 253 MB Envato .mov) — ALL PASS
- Uploaded `woman-using-laptop-on-sofa...utc.mov` (253.3 MB, the real Envato clip) end-to-end
  through the LIVE pipeline: session 200 → 127 chunks all 200 (~10.5 min) → finalize 200 →
  real Drive fileId, file present at 253.3 MB, not trashed. The success notification fired.
- Registered it as a `media_assets` row, then deleted it via the live P1-hardened
  `/api/drive/delete-media` (unreferenced → trashed + row removed + audited). Zero residue.
- Envato investigation: NO Envato stock file exists in the app, Drive (live or trashed), or
  the audit log — they never persisted (failed before audit telemetry shipped; not deleted
  post-upload). The only big-video failures on record are Shahannie's 93.9 MB
  `Draft The Reach Intro .mov` (stale-bundle sessionInvalid, now fixed).

## Honest handoff status
- The original incident (upload error + vanished video) has a fixed, live-verified root cause
  for BOTH symptoms (stale bundle → refresh; in-use delete → now blocked).
- The QA swarm DID find a real P1 + P3s — this was NOT bug-free before. P1 + the high-value
  P3s are fixed; 5 low-severity P3s are documented residuals (AUDIT §2B), none data loss.
- Recommended next: a background reconciliation sweeper for orphaned Drive files (CS-2/CS-3),
  the staleClient sticky banner (CS-4), and removing the no-op GOOGLE_DRIVE_IMPERSONATE_EMAIL.

## last commit SHA
- Session 2: a536bed (staleClient) → 13f07bf (P1 + P3) → 1ec601f (notifications) → this (docs).

## Hard invariants (unchanged)
- Posts never disappear; empty DB result is valid; every insert has workspace_id;
  isValidUuid()/version-agnostic UUID guards; no blob: URLs persisted (CS-1 residual);
  delete is fail-closed AND now usage-guarded; `npm run build` is the load-bearing gate.
