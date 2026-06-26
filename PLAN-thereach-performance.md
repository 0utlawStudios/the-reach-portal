# The Reach — Performance plan (upload speed + thumbnail load)

status: INVESTIGATION COMPLETE. Plan only. NO code changed. Awaiting go-ahead.
updated-at: 2026-06-26
method: 4-agent read-only code swarm + live Supabase/Drive probes. Findings cite file:line.

---

## What you reported

1. "600mbps up and down, why is a 4GB upload taking 20+ min, now 30 min at 12%, still moving."
   Clarified: 4GB is **several video files in one batch**, not a single file. Each file is
   under the 500MB cap and uploads fine (two landed tonight: 8.18 MB + 146.99 MB). The batch
   is just slow.
2. "Ten80Ten SMM portal loads 300 thumbnails instantly on a new device. The Reach takes
   forever to load thumbnails. Why."

Both are real. Both have the same shape: **every byte is proxied through a Vercel
serverless function, one small piece at a time, with no CDN.** Your 600mbps line is barely
touched.

---

## Problem 1 — Upload speed

### The numbers
- 4GB batch, 12% in 30 min = ~480 MB in 1800s = **0.27 MB/s ≈ 2.1 Mbps effective**.
- Your link is 600 Mbps. You are using **~0.35% of it.**
- At this rate the full 4GB batch finishes in **~4 hours.**

### Why (root cause, cited)
Files in The Reach do not upload directly to storage. Storage is a Google **Shared Drive**,
and Google does not return CORS headers for service-account upload sessions, so the browser
**cannot** PUT to Google directly. Every byte is relayed through Vercel:

`browser → /api/drive/upload-chunk (Vercel) → Google Drive`, in **2MB pieces, one at a time.**

For a single 500MB file that is **250 sequential chunks**. Each chunk pays:
- a round-trip from your browser to Vercel, then Vercel to Google, and back (`drive-upload.ts:674` sequential `for` loop);
- a **Supabase auth-token refresh before every chunk** (`drive-upload.ts:639-652`) — this is a robustness fix I shipped so multi-hour uploads survive token expiry, but it adds a Supabase round-trip to all 250 chunks;
- a 5-step server check per chunk: bearer auth, rate-limit read, HMAC verify, range validate, then the Google PUT (`upload-chunk/route.ts:61-173`);
- **double bandwidth**: the 2MB is uploaded to Vercel, then Vercel uploads the same 2MB to Google. A 500MB file moves ~1GB through Vercel.

The bottleneck is **round-trip latency per chunk (~1-5s), not bandwidth.** A 2MB chunk on
600mbps transfers in ~27ms; the chunk spends the rest of its 1-5s waiting on round-trips.
That is why a faster line changes nothing. On a batch it is worse: files also upload with
limited concurrency, so the per-chunk tax stacks across every file.

The 500MB cap is enforced correctly at `upload/route.ts:89` (413 before any bytes move). A
true 4GB single file would be rejected instantly, not "stuck" — consistent with your
clarification that 4GB was the batch total.

### Fix options (weight assessed up front)

| # | Change | Effort | Risk | Win |
|---|--------|--------|------|-----|
| **U1** | Stop refreshing the auth token on every chunk. Refresh once per file, reuse, re-refresh only if near expiry. | S | Low | −250 Supabase round-trips/file, ~−2-4 min on a 500MB file |
| **U2** | Raise chunk size 2MB → 4MB (stays under Vercel's 4.5MB body cap). Re-derive the rate limit. | S | Low-Med | Halves chunk count 250→125, halves per-chunk overhead |
| **U3** | Upload several files in a batch concurrently (e.g. 3 at once) instead of one-after-another. | M | Med | Batch wall-clock cut ~3x. Safe (per-file sessions are independent) |
| **U4** | Validate file size in the picker so an over-cap file fails instantly with a clear message. | S | Low | UX only, no speed change |

**Net of U1+U2+U3: realistic 4-8x faster.** The ~4hr batch drops to roughly **30-45 min.**
Still proxy-bound, because every byte still goes through Vercel.

### The real fix (architectural) — U-ARCH
Bypass the Vercel proxy. Upload **direct from the browser to CDN-backed storage**, the way
the Ten80Ten SMM portal already works:
- **Supabase Storage with resumable/TUS uploads** — browser PUTs straight to Supabase (CDN
  in front), no Vercel hop, no double bandwidth, real parallelism. This is the same store
  that makes Ten80Ten's thumbnails instant, so it fixes both problems at once.
- or **Google Cloud Storage signed resumable URLs + CORS** — Drive's no-CORS limit is
  Drive-specific; GCS supports CORS and signed direct uploads. Keeps you on Google.

Either removes the proxy tax: **600mbps gets used, a 4GB batch finishes in ~1-2 min.**
Cost: migrate the 105 existing media files (or dual-write during a transition) and rewrite
the upload, serve, and delete paths. This is the durable answer; U1-U3 are the fast relief.

---

## Problem 2 — Thumbnails load slowly

### Why Ten80Ten is instant and The Reach is not
Ten80Ten serves thumbnails as static files from **Supabase Storage behind a CDN**: stable
URLs, edge-cached, the browser reuses them across visits and devices. The Reach serves every
thumbnail through a **Vercel serverless function that re-fetches from Google Drive on each
request**, with a per-request signed token that **defeats caching**.

### Root causes (cited)
1. **Per-request token breaks the cache.** Every thumbnail URL gets a fresh signed token
   (`?token=...`, 15-min TTL, `view-url/route.ts:85`). The response says
   `Cache-Control: private, max-age=86400, immutable` (`image-preview/route.ts:93`), but
   because the token changes every time, the browser sees a **new URL every load** and never
   reuses the cached bytes. The cache header is wasted.
2. **300 token-mint calls before images start.** Loading 300 items makes 300 separate
   `/api/media/view-url` POSTs (no batch endpoint), each doing auth + a Supabase query +
   signing = **15-30s of overhead** before thumbnails even render.
3. **2.5s Drive-thumbnail timeout → full-file fallback.** `DRIVE_THUMBNAIL_TIMEOUT_MS = 2500`
   (`image-preview/route.ts:51`). When Google's small pre-made thumbnail (~50-100KB) is slow,
   the code gives up and downloads the **full original (2-5MB)** and resizes it server-side
   with Sharp. An estimated ~30% of thumbnails hit this, multiplying transfer and CPU.
4. **No grid virtualization.** All 300+ cells mount at once, each rendering 2 `<img>` tags =
   ~600 DOM nodes and up to 600 requests (`media-page.tsx:787-844`). Only the first 36 are
   pre-warmed; the rest cold-load on scroll, each a from-scratch function call.
5. **No edge cache.** Responses are `private` per-user serverless invocations, so Vercel's
   edge never serves a repeat. Every thumbnail is a cold trip to Google.

### Fix options (weight assessed)

| # | Change | Effort | Risk | Win |
|---|--------|--------|------|-----|
| **T1** | Stable thumbnail URL: drop the per-request token. Either a 24h+ view token cached client-side, or a workspace-scoped signed cookie so `?token=` leaves the URL. | M | Med | The cache header finally works. Repeat loads near-instant. Biggest win |
| **T2** | Batch the token mint: `/api/media/view-url/batch` returns all visible items in 1-2 calls instead of 300. | S-M | Low | Removes the 15-30s signing wall |
| **T3** | Edge-cache the thumbnail response (`s-maxage`) so Vercel's edge serves repeats without re-hitting Drive. Needs T1. | M | Med | Cold loads on a new device served from edge |
| **T4** | Raise the Drive-thumbnail timeout to 6-8s, or fall back to `lh3.googleusercontent.com/d/{id}=s400` instead of the full original. | S | Low | Kills the ~30% full-file downloads. Quick win |
| **T5** | Generate thumbnails at upload time into Supabase Storage (CDN), serve the grid from there. Structural match to Ten80Ten. | L | Med | Grid becomes instant, like Ten80Ten |
| **T6** | Virtualize the grid (render only visible cells). | M | Low | ~600 requests → ~30-50, big DOM win, no backend change |

---

## Recommendation

**Two phases.**

**Phase A — quick relief, no migration, low risk (ship first):**
U1, U2, U4 (upload) + T4, T2, T6 (thumbnails).
Result: uploads 4-8x faster, thumbnails stop downloading full originals and stop waiting on
300 sign calls, grid stops mounting 600 nodes. Days of work, no data migration.

**Phase B — the durable fix (decide after A):**
U-ARCH + T5 + T1/T3: move media to CDN-backed direct storage (Supabase Storage or GCS), the
same model that makes Ten80Ten instant. This is the only thing that makes 600mbps real and a
300-item grid truly instant. Bigger lift, migrate 105 files, but it retires the proxy tax for
good.

T1+T3 alone (stable URL + edge cache) are worth doing even if you stay on Drive — they make
repeat thumbnail loads fast without a migration.

---

## Decision (locked 2026-06-26)

**Build both, phased. Phase A first, then Phase B.**
**Phase B storage target: Google Cloud Storage (GCS)** with signed resumable upload URLs +
CORS. Keeps the Google ecosystem, removes Drive's no-CORS limit, lets the browser PUT direct
to a bucket. Thumbnails served from GCS (public or signed) behind a CDN.

### Phase A — execution order (each slice: implement → unit tests → `npm run build` → commit → push to main)
1. **U1** — cache the Supabase auth token across chunks; refresh only near expiry. Lowest risk, big cut.
2. **U2** — chunk size 2MB → 4MB; re-derive the chunk rate limit to match.
3. **U3** — upload several files in a batch concurrently (target 3 at once). Directly attacks the batch slowness.
4. **U4** — pre-validate file size in the picker (instant, clear over-cap message).
5. **T4** — raise Drive-thumbnail timeout to 6-8s + fall back to `lh3.googleusercontent.com/d/{id}=s400` instead of the full original.
6. **T2** — batch the view-url token mint (`/api/media/view-url/batch`).
7. **T6** — virtualize the media grid (render only visible cells).

### Phase B — after A ships and the gain is confirmed
- GCS bucket + service-account signer; server mints **signed resumable upload URLs**; browser uploads direct (no Vercel relay).
- CORS config on the bucket; serve media + thumbnails from GCS behind a CDN (the T1/T3/T5 thumbnail goals collapse into this).
- Migrate the 105 existing Drive media files to GCS (or dual-read during transition). Keep upload/serve/delete invariants from Sessions 1-2.

### Guardrails carried in
- `npm run build` is the load-bearing gate before every push (Next.js route-export checks).
- Posts never disappear; every insert carries `workspace_id`; delete stays fail-closed + usage-guarded.
- Commit + push each verified slice straight to main, autonomously.
- No fake/test data left in the prod DB or app; tests use isolated temp users with teardown.

---

## Explicitly NOT touched in this investigation
No code changed. Read-only swarm + read-only live probes (105 media_assets, 4 posts, all real
content, confirmed). Upload/delete hardening from Sessions 1-2 stays as shipped.
