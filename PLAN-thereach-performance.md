# The Reach — Performance plan (upload speed + thumbnail load)

status: PLAN. Free-stack rewrite. Awaiting go-ahead on Phase B.
updated-at: 2026-06-27
supersedes: the 2026-06-26 "Phase B = Google Cloud Storage" decision, which is CANCELLED.
method: 4-agent read-only code swarm + live Supabase/Drive probes, re-verified 2026-06-27 against the actual route code. Findings cite file:line.

---

## Locked constraint (2026-06-27)

**Stay free. No new bill.**

- No Google Cloud Storage. GCS means a new bucket, a GCP billing account, and per-view egress charges. Declined.
- No premium Supabase. We stay on the **Supabase free tier**.
- Media bytes stay on the **60TB Google Drive Team account we already pay for.**
- Supabase free tier is used the way it is free to use it: tiny metadata rows, small thumbnails, and a size-capped hot-video cache. Never as the store of record for full originals.
- Inside that budget, push efficiency as hard as it goes. Most of the speed wins below cost nothing and need no migration.

This replaces the previous plan's Phase B. Everything else in the analysis still holds.

---

## The free budget (the numbers this plan must live inside)

Supabase free tier, confirmed 2026-06-27:

| Resource | Free limit | What uses it here |
|---|---|---|
| Postgres database | 500 MB | `media_assets` and all app rows |
| File Storage (all buckets share this) | 1 GB | `media-playback`, `media-thumbnails`, `avatars`, `support-attachments` |
| Egress / bandwidth | 5 GB / month | every byte Supabase serves to a browser |
| Project pause | after 7 days idle | already covered by the keep-alive |

Commercial use is allowed on the free tier, so this is a legitimate place to run.

### Where the budget actually goes

- **Metadata (Postgres):** a `media_assets` row is ~1 KB. 100,000 rows is ~100 MB. Not a concern.
- **Thumbnails (`media-thumbnails`):** a 520px thumb plus a 1600px preview is roughly 50-200 KB per item. 300 items is ~45 MB. 2,000 items is ~300 MB. Cheap. This is the lever that makes the grid instant, and it is nearly free.
- **Video playback copies (`media-playback`):** capped at **50 MB per video** (`src/lib/media-playback-policy.ts:6`). This is the one real threat. At 50 MB each, 1 GB holds only ~20 clips. At a more typical ~20 MB, ~50 clips. For an SMM portal that produces video constantly, this bucket will hit the 1 GB wall and then start eating into the thumbnail budget too, because they share the same 1 GB.
- **Egress:** serving one 20 MB playback clip ~250 times hits the 5 GB monthly cap. A 100 KB thumbnail served from cache barely registers.

**Conclusion:** thumbnails and metadata are free with huge headroom. The video playback cache is the only thing that can break "free," so it gets a hard cap and an eviction rule. Full-size video keeps streaming from Drive, where egress is free.

---

## Problem 1 — Upload speed

### The numbers (as reported)
- 4GB batch (several files, each under the 500MB cap), 12% in 30 min = ~480 MB in 1800s = **0.27 MB/s ≈ 2.1 Mbps effective**.
- The link is 600 Mbps. About **0.35% of it** is used.
- At that rate the full batch takes ~4 hours.

### Why (root cause, cited)
Storage of record is a Google **Shared Drive**, and Google returns no CORS headers for service-account upload sessions, so the browser **cannot** PUT to Google directly. Every byte relays through Vercel:

`browser -> /api/drive/upload-chunk (Vercel) -> Google Drive`, in fixed-size pieces, sequentially.

For a 500MB file that is a long chain of chunks. Each chunk pays a browser-to-Vercel-to-Google round trip (`drive-upload.ts` sequential loop), a per-chunk server check (bearer auth, rate-limit read, HMAC verify, range validate, then the Google PUT in `upload-chunk/route.ts`), and double bandwidth (the chunk is uploaded to Vercel, then Vercel uploads the same bytes to Google). The bottleneck is round-trip latency per chunk, not bandwidth, which is why a faster line changes nothing.

### Fix options (weight assessed up front)

| # | Change | Effort | Risk | Win | State |
|---|--------|--------|------|-----|-------|
| **U1** | Stop refreshing the auth token on every chunk. Refresh once per file, reuse, re-refresh only near expiry. | S | Low | Removes one Supabase round trip per chunk | **SHIPPED** (commit 44fe5f0) |
| **U2** | Raise chunk size 2MB -> 4MB (under Vercel's 4.5MB body cap). Re-derive the chunk rate limit. | S | Low-Med | Halves chunk count and per-chunk overhead | **SHIPPED** (commit 44fe5f0) |
| **U3** | Upload several files in a batch concurrently (target 3 at once) instead of one after another. | M | Med | Cuts batch wall-clock ~3x. Per-file sessions are independent | **PENDING** |
| **U4** | Pre-validate file size in the picker so an over-cap file fails instantly with a clear message. | S | Low | UX, no speed change | **PENDING** |

**Net of U1+U2 (shipped) plus U3+U4: realistically 4-8x faster.** A ~4hr batch drops to roughly **30-45 min.** That is the honest free ceiling for large originals.

### Why we cannot get to "1-2 minutes" for free
Truly using the 600 Mbps line means the browser PUTs directly to a CORS-capable bucket, with no Vercel hop. The only CORS-capable targets are GCS (a paid bill) or putting full originals in Supabase Storage (which blows the 1 GB cap on the first few files). Both are off the table. So large originals stay proxy-bound through Vercel to Drive. Phase A is the relief; the proxy ceiling is the price of free. Small media is a different story (see below) and is already fast.

---

## Problem 2 — Thumbnails load slowly

### Why a comparable portal is instant and The Reach is not
The fast portal serves thumbnails as static files behind a CDN: stable URLs, edge-cached, reused across visits and devices. The Reach serves each thumbnail through a Vercel function with a **per-request signed token that defeats caching.**

### Root causes (cited)
1. **Per-request token breaks the cache.** Every thumbnail URL gets a fresh signed token (15-min TTL). The response sets `Cache-Control: ... max-age=86400, immutable` (`image-preview/route.ts:93`), but because the token changes each load the browser sees a new URL every time and never reuses the bytes. The cache header is wasted.
2. **Hundreds of token-mint calls before images render.** Loading 300 items makes 300 separate `/api/media/view-url` POSTs (no batch endpoint), each doing auth plus a query plus signing.
3. **Full-file fallback on slow Drive thumbnails.** When Google's small pre-made thumbnail is slow, the code can fall back to downloading the full original and resizing server-side. Already softened by the `thumbnailLink` fast path and a 3s lookup budget in `image-preview/route.ts`, but the per-request-token cache miss is what keeps cold loads slow.
4. **No grid virtualization.** All 300+ cells mount at once (`media-page.tsx`), each rendering two `<img>` tags, so ~600 DOM nodes and up to ~600 requests.
5. **No edge cache.** Responses are `private` per-user invocations, so Vercel's edge never serves a repeat. Every thumbnail is a cold trip.

### Already in place (verified 2026-06-27)
- Thumbnails generated at request time and **cached to `media-thumbnails`** in Supabase Storage (`image-preview/route.ts:152`).
- **Drive `thumbnailLink` fast path** with a 3s lookup budget and in-flight de-dup (`image-preview/route.ts:559-580`).
- Sized previews (thumb 520px, full 1600px) and HEIC handling with pixel-safety caps.

So thumbnail **storage and generation are done and free-safe.** The remaining work is all on the **serving** path, and all of it is free.

### Fix options (weight assessed)

| # | Change | Effort | Risk | Win | State |
|---|--------|--------|------|-----|-------|
| **T1** | Stable thumbnail URL: drop the per-request token. Use a long-lived view token cached client-side, or a workspace-scoped signed cookie, so `?token=` leaves the URL. | M | Med | The cache header finally works. Repeat loads near-instant. Biggest win | PENDING |
| **T2** | Batch the token mint: `/api/media/view-url/batch` returns all visible items in 1-2 calls instead of hundreds. | S-M | Low | Removes the sign-call wall before images render | PENDING |
| **T3** | Edge-cache the thumbnail response (`s-maxage`) so Vercel's edge serves repeats without re-hitting Drive or Supabase. Needs T1. | M | Med | Cold loads on a new device served from edge. Also protects the 5GB egress | PENDING |
| **T4** | Confirm the `lh3.googleusercontent.com/d/{id}=s400` / `thumbnailLink` path is preferred over any full-file fallback. | S | Low | Kills residual full-file downloads | LARGELY DONE, verify |
| **T6** | Virtualize the grid (render only visible cells). | M | Low | ~600 requests down to ~40, big DOM win, no backend change | PENDING |

T1 + T3 are the heart of "instant grid for free": a stable URL plus an edge cache turns repeat and new-device loads into edge hits, with no migration and no new storage.

---

## The free architecture (target)

One hybrid, all on the existing paid Drive plus the Supabase free tier.

| Layer | Lives in | Why it stays free |
|---|---|---|
| Full originals (images + all video) | **Google Drive** (`media-library`, `raw-files`) | 60TB already paid. Drive egress is free |
| Metadata (`media_assets`) | **Supabase Postgres (free)** | ~1 KB/row, far under 500 MB |
| Thumbnails + previews | **Supabase Storage `media-thumbnails` (free)** | ~50-200 KB/item, far under 1 GB, served edge-cached |
| Hot small-video playback (<=50MB) | **Supabase Storage `media-playback` (free, capped)** | bounded under a hard size budget with eviction (see below) |
| Large-video playback (>50MB) | **Google Drive stream** (`/api/drive/stream`, 206 range) | already built, Drive egress is free |
| Uploads of originals | **browser -> Vercel proxy -> Drive** | no CORS-capable free bucket exists for full files; Phase A is the ceiling |

Net: Drive holds the bytes, Supabase free holds the small fast-serving layer, and no full original ever lands in a metered store.

---

## The one real free-tier risk: `media-playback`

Today every video at or under 50 MB gets a **second copy** in Supabase `media-playback`, on top of its Drive original, for smooth in-app scrubbing. Callers: `create-post-modal.tsx`, `repurpose-modal.tsx`, `media-picker.tsx`, `asset-review-drawer.tsx`. Nothing bounds the total size, so this bucket will grow until it exhausts the shared 1 GB.

**Required: bound it. Recommended approach (free, keeps the fast-playback win):**

- Give `media-playback` a hard total-size budget, e.g. **700 MB**, leaving ~300 MB headroom for thumbnails, avatars, and attachments inside the 1 GB pool.
- Evict **least-recently-played** copies when the budget is hit (track last-played, drop the oldest).
- An evicted clip falls back to streaming from Drive via `/api/drive/stream`. The only cost is a slightly slower first play for a cold clip. No broken UX, no data loss (the original is always on Drive).
- Keep serving thumbnails with long browser cache plus edge cache (T1/T3) so thumbnail egress stays near zero and the 5 GB monthly egress is reserved for actual video plays.

**Cheaper alternative if even that feels heavy:** retire `media-playback` entirely and stream all video from Drive. Simplest for storage and egress, but every play becomes a cold Drive proxy stream, which scrubs slower. The capped-cache keeps hot clips fast and still stays free, so it is the recommended one.

---

## Phase plan (free)

### Phase A — speed relief, no migration (ship/finish first)
1. **U1** — shipped.
2. **U2** — shipped.
3. **U3** — upload up to 3 files in a batch concurrently.
4. **U4** — pre-validate file size in the picker.
5. **T2** — batch the view-url token mint.
6. **T6** — virtualize the media grid.
7. **T4** — confirm thumbnail-link path beats any full-file fallback.

Result: large uploads at the free ceiling (~30-45 min for a 4GB batch), grid stops minting hundreds of tokens and stops mounting ~600 nodes.

### Phase B — instant grid for free (the durable win, replaces the GCS migration)
8. **T1** — stable thumbnail URL (kill the per-request token).
9. **T3** — edge-cache the thumbnail response (`s-maxage`), needs T1.
10. **Cap `media-playback`** at a 700 MB budget with least-recently-played eviction and Drive-stream fallback.

Result: repeat and new-device thumbnail loads served from the edge, the grid feels instant like the comparison portal, and Supabase storage and egress stay safely inside the free tier forever. No migration, no new bill.

Each slice: implement -> unit tests -> `npm run build` (the load-bearing gate, Next.js route-export checks) -> commit -> push to main.

---

## Guardrails carried in
- `npm run build` is the gate before every push.
- Posts never disappear; every insert carries `workspace_id`; delete stays fail-closed and usage-guarded.
- No full original is ever written to a metered store. Drive is the store of record.
- Supabase free tier stays inside 500 MB DB, 1 GB Storage, 5 GB egress. The `media-playback` cap is what enforces the Storage line.
- No fake/test data in the prod DB or app; tests use isolated temp users with teardown.
- Commit and push each verified slice straight to main.

---

## What changed from the prior plan
- **Cancelled:** Phase B = Google Cloud Storage migration, bucket, CORS, signed direct upload, and moving the 105 Drive files to a bucket. All of it carried a new bill.
- **Replaced with:** stay on Drive plus Supabase free tier, make the grid instant with stable URLs and an edge cache (free), and cap the one bucket that can overrun the free Storage limit.
- **Kept:** the full upload and thumbnail root-cause analysis, the Phase A speedups (U1/U2 already shipped), and all Session 1-2 upload/delete hardening.

## Explicitly NOT touched
No code changed by this rewrite. Read-only swarm plus read-only live probes. Upload/delete hardening from earlier sessions stays as shipped.
