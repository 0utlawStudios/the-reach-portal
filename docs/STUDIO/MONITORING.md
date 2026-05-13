# Creator Studio — Daily Monitoring

What to check every morning until the feature is stable for 30+ days.

## Two-minute daily glance

1. Open `smm.ten80ten.com` → Settings → Creator Studio Health.
2. Read the top status bar. Green = live. Amber = paused.
3. Read the eight gauges.

**Green-light state:**
- Spend today: green (< 60% of cap).
- Stuck: 0.
- Cap hits 7d: 0.
- Gate failures 7d: < 5 (some are healthy — the gate is doing its job).
- Avg latency 24h: < 90s.
- Last success: < 24h ago.

**Anything not green:** dig into the SQL queries below before opening Studio for new operators.

## SQL queries — Supabase Dashboard → SQL Editor

### How much have we spent this week?

```sql
SELECT
  date_trunc('day', created_at) AS day,
  count(*) FILTER (WHERE status = 'completed') AS completed,
  count(*) FILTER (WHERE status = 'failed') AS failed,
  count(*) FILTER (WHERE status = 'cancelled') AS cancelled,
  round(sum(cost_usd) FILTER (WHERE status != 'cancelled')::numeric, 2) AS spend_usd
FROM ai_generation_jobs
WHERE created_at > now() - interval '7 days'
GROUP BY 1
ORDER BY 1 DESC;
```

Healthy: spend per day < daily cap, completed >> failed, cancelled is rare.

### What's failing and why?

```sql
SELECT
  date_trunc('hour', created_at) AS hour,
  error,
  count(*) AS n
FROM ai_generation_jobs
WHERE status = 'failed'
  AND created_at > now() - interval '48 hours'
GROUP BY 1, 2
ORDER BY 1 DESC, 3 DESC;
```

Patterns to act on:
- `hallucination_gate_failed` clustering on one operator → coach them on Notes-column usage.
- `OpenAI text error 429` → bump rate limit or check OpenAI account.
- `OpenAI image error 5xx` → OpenAI side issue, wait 30 min.
- `Daily AI spend cap reached` → expected when cap fires; not a real failure.
- `aborted: post left revision_needed` → operator changed their mind; expected.

### Which posts has the AI made this week?

```sql
SELECT
  p.id, p.title, p.stage, p.created_at, p.revision_count,
  p.generated_by_model, p.quality_score,
  c.created_by AS planned_by
FROM posts p
LEFT JOIN content_plan_rows c ON c.id = p.plan_row_id
WHERE p.generated_by_model IS NOT NULL
  AND p.created_at > now() - interval '7 days'
ORDER BY p.created_at DESC;
```

### Which operators are using Studio?

```sql
SELECT
  requested_by AS operator,
  count(*) AS jobs,
  count(*) FILTER (WHERE status = 'completed') AS completed,
  count(*) FILTER (WHERE status = 'failed') AS failed,
  round(sum(cost_usd) FILTER (WHERE status != 'cancelled')::numeric, 2) AS spend_usd
FROM ai_generation_jobs
WHERE created_at > now() - interval '7 days'
GROUP BY 1
ORDER BY 2 DESC;
```

If one operator has a much higher failure rate than others, they probably need a coaching pass.

### Average latency by job kind

```sql
SELECT
  kind,
  count(*) AS n,
  round(avg(extract(epoch FROM (completed_at - started_at)))::numeric, 1) AS avg_secs,
  round(percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM (completed_at - started_at)))::numeric, 1) AS p95_secs
FROM ai_generation_jobs
WHERE status = 'completed'
  AND completed_at > now() - interval '7 days'
GROUP BY 1;
```

Healthy targets:
- generate single image: avg 15-30s, p95 < 60s.
- generate carousel: avg 60-100s, p95 < 180s.
- revise: similar to generate (it's the same pipeline).

If p95 doubles week-over-week, something's slowing. Likely OpenAI; check their status page.

### Hallucination gate fingerprint

```sql
SELECT
  date_trunc('day', created_at) AS day,
  count(*) FILTER (WHERE error LIKE '%hallucination_gate_failed%') AS gate_fails,
  count(*) FILTER (WHERE status = 'completed') AS completed,
  round(100.0 * count(*) FILTER (WHERE error LIKE '%hallucination_gate_failed%') / NULLIF(count(*), 0), 1) AS pct
FROM ai_generation_jobs
WHERE created_at > now() - interval '14 days'
GROUP BY 1
ORDER BY 1 DESC;
```

If the gate-fail rate is consistently > 20%, either:
- Operators are pasting too many stats into Topic without echoing them in Notes (corpus mismatch), or
- The model is drifting and inventing more facts than before (bump `OPENAI_PROMPT_VERSION` and tighten the system prompt).

### Audit thread for one post

```sql
SELECT
  created_at, action, metadata
FROM audit_log_v2
WHERE entity_id = '<post-uuid>'::uuid
ORDER BY created_at ASC;
```

Every AI post has a full trail: generated → (revised if applicable) → stage transitions → approved/published.

## Alerts (manual until we wire email)

Set a phone reminder for each of these:

- **8am daily**: open Settings → Creator Studio Health for 2 minutes.
- **Friday 4pm**: run the "operator usage" query, eyeball the trend.
- **Monthly 1st**: cross-check actual OpenAI invoice against `ai_generation_jobs.cost_usd` sum. If our estimate is more than 30% off, update `OPENAI_PRICE_IMAGE` and `OPENAI_PRICE_TEXT_*` env vars.

## When something looks wrong

1. **Don't touch the kill switch unless an operator is actively hurt** (publishing fake stats, runaway spend, etc.). Smaller issues can wait until you've reproduced.
2. Pull the relevant audit trail with the SQL above.
3. Open one failing job's row in Supabase: `SELECT * FROM ai_generation_jobs WHERE id = '<uuid>';`. The `error` and `result` columns usually tell you everything.
4. Reproduce the issue in a fresh row (don't poke the operator's broken row — it might be in a weird state).
5. If you can reproduce, file a real ticket. If you can't, monitor for 24h and revisit.

## Promotion gates

Don't open Studio to a new operator until:

- 7 consecutive days with zero stuck jobs.
- 30+ completed jobs total.
- < 10% failure rate (excluding cap-hit failures).
- Cap hits this month ≤ 2.
- Last hallucinated-content incident > 30 days ago (or never).
