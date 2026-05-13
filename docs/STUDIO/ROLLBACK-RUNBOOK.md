# Creator Studio — Rollback Runbook

When something is wrong and you need Studio off **right now.**

## Level 1: 30-second kill switch (preferred)

This stops all generation without rolling back code. Existing posts are unaffected.

1. Open `vercel.com → ten80ten-smm-portal → Settings → Environment Variables`.
2. Add or update: `STUDIO_ENABLED=false` in **Production** scope.
3. Click **Save**.
4. `Deployments → ⋯ → Redeploy` on the current production deployment.
5. Wait for green ✓ (≈45 seconds).

**Result:**
- Sidebar Studio link disappears for all users.
- All `/api/ai/studio/*` and `/api/ai/jobs/*` routes return 503 with `code: feature_disabled`.
- Auto-revise webhook silently 204s — Supabase won't retry.
- The cron worker stops draining queued jobs (they stay queued and resume when re-enabled).
- Existing AI posts in Awaiting Approval render normally and can still be approved/scheduled.

**To re-enable:** flip `STUDIO_ENABLED=true` (or delete the var) and redeploy.

## Level 2: Force-cancel in-flight jobs

If you also want to abandon currently-running jobs (rare — usually you want them to finish so the operator sees the result):

```sql
-- Run in Supabase Dashboard → SQL Editor
UPDATE ai_generation_jobs
SET status = 'cancelled',
    error = 'manual_kill_switch',
    completed_at = now()
WHERE status IN ('queued', 'running');

UPDATE content_plan_rows
SET status = 'ready', last_error = 'kill switch — please re-generate'
WHERE status IN ('generating', 'revising');
```

## Level 3: Revert code

If the bug is in code shipped today and the kill switch isn't enough (e.g. it broke something OUTSIDE Studio), revert the commits:

```bash
cd ~/Documents/CURSOR\ MAIN/ten80ten-smm-portal
git log --oneline | head -20
# Find the last known-good commit (look for the one before Studio shipped).
git revert <bad-commit-sha>..HEAD --no-edit
npm run typecheck && npm run build
git push origin main
```

Vercel auto-deploys.

**Caveat:** the migrations 0021/0022/0023 are additive and won't break the rest of the app, so you do NOT need to revert them. Leave the new columns/tables in place — they cost nothing when unused.

## Level 4: Disable just the auto-revise webhook

Sometimes the runaway is specifically the webhook loop (e.g. a misconfigured rule fires repeatedly).

1. `supabase.com → Database → Webhooks → auto-revise-ai-posts → Toggle off`.
2. The Studio sheet still works; only the drag-to-revise convenience is paused.

## Level 5: Pull the OpenAI key

Nuclear option — kills ALL generation INSTANTLY because the API calls fail at the SDK layer.

1. `vercel.com → Environment Variables → OPENAI_API_KEY → Edit → save empty value`.
2. Redeploy.

Jobs in flight will fail; queued jobs will fail when claimed. Pre-existing AI posts are unaffected.

## After any rollback

Always:

1. Post a 2-line summary to the team (Slack / email / wherever): what happened, what you did, what's still pending.
2. Check Settings → Creator Studio Health for residual stuck jobs. Reclaim cutoff is 5 min; manually flip stuck running jobs to queued or cancelled if needed.
3. Decide before re-enabling: was this a bug to fix or a config to adjust? Don't re-enable until the root cause is addressed.

## Signs you need to roll back

- Health panel shows daily spend hit cap before noon AND no operator complaints (means runaway loop).
- Failed jobs in 24h > 5 AND completed jobs < 2 (gate or model is broken).
- Stuck jobs > 0 for more than two cron cycles (worker can't claim).
- Hallucinated facts visible in a published post.
- Carlo or another operator reports "Studio is acting weird" three times in an hour.
