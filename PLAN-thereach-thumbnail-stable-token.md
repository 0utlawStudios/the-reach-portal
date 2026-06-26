# The Reach — Stable workspace-bound thumbnail token + edge cache (thumbnail "Go big", increment 2)

Status: IN PROGRESS (2026-06-27). Increment 1 (batch-sign) shipped `e44d0d5`. This is the
cross-device caching half Aldridge chose ("Go big: stable URLs + edge cache"). Bar set by the
user this turn: **pristine, no issues at all** — adversarially verified before ship.

## The problem (confirmed by reading the live serving path)
A thumbnail URL is `/api/media/image-preview?id=<fileId>&size=thumb&token=<T>`. Today the
signer (`view-url` + `view-url/batch`) mints `T` with `signDriveStreamToken(fileId, ws,
Date.now()+15min, "private")`. The token embeds `Date.now()`, so **every sign produces a
different token → a different URL → the browser/CDN cache never reuses it across signs,
sessions, devices, or users.** The image is even served `Cache-Control: private, max-age=86400`
(browser-only, never shared), so a new device always re-fetches from Drive + re-rasterizes.

## The fix (server-side only — minimal blast radius)
A **stable, workspace-bound `thumb` capability token**: deterministic for a given
(fileId, workspaceId) over a long window, served `public, s-maxage` so Vercel's edge/CDN caches
it once and serves every device + workspace member without re-signing or re-hitting Drive.

### Token (`src/lib/google-drive.ts`)
- Add `"thumb"` to `DriveStreamTokenPurpose` (`"private" | "publish" | "thumb"`).
- `THUMB_TOKEN_BUCKET_MS = 30 days`. New `signStableThumbToken(fileId, ws)`:
  `expiresAt = (floor(Date.now()/BUCKET) + 2) * BUCKET` → **identical token for all signs in a
  30-day bucket**, valid ~30–60 days out, auto-rotates monthly, never permanent.
- `verifyDriveStreamToken`: accept v2 purpose `"thumb"` (same expiry + timing-safe sig check,
  sig binds fileId+ws+expiresAt+purpose). Returns `{ workspaceId, expiresAt, purpose: "thumb" }`.

### Signer (`view-url/route.ts` + `view-url/batch/route.ts`)
- For a `drive` target whose path is `/api/media/image-preview` AND `size === "thumb"`:
  mint `signStableThumbToken(fileId, ws)` → the whole URL is now **stable**.
- Everything else (full-size image-preview, `/api/drive/stream`, `/api/media/playback`):
  unchanged — keep the per-request 15-min `private` token. The JSON response stays `no-store`.

### Serving (`image-preview/route.ts`)
- `checkAuth`: accept `signedClaims.purpose === "thumb"` → `{ ok, signed:true,
  signedPurpose:"thumb", workspaceId }`.
- `GET`: if `signedPurpose === "thumb"` and `previewSize !== "thumb"` → **403** (a thumb token
  must NOT fetch full-res). videoPoster is thumb-size, so it is allowed.
- Cache scope: `signedPurpose === "publish" || signedPurpose === "thumb"` → `"publish"` →
  `Cache-Control: public, max-age=86400, immutable` (edge-cacheable). `"private"` unchanged.
- The existing file-appProperties workspace gate (a thumb token's ws must match the file's
  Drive `appProperties.workspaceId`) still runs on a cache MISS — defense in depth.

### Stream (`src/app/api/drive/stream/route.ts`) — NO functional change
- Its `checkAuth` only honors `private`/`publish` signed tokens; a `thumb` token falls through
  to session auth → 401 without a session. So **a thumb token can never stream video.** Add a
  one-line comment making that explicit. Same for `/api/media/playback` (separate token scheme).

## Security model (the capability boundary)
- The thumb token is an **unguessable HMAC capability for exactly one (fileId, workspaceId)
  thumbnail.** It binds fileId (sig recomputed with the request's fileId → can't move to another
  file) and workspaceId (in payload + checked vs the file's Drive appProperties).
- It grants ONLY the ≤200px poster on the thumb path. It CANNOT: fetch full-res (403), stream
  video (401), read playback (different token), or reach another workspace's media.
- `public` edge caching of a capability URL is the standard signed-URL CDN pattern: the cache is
  keyed by the full URL, the token is the secret, only an authorized signer hands it out. Blast
  radius of a leaked URL = one low-sensitivity thumbnail (identical to how `publish` URLs work).
- Full originals + video streams keep per-user gating. Unchanged.

## Tests (happy + ≥3 edges + ≥1 hostile, per the QA bar)
- `google-drive-token.test.ts`: thumb signs+verifies; **stable** (two signs same bucket →
  identical token); rejected for a different fileId; expired thumb → null; tampered sig → null.
- `view-url` + `batch` route tests: thumb-size image-preview → stable token (identical across
  two calls); full-size + stream targets → still per-request private (changes), still `no-store`.
- `image-preview/route.test.ts`: thumb token + size=thumb → 200 + `Cache-Control: public…`;
  thumb token + size=full → 403; private/publish paths unchanged.
- `stream` security: a thumb-purpose token with no session → 401 (can't stream).
- Update `upload-surfaces-static.test.ts` assertions if the signer text shifts.

## Adversarial verification (before ship — "no issues at all")
Workflow of independent skeptics, each told to BREAK the boundary: (1) forge/replay a thumb
token across files; (2) cross-workspace fetch; (3) escalate thumb→full-res; (4) escalate
thumb→video stream; (5) cache-poisoning / does `public` leak across workspaces; (6) does the
bucketed expiry ever yield an already-expired or permanent token. Plus a security-reviewer pass.
Majority-refute kills a finding; survivors get fixed before commit.

## DONE-WHEN
Thumbnail URL is byte-identical across two signs for the same file; image-preview serves it
`public, s-maxage`; a thumb token 403s on full-res and 401s on stream; build + full vitest green;
adversarial pass finds no real escalation/leak. Ship to main, Aldridge eyeballs the live grid.

## Constraints (LOCKED)
Stay free (no GCS, no premium Supabase, no ffmpeg on Vercel). 500MB upload cap stays. Per-user
gating on full originals + streams stays. Posts never disappear; workspace_id on every insert.
`npm run build` is the load-bearing gate. Commit + push straight to main (solo repo).
