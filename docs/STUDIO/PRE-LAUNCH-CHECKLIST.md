# Creator Studio — Pre-Launch Checklist

Run this **before adding any new operator to the allowlist.** Every item is verified by Aldridge personally — no item is "obviously fine, skip it." If any one fails, fix it before proceeding.

## Stage 1 — Static checks (≈3 minutes)

```bash
cd ~/Documents/CURSOR\ MAIN/ten80ten-smm-portal
npm run typecheck
npm run lint
npm run build
```

- [ ] Typecheck exits 0.
- [ ] Lint exits 0.
- [ ] Build exits 0.

If any fail: don't go further. Investigate before adding access.

## Stage 2 — Smoke test against the live deploy (≈1 minute)

Get a fresh access token from the live app:

1. Open `smm.ten80ten.com` while logged in as a superadmin.
2. DevTools → Console:
   ```js
   (await supabase.auth.getSession()).data.session.access_token
   ```
3. Copy the token.

Run:

```bash
STUDIO_BASE_URL=https://smm.ten80ten.com \
STUDIO_TEST_BEARER="<paste token>" \
STUDIO_WEBHOOK_SECRET="<paste the same secret you set in Vercel + Supabase webhook>" \
npm run studio:smoke
```

- [ ] All checks pass (Summary: N passed, 0 failed).

## Stage 3 — Generate one real post (≈1 minute, ≈$0.50)

Burns ~$0.50 of OpenAI budget. Do this once when env vars or models change, then again before each new operator joins.

1. Open Creator Studio.
2. Fill row 1 with the canonical test inputs:
   - Date: today
   - Platforms: LinkedIn
   - Media: Image
   - Format: Single
   - Feel: Educational
   - Visual Style: Infographic
   - Style Prompt: `clean white background, single orange accent #FF6A00, bold sans-serif, no people, no text overlay`
   - Topic: `5 signs your business needs better workflows`
   - Notes: `End with CTA to book a 15-min systems audit.`
3. Click **Generate**.
4. Wait for the toast "AI draft ready — check Awaiting Approval."

Verify:

- [ ] Card appeared in Awaiting Approval within 90 seconds.
- [ ] Card has a purple AI badge with the 4:5 aspect chip.
- [ ] Opening the card shows the actual rendered 1080×1350 image (not a 404 / broken icon).
- [ ] Caption is on-brand (no fabricated stats, mentions the CTA).
- [ ] Quality score 1–10 is set.
- [ ] Approval note explains the post's intent.

If the image is 404 or the card looks broken: **STOP.** Pull the kill switch (`STUDIO_ENABLED=false` in Vercel, redeploy) and debug before continuing.

## Stage 4 — Verify auto-revise works (≈30 seconds, ≈$0.50)

5. Drag the card from Stage 3 to **Revision Needed**.
6. In the notes box, type: `Make the hook punchier — lead with a specific time-cost.`
7. Click **Save**.
8. Wait ~30 seconds.

Verify:

- [ ] Card animates back to Awaiting Approval automatically.
- [ ] Revision counter shows `v2` on the AI badge.
- [ ] Hook is different (and ideally better — reviewer-readable change).
- [ ] No error toast.

If the card stays stuck in Revision Needed: check Supabase Dashboard → Database → Webhooks for delivery failures. Most likely cause: `SUPABASE_WEBHOOK_SECRET` in Vercel doesn't match the Authorization header in the webhook config.

## Stage 5 — Cap math sanity check (≈10 seconds)

Open Settings → Creator Studio Health.

- [ ] Studio is live (green dot).
- [ ] Spend today shows ~$1 (your two test generations).
- [ ] Daily cap shows $10.
- [ ] Per-row cap shows $3.
- [ ] Queued: 0. Running: 0. Stuck: 0.
- [ ] Completed 24h ≥ 2.
- [ ] Failed 24h = 0.

If the spend today number is wildly off from $1: real OpenAI cost is drifting from our estimates. **Don't ship to more operators yet — adjust `OPENAI_PRICE_IMAGE` in Vercel first.**

## Stage 6 — Verify the kill switch (≈30 seconds)

7. In Vercel, set `STUDIO_ENABLED=false` and redeploy.
8. Wait for the deploy to finish.

Verify:

- [ ] Studio nav link disappears from the sidebar within 60 seconds.
- [ ] If you navigate to Studio via URL/back-button, the amber "Creator Studio is paused" panel appears (not an error).
- [ ] `curl -H "Authorization: Bearer <token>" https://smm.ten80ten.com/api/ai/studio/rows` returns 503.
- [ ] Existing AI-generated cards in Awaiting Approval render normally and can still be approved.

9. Set `STUDIO_ENABLED=true` (or remove the var) and redeploy.

Verify:

- [ ] Studio nav link re-appears.
- [ ] One more test generation works.

## Stage 7 — Walk the operator through it (≈10 minutes, screen share)

Before the new operator's first day with access:

10. Screen-share with them.
11. Demo one full plan→generate→review→approve flow.
12. Demo the drag-to-revise flow.
13. Show them: hallucination gate failure, what the error chip looks like.
14. Show them: where to find the manual at `docs/TEN80TEN-SMM-CREATOR-STUDIO-MANUAL.html`.
15. Have THEM generate one post while you watch silently.

Verify:

- [ ] They produced a post without help.
- [ ] They can articulate what NOT to do (no auto-publish, no stat fabrication).
- [ ] They know where the rollback button (Settings → Creator Studio Access → remove their own email) is — for emergencies.

## Stage 8 — Add them to the allowlist

16. Settings → Creator Studio Access → Add their email → Save.

- [ ] Their email is in the allowlist chips.
- [ ] On their next login (or refresh) the Studio link appears in their sidebar.
- [ ] You see them appear in the workspace via the kanban realtime presence.

## Done

If every checkbox is ticked: they're cleared to use Studio.

If any checkbox failed: that's the gate. Don't promote them until it passes.

## Failure log

Keep a record. Append each pre-launch run to this file:

| Date | Operator added | Stages passed | Stages failed | Resolution |
|---|---|---|---|---|
| 2026-05-13 | aldridge@ten80ten.com | n/a — author | n/a | seed |
| 2026-05-13 | carlo@ten80ten.com | (TBD when first run) | | |
