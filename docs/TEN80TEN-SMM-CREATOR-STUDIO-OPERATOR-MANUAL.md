# Ten80Ten SMM — Creator Studio Operator Manual (AI Generation + Auto-Revise)

**Version:** v1.0 — shipped 2026-05-13
**App:** Ten80Ten Content Engine at `smm.ten80ten.com`
**Feature surface:** sidebar → **Creator Studio** (Sparkles icon)
**Image model:** `gpt-image-2` (snapshot `gpt-image-2-2026-04-21`)
**Text model:** `gpt-4o-mini`
**Daily spend cap:** $10 per workspace
**Repo paths:** `src/components/pages/studio-page.tsx`, `src/lib/ai/`, `src/app/api/ai/`
**Audience:** Aldridge, Will, Christer, Hanes (superadmins) and creative directors / social media specialists

Creator Studio is a spreadsheet-style page that lets you plan a week of social posts as rows, click **Generate** on each row, and have the AI produce the copy and the visuals (single image, carousel, story, or storyboard). The drafts always land in **Awaiting Approval** for a human to review — the AI never auto-approves, schedules, publishes, or deletes anything.

If you drag an AI-generated card to **Revision Needed** and write reviewer notes, the system auto-rewrites the draft within ~30 seconds without you clicking anything else.

---

## 1. One-time setup (do this before the first generation)

### 1.1 Vercel environment variables

Go to `vercel.com → ten80ten-smm-portal → Settings → Environment Variables` and add three values, **Production scope only**:

| Name | Value | How to generate |
|---|---|---|
| `OPENAI_API_KEY` | `sk-...` | From `platform.openai.com → API keys → Create new` |
| `SUPABASE_WEBHOOK_SECRET` | random 32-byte hex | `openssl rand -hex 32` |
| `CRON_SECRET` | random 32-byte hex | `openssl rand -hex 32` |

The following have working defaults baked into the code — **only add them if you want to override**:

| Name | Default | What it does |
|---|---|---|
| `OPENAI_TEXT_MODEL` | `gpt-4o-mini` | The model that writes captions, hooks, CTAs, hashtags. |
| `OPENAI_IMAGE_MODEL` | `gpt-image-2` | The model that renders the images. |
| `OPENAI_VERIFIER_MODEL` | `gpt-4o-mini` | The cheap second model that scans the caption for hallucinated facts. |
| `OPENAI_PROMPT_VERSION` | `2026-05-13.v1` | Stamped onto every post for forensic drift detection. Bump when you change the system prompt. |
| `OPENAI_DAILY_CAP_USD` | `10` | Hard daily spend cap per workspace. |
| `OPENAI_PRICE_IMAGE` | `0.50` | Per-image cost estimate for the cap calculator. Bias high. |
| `AI_WORKER_TRIGGER_SECRET` | `CRON_SECRET` value | Same value as CRON_SECRET unless you want them to differ. |
| `OPENAI_VIDEO_ENABLED` | `false` | Off until full video rendering is GA-priced and budget-approved. |

After adding these, redeploy (`git push` or the **Redeploy** button in Vercel).

### 1.2 Supabase Database Webhook (this is what makes auto-revise work)

Go to `supabase.com → project lczmgquuzuqhalasjnip → Database → Webhooks → Create a new hook`.

| Field | Value |
|---|---|
| Name | `auto-revise-ai-posts` |
| Table | `public.posts` |
| Events | `Update` (uncheck Insert/Delete) |
| Type | `HTTP Request` |
| Method | `POST` |
| URL | `https://smm.ten80ten.com/api/ai/auto-revise/webhook` |
| HTTP Headers | Name: `Authorization`, Value: `Bearer <paste the same SUPABASE_WEBHOOK_SECRET hex you set in Vercel>` |
| HTTP Params | (none) |
| Timeout | `5000` ms |

Save. You can test by clicking **Send test event** — you should get a 204 No Content back (because the test payload doesn't satisfy the auto-revise filter, which is correct behavior).

### 1.3 Confirm the storage bucket is up

`supabase.com → Storage → Buckets`. You should see **ai-assets** with the lock icon (private, 10 MB cap, PNG/JPG/WEBP only). This was created when the migrations were applied — if it's missing for any reason, re-run the bucket-creation block in `docs/CREATOR-STUDIO-GUIDE.md` (this file's appendix A).

That's the entire setup. Total time: ~5 minutes.

---

## 2. The Studio UI, column by column

When you open Creator Studio, you see a table that defaults to 14 rows (the next two weeks). Every keystroke autosaves after 600 ms — you can close the tab and your row state persists.

### 2.1 Top bar

- **Spend chip** (top-right): live `$X.XX / $10.00 today`. Green up to 60%, amber 60–90%, red above 90%. The bill counter is the sum of `ai_generation_jobs.cost_usd` rows in the last 24 hours, scoped to your workspace.
- **Add Row** button: appends a new blank row to the bottom.
- **Bulk Generate Ready** button: kicks off every row with status `Ready`. Worker processes them serially.

### 2.2 Columns (left to right)

| # | Column | What goes here | Notes |
|---|---|---|---|
| 1 | `#` | Row number | Read-only. |
| 2 | `Date` | YYYY-MM-DD | Defaults to a sliding window starting today. |
| 3 | `Time` | HH:MM | Optional. If you set this, the resulting post inherits it as the suggested schedule (still requires manual approval before it actually publishes). |
| 4 | `Platforms` | Click chips to toggle | Instagram / LinkedIn / Facebook / TikTok / YouTube / Multi-platform. Multi-platform expands to Instagram + LinkedIn + Facebook on the produced post. |
| 5 | `Media` | Image or Video (Portrait) | Drives which formats and which aspect ratios are available. |
| 6 | `Format` | Single / Carousel / Story (Image) or Reel / Storyboard (Video) | Carousels are 2–10 slides. Stories are 9:16. Reels produce 4 keyframes + a shot list (not a rendered video — see §6 on video). |
| 7 | `Slides` | Number (only when Format=Carousel) | Default 5. |
| 8 | `Aspect` | Read-only chip | Auto-derived from Media + Format + Platforms. See §4 aspect ratio cheat sheet. |
| 9 | `Feel` | Editorial mood | Educational, Story, Founder POV, Before/After, Contrarian, Hype, Behind-the-Scenes, Testimonial-Style, Announcement, How-To. |
| 10 | `Visual Style` | Visual treatment | Photography (Realistic), Illustration (Flat), Infographic, Screenshot Mockup, 3D Render, Mixed Media, Editorial Photo, Studio Photo. |
| 11 | `Style Prompt` | Free text (≤500 chars) | Your styling steer. Examples below in §3.2. |
| 12 | `Topic` | Free text (≤280 chars) | What the post is *about*. |
| 13 | `Notes` | Free text (≤500 chars) | Constraints, CTA hint, mention links to drop in, audience pointers. |
| 14 | `Status` | Read-only chip | Empty / Ready / Generating / Generated / Failed / Revising. |
| 15 | `Card` | Read-only link | Appears as **Open** once the post is created. Clicks deep-link into Awaiting Approval. |
| 16 | `Action` | Generate / Cancel button | Disabled until the minimum required fields are filled. |

### 2.3 The minimum required fields to enable Generate

The Generate button stays disabled until the row has all of: **Date**, at least one **Platform**, **Media Type**, **Format**, **Feel**, and **Visual Style**. That's the same gate the server enforces — if you tamper with the front-end, the API returns 400.

### 2.4 Lock states

Once a row enters `Generating` or `Revising`, the columns become read-only until the job ends. Once a row reaches `Generated`, it's permanently locked (re-editing it wouldn't affect the produced post — to make a new version, copy the row content into a fresh row).

---

## 3. The end-to-end flow

### 3.1 Plan → Generate → Review → Approve

**1. Plan.** Fill a row. The aspect chip in column 8 updates live as you change Media + Format + Platforms.

**2. Generate.** Click the button on the right edge. Two things happen on the server:
   - A row goes into `ai_generation_jobs` with `status='queued'`.
   - The route fires a `POST /api/ai/auto-revise/process` to wake the worker immediately. No waiting for cron.

The Studio UI starts polling `GET /api/ai/jobs/{id}` every 3 seconds.

**3. Worker pipeline** (runs server-side; you see the result, not the steps):
   1. Re-resolves the aspect ratio from your row inputs (server is the source of truth; the client's chip is informational only).
   2. Enforces the $10 daily cap — sums the last 24 hours of `cost_usd` for your workspace. If you're at or above, returns 429.
   3. Loads the `brand_playbook` row (singleton). Loads the 10 most recent posts in the workspace so the AI can avoid repeating angles you already used.
   4. Calls `gpt-4o-mini` with the brand-aware system prompt + a strict JSON schema. Output: title, hook, caption, CTA, hashtags, per-slide scene outline, visual brief, approval notes, self-quality score 1–10.
   5. Runs the **hallucination gate** (see §5).
   6. If the gate fails, regenerates *once* with the violations appended to the prompt. If the second attempt also fails, the job ends with `status='failed'` and the violation list goes to `Last Error`.
   7. Calls `gpt-image-2` once per slide at source size 1024×1536, high quality.
   8. Runs the images through `sharp`: center-crops to the resolved aspect (e.g. 4:5 → 1080×1350) and rejects if final dimensions are off by more than ±2 px.
   9. Uploads each image to `ai-assets/{workspace_id}/{post_id}/slide-{n}.png`. Signs 7-day URLs.
   10. Inserts a row into `posts` with `stage = 'awaiting_approval'` hardcoded — iron law, never trusts the model.
   11. Re-keys the storage objects from the provisional uuid to the real `post.id` so the bucket layout is canonical.
   12. Writes an audit event via `record_audit_event` with model name, prompt version, tokens, image count, cost, latency.

**4. Realtime echo** lands in your open kanban tab within 1–2 seconds via the existing `posts` channel. The new card appears in Awaiting Approval with the AI badge.

**5. Review.** Click the **Open** link in the Studio row (or just go to Content Engine). The asset review drawer shows:
   - The actual generated images in their correct aspect ratio (carousel/storyboard renders as a horizontal strip).
   - A purple **AI** panel section: quality score, model id, AI's own approval note, visual brief, hashtags, CTA, deep link back to the source plan row.
   - Everything else looks identical to a manual post.

**6. Approve.** Drag the card to **Approved/Scheduled** like any other post. Stage transitions remain human-only.

### 3.2 Useful Style Prompt examples

These all go in column 11. Be specific — the model fills the rest from the brand kit.

```
clean white background, single orange accent (#FF6A00), bold sans-serif type, no people, infographic feel
```

```
warm-lit office at golden hour, founder mid-sentence, candid documentary feel, no stock-photo vibe
```

```
flat illustration on a navy background, mustard accents, single line-art icon per slide, no shadows
```

```
editorial photograph, shallow depth of field, paper textures, soft natural light, neutral palette
```

### 3.3 Useful Topic + Notes pairings

| Topic | Notes |
|---|---|
| `5 signs your business needs automation` | `End with CTA to book a discovery call. Tone: punchy, no-fluff.` |
| `Why we replaced our Slack workflow with one VA` | `First-person founder POV. Reference our automation playbook link.` |
| `What "delegate the chore" actually means in practice` | `Concrete examples. No motivational quotes.` |

### 3.4 The drag-to-revise loop

Most powerful feature. Workflow:

**1.** You open an AI card, decide slide 3 is too text-heavy and the hook is weak.
**2.** Drag the card to **Revision Needed** (or click the kickback button).
**3.** Type a reviewer note: `Slide 3 has too much copy, simplify to one line. Hook is generic — make it punchier, lead with a specific operator pain.`
**4.** Save.

What happens behind the scenes:
- The Supabase Database Webhook fires on the `posts UPDATE`.
- Our handler validates the `Authorization: Bearer <secret>` header, then checks the filter: `old.stage != 'revision_needed'`, `new.stage == 'revision_needed'`, `generated_by_model IS NOT NULL`, `notes.length >= 10`. All four must pass — non-AI cards return 204 and nothing happens.
- A `kind='revise'` job is enqueued and the worker is woken via `x-trigger-secret`.
- Worker pipeline runs again, this time loading the original draft as context and treating reviewer notes as the steering input.
- New images are uploaded, the row is updated in place, `revision_count` is incremented, stage is set back to `awaiting_approval`.
- Realtime echo: ~30 seconds after your save, the card moves itself back to Awaiting Approval with the new content. A small `v2`, `v3` counter shows revision history.

If the revision fails: toast `AI revision failed: <reason>`. Card stays in Revision Needed. Click Save again to retry, or edit manually.

---

## 4. Aspect ratio cheat sheet

Decided entirely by the deterministic resolver — not a creative AI choice. You can't override it from the UI.

| Media | Format | Platforms | Resolved aspect | Pixel size |
|---|---|---|---|---|
| Image | Single | Instagram only | 4:5 | 1080×1350 |
| Image | Single | LinkedIn only | 4:5 | 1080×1350 |
| Image | Single | Facebook only | 4:5 | 1080×1350 |
| Image | Single | TikTok only | 9:16 | 1080×1920 |
| Image | Single | YouTube only | 9:16 | 1080×1920 |
| Image | Single | Multi-platform OR ≥2 mixed | 4:5 | 1080×1350 |
| Image | Carousel | any | 4:5 | 1080×1350 (per slide) |
| Image | Story | any | 9:16 | 1080×1920 |
| Video | Reel | any | 9:16 | 1080×1920 (keyframes) |
| Video | Storyboard | any | 9:16 | 1080×1920 (keyframes) |

If you want 9:16 for a single image, set Platforms to TikTok-only (or YouTube-only) and Media+Format to Image+Single.

---

## 5. The hallucination gate — what gets blocked

The AI will not slip past these. If it tries, the job regenerates once; if the second attempt also fails, the job ends with `Failed` status and the violation in `Last Error`.

### 5.1 Regex sweep — automatic kills

The following patterns in the generated caption fail the gate **unless your input row literally contained that exact phrase**:

- Any percentage: `73%`, `45.5 %`, etc.
- Any dollar amount: `$10K`, `$1,200`, `$5M`, etc.
- Phrases: `studies show`, `research proves`, `research shows`, `research finds`, `data shows`, `experts agree`, `according to (a/the) study/report/survey`, `X out of Y` (e.g. `3 out of 5`).
- Year strings that are not the current year ±1, unless the input contained that year.

### 5.2 Trusted-corpus cross-reference

The gate builds a corpus from: your row's topic + notes + style prompt + feel + visual style + platforms, plus the brand_playbook's tagline / voice / website / phone / hooks / CTAs / content pillars / focus list / avoid list. Anything "specific" in the caption that does not appear in the corpus gets flagged.

### 5.3 Second-LLM verifier

If the regex sweep is clean, a cheap pass through `gpt-4o-mini` asks: *"list any specific claims here that are not in the input corpus."* If it returns a non-empty list, the gate fails.

### 5.4 What gets through

Generic statements about ideas. Founder opinions. Concrete callouts to things your operator input mentioned. The brand_playbook's own hashtags, hooks, CTAs.

### 5.5 What you can do

If the gate is firing on legitimate facts (e.g. you really do have a $10K MRR client and want to mention it), put the fact in the **Notes** column of the plan row. The gate sees it in the corpus and lets it through.

---

## 6. Video handling

Right now Media=Video produces a **storyboard**, not a rendered video:
- 4 portrait keyframes (9:16, 1080×1920)
- A per-scene shot list (camera angle, motion hint, on-screen text, voiceover line) stored in `posts.carousel_outline` JSON
- The same caption + hook + hashtags as any other post
- Clearly marked **"Video Storyboard — not Reel ready to post"** in the drawer

Mariz or Ron produces the actual MP4 from the storyboard.

Full video rendering is behind `OPENAI_VIDEO_ENABLED=true`. Leave it off until OpenAI's video model is GA-priced and you've decided on a per-render cost cap.

---

## 7. Cost & rate limits

| Limit | Value | Where it lives |
|---|---|---|
| Daily workspace spend | $10 | `enforceDailyCap` in `src/lib/ai/cost.ts` |
| Per-user generations | 30 per hour | `consume("ai-generate:{workspaceId}", "user:{userId}|ip:{ip}", 30, 3600)` |
| Per-call image price (estimate) | $0.50 | `OPENAI_PRICE_IMAGE` env var, override at any time |
| Job status polling | 3 s | `studio-page.tsx` polling interval |
| Stuck-job reclaim | 5 min | `auto-revise/process/route.ts` |
| Asset URL expiry | 7 days | `src/lib/ai/upload.ts` |

### Cost math at current defaults

- 1 single image (1 slide): ~$0.50
- 1 carousel (5 slides): ~$2.50
- 1 storyboard (4 keyframes): ~$2.00
- 1 caption-only re-roll (unlikely): ~$0.005

$10 cap = ~20 single images, OR 4 carousels, OR 5 storyboards. Tune `OPENAI_DAILY_CAP_USD` and `OPENAI_PRICE_IMAGE` in Vercel to match your real OpenAI bill.

### How the cap fires

`enforceDailyCap(workspaceId)` runs:
1. At the start of `POST /api/ai/studio/generate-row/:id`
2. At the start of `POST /api/ai/studio/generate-batch`
3. Inside `runGenerateJob` and `runReviseJob` right after the job is claimed

If today's spend ≥ cap, the API returns 429 with the message `Daily AI spend cap reached: $X.XX / $10.00`. The worker-side check covers webhook-triggered revises that bypass the API rate-limit.

---

## 8. Permissions

| Role | Studio link visible? | Can generate? |
|---|---|---|
| `superadmin` | ✓ | ✓ |
| `admin` | ✓ | ✓ |
| `owner` | ✓ | ✓ |
| `creative_director` | ✓ | ✓ |
| `social_media_specialist` | ✓ | ✓ |
| `approver` | ✗ | ✗ (manual review only) |
| `editor` | ✗ | ✗ |
| `viewer` | ✗ | ✗ |

The sidebar link hides for non-writer roles. If anyone navigates manually to the page, they see *"Studio is restricted"* and the API returns 403.

---

## 9. Troubleshooting

### "Fill in the Brand Kit before generating AI drafts."
Open **Brand Kit** from the sidebar. Fill at minimum: tagline, brand voice, content pillars, hashtag core, hooks (3–5), CTAs (3–5). Save. The placeholder detector trips on `Sample hook 1` / `Define your brand voice` / the literal word `placeholder`, so as long as you've replaced those, the gate passes.

### Studio row is stuck on "Generating…" for >5 minutes
The cron worker reclaims jobs that have been `running` for more than 5 minutes (the worker probably crashed mid-flight). Wait one cron cycle (≤60 s) and the job will retry automatically. If it still doesn't resolve, hit Cancel on the row — that flips the plan row back to `Ready` and you can re-Generate.

### Job ends with `hallucination_gate_failed: ...`
Read the violation list in `Last Error`. Common causes:
- You put a specific stat or dollar amount in the **Topic** but didn't repeat it in **Notes**. Add it to Notes too — the gate searches both.
- The model invented a customer name. Tighten the **Style Prompt** with `do not name specific customers`.
- The model hallucinated a year. Pin the year in your inputs.

### Daily cap hit before noon
- Bump `OPENAI_DAILY_CAP_USD` in Vercel env vars (production scope) and redeploy.
- Or reduce slides per carousel — the image bill scales linearly.
- Or wait until tomorrow — the rolling 24h sum decays naturally.

### Auto-revise didn't fire when I dragged a card to Revision Needed
Two things to check:
1. Is `SUPABASE_WEBHOOK_SECRET` set in Vercel env (Production) AND in the Supabase Database Webhook header? They must match byte-for-byte.
2. Was the card actually AI-generated? Auto-revise only fires when `posts.generated_by_model IS NOT NULL`. Manual posts in revision_needed run the normal kickback flow.
3. Did your reviewer notes have at least 10 characters? Shorter notes are ignored as accidental drag.

### "Studio is restricted" page when I know I'm an admin
Check `team_members.role` in Supabase. If you were imported under a different role name (`super_admin` vs `superadmin`), the role gate doesn't match. Fix the row in Supabase Dashboard and re-login.

### The generated image is the wrong aspect ratio
Send a screenshot to whoever owns this codebase. The resolver should never produce a wrong aspect — if it does, it's a bug worth filing, not an operator error. The server re-resolves on every request, so it's not a tampered-client issue.

---

## 10. Architecture pointer (for engineers / future-Claude debugging)

| Layer | File | What it does |
|---|---|---|
| DB | `supabase/migrations/0021_studio_posts_fields.sql` | Adds 11 AI columns to `posts`. |
| DB | `supabase/migrations/0022_content_plan_rows.sql` | Studio sheet state table. |
| DB | `supabase/migrations/0023_ai_generation_jobs.sql` | Durable job queue. |
| Storage | `ai-assets` bucket | Private, 10 MB, PNG/JPG/WEBP. Path: `{workspace_id}/{post_id}/slide-{n}.{ext}`. |
| Server | `src/lib/ai/types.ts` | Shared types + `AI_WRITER_ROLES`. |
| Server | `src/lib/ai/aspect-resolver.ts` | Pure deterministic resolver. Unit-tested. |
| Server | `src/lib/ai/openai-text.ts` | Fetch wrapper for chat/completions with strict JSON schema. |
| Server | `src/lib/ai/openai-image.ts` | Fetch wrapper for /v1/images/generations. |
| Server | `src/lib/ai/image-postprocess.ts` | Sharp-based crop/resize with ±2 px tolerance. |
| Server | `src/lib/ai/prompt-builder.ts` | Brand-aware system + user prompts. PROMPT_VERSION constant. |
| Server | `src/lib/ai/hallucination-gate.ts` | 3-stage check. |
| Server | `src/lib/ai/persist.ts` | Builds posts row with `stage='awaiting_approval'` hardcoded. |
| Server | `src/lib/ai/upload.ts` | Signs 7-day URLs to `ai-assets`. |
| Server | `src/lib/ai/cost.ts` | Daily cap enforcement + cost computation. |
| Server | `src/lib/ai/worker.ts` | End-to-end `runGenerateJob` + `runReviseJob`. |
| Server | `src/lib/ai/auth-helpers.ts` | `requireStudioWriter` — auth + workspace resolution. |
| API | `src/app/api/ai/studio/rows/route.ts` | GET (list) + POST (create). |
| API | `src/app/api/ai/studio/rows/[id]/route.ts` | PATCH + DELETE. |
| API | `src/app/api/ai/studio/generate-row/[id]/route.ts` | Enqueue one job, wake worker. |
| API | `src/app/api/ai/studio/generate-batch/route.ts` | Enqueue many jobs. |
| API | `src/app/api/ai/studio/cancel-job/[id]/route.ts` | Cancel queued (not running). |
| API | `src/app/api/ai/jobs/[id]/route.ts` | Poll status. |
| API | `src/app/api/ai/auto-revise/webhook/route.ts` | Supabase DB webhook target. |
| API | `src/app/api/ai/auto-revise/process/route.ts` | Worker cron / on-demand trigger. |
| UI | `src/components/pages/studio-page.tsx` | The sheet. |
| UI | `src/components/content-card.tsx` | AI badge + aspect chip on kanban cards. |
| UI | `src/components/asset-review-drawer.tsx` | AI review panel + multi-slide viewer. |
| UI | `src/components/app-shell.tsx` | Role-gated nav link. |

The whole feature respects the iron laws in `AGENTS.md` — read that file before changing any of these.

---

## 11. A full worked example

Let's plan and ship one post end to end.

**Goal:** A LinkedIn carousel about "Why founders should automate hiring intake."

**Step 1 — Open Creator Studio.** Sidebar → Sparkles icon.

**Step 2 — Fill row 1:**
- Date: `2026-05-15`
- Time: `09:00`
- Platforms: click `LinkedIn` chip on
- Media: `Image`
- Format: `Carousel`
- Slides: `5`
- Aspect chip auto-updates to `4:5 · 1080×1350`
- Feel: `Educational`
- Visual Style: `Infographic`
- Style Prompt: `clean white background, single orange accent #FF6A00, bold sans-serif type, no people, slide numbers in top-right corner`
- Topic: `Why founders should automate their hiring intake process`
- Notes: `Address the founder pain of repetitive interviews. End with CTA: book a 15-min systems audit. Mention our automation playbook indirectly.`

Status flips from `Empty` to `Ready`. The Generate button enables.

**Step 3 — Generate.** Click. Toast: *"AI generation started — back in about 20 seconds."* Status: `Generating…`. Polling kicks in.

**Step 4 — Wait ~60 seconds** (carousels take longer than single images because of 5 image calls). Status flips to `Generated`. Toast: *"AI draft ready — check Awaiting Approval."* The `Card` column shows an **Open** link.

**Step 5 — Open the card.** Drawer shows:
- 5 carousel images in their actual 4:5 dimensions
- Caption (probably 4–6 lines, opens with a hook, body explains the pain + framework, closes with the CTA)
- Hashtags (5–10, mixing your brand core like `#Ten80Ten` with topical ones like `#OperationsLeadership`)
- Purple AI panel: quality score (e.g. `7/10`), AI's approval note (something like "Anchors the founder pain in slide 1, builds the case on slides 2–4, closes with the audit CTA. Verify the orange accent matches your latest brand palette."), visual brief, hashtags chips, CTA

**Step 6 — Reviewer pass.** You notice slide 3 has too much copy. Drag the card to **Revision Needed**. In the notes box: `Slide 3 has too many words — cut it down to one bold sentence. Also the hook on slide 1 is weak, lead with a specific time-cost ("you'll spend 6 hours this week scheduling interviews you don't need to attend").`

Save.

**Step 7 — Wait ~30 seconds.** The card animates back to Awaiting Approval. Open it again. Slide 3 is now a single bold line. The hook is now your specific time-cost line. Revision counter shows `v2`.

**Step 8 — Approve.** Drag the card to **Approved/Scheduled**. The normal manual approval flow runs (you confirm date/time, n8n picks it up for publishing). Iron law: the AI never did any of those steps for you.

Total cost: ~$2.50 for the original generation, ~$2.00 for the revision. ~$4.50 from your $10 daily cap.

---

## Appendix A — Re-creating the `ai-assets` bucket from scratch

If the bucket gets deleted, run this from a shell with `SUPABASE_SERVICE_ROLE_KEY` exported:

```bash
curl -sS -X POST 'https://lczmgquuzuqhalasjnip.supabase.co/storage/v1/bucket' \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "id":"ai-assets",
    "name":"ai-assets",
    "public":false,
    "file_size_limit":10485760,
    "allowed_mime_types":["image/png","image/jpeg","image/webp"]
  }'
```

Expected response: `{"name":"ai-assets"}` with HTTP 200.

---

## Appendix B — Manually verifying the migrations are live

```sql
-- Run in Supabase SQL editor
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name IN ('posts', 'content_plan_rows', 'ai_generation_jobs')
  AND column_name IN ('feel','visual_style','style_prompt','slides_count','media_type','aspect_ratio',
                      'asset_width','asset_height','asset_urls','asset_storage_keys','plan_row_id',
                      'workspace_id','format','status','kind','claim_token')
ORDER BY table_name, column_name;
```

You should see 11 rows from `posts`, 5 rows from `content_plan_rows`, and 2 rows from `ai_generation_jobs`.

---

## Appendix C — Commit history of this feature

```
cdd47e1  feat(studio): switch to gpt-image-2 + lower daily cap to $10
3bde07d  feat(studio): UI — Creator Studio page, AI badge on cards, AI review panel in drawer
e13870f  feat(studio): pipeline-context + types plumbing for AI fields
9953864  feat(studio): API routes — rows CRUD, generate, jobs, cancel, auto-revise
9cbf9c8  feat(studio): AI server lib — text/image clients, prompt builder, hallucination gate, worker
c85ff9a  feat(studio): migrations 0021-0023 — content_plan_rows, ai_generation_jobs, posts extension
```

To revert the entire feature (emergency rollback): `git revert c85ff9a..cdd47e1`. Then DROP the three new tables and the 11 new columns — but only after confirming no AI-generated posts exist in `posts`.
