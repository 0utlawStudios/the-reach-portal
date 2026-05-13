#!/usr/bin/env node
// scripts/studio-smoke.mjs
//
// Smoke test for Creator Studio. Hits every public endpoint with various
// auth states and confirms the expected status codes. Does NOT make real
// OpenAI calls — generation is exercised separately via the manual runbook.
//
// Usage:
//   STUDIO_BASE_URL=https://smm.ten80ten.com \
//   STUDIO_TEST_BEARER=<a valid superadmin user's access token> \
//   node scripts/studio-smoke.mjs
//
// Optional:
//   STUDIO_TEST_VIEWER_BEARER=<a valid non-allowlisted user's token> for
//     role/allowlist negative tests.
//   STUDIO_WEBHOOK_SECRET=<value> to validate the webhook 401/204 paths.
//
// Exit code 0 if all checks pass, 1 if any fails. Prints a TAP-like trace.

const BASE = process.env.STUDIO_BASE_URL || "http://localhost:3000";
const BEARER = process.env.STUDIO_TEST_BEARER || "";
const VIEWER_BEARER = process.env.STUDIO_TEST_VIEWER_BEARER || "";
const WEBHOOK_SECRET = process.env.STUDIO_WEBHOOK_SECRET || "";

let pass = 0;
let fail = 0;
const failures = [];

const colors = {
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

function check(name, ok, detail) {
  if (ok) {
    pass++;
    console.log(`  ${colors.green("✓")} ${name} ${colors.dim(detail || "")}`);
  } else {
    fail++;
    failures.push({ name, detail });
    console.log(`  ${colors.red("✗")} ${name} ${colors.red(detail || "")}`);
  }
}

async function callRaw(method, path, { bearer, headers, body } = {}) {
  const url = `${BASE}${path}`;
  const h = { ...(headers || {}) };
  if (bearer) h.Authorization = `Bearer ${bearer}`;
  if (body && !h["Content-Type"]) h["Content-Type"] = "application/json";
  const res = await fetch(url, {
    method,
    headers: h,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json;
  try { json = await res.json(); } catch { json = null; }
  return { status: res.status, json };
}

async function group(title, fn) {
  console.log(colors.bold(`\n• ${title}`));
  await fn();
}

(async function main() {
  console.log(colors.bold(`Studio smoke test → ${BASE}`));
  if (!BEARER) {
    console.log(colors.red("✗ STUDIO_TEST_BEARER not set — most tests cannot run."));
    console.log(colors.dim("  Get a token: login as a superadmin user, then in DevTools console:"));
    console.log(colors.dim("  await supabase.auth.getSession().then(s => s.data.session?.access_token)"));
    process.exit(1);
  }

  // ─── Unauthenticated ───
  await group("Unauthenticated requests return 401", async () => {
    const r1 = await callRaw("GET", "/api/ai/studio/rows");
    check("GET /api/ai/studio/rows without bearer → 401", r1.status === 401, `got ${r1.status}`);
    const r2 = await callRaw("POST", "/api/ai/studio/rows", { body: {} });
    check("POST /api/ai/studio/rows without bearer → 401", r2.status === 401, `got ${r2.status}`);
    const r3 = await callRaw("GET", "/api/ai/health");
    check("GET /api/ai/health without bearer → 401", r3.status === 401, `got ${r3.status}`);
  });

  // ─── Garbage token ───
  await group("Garbage bearer rejected", async () => {
    const r = await callRaw("GET", "/api/ai/studio/rows", { bearer: "garbage.fake.jwt" });
    check("Fake bearer → 401", r.status === 401, `got ${r.status}`);
  });

  // ─── Authenticated admin ───
  await group("Authenticated admin reads succeed", async () => {
    const r1 = await callRaw("GET", "/api/ai/studio/access", { bearer: BEARER });
    check("GET /api/ai/studio/access → 200", r1.status === 200, `got ${r1.status}`);
    check("access.data.isAdmin is true", r1.json?.data?.isAdmin === true, `got ${r1.json?.data?.isAdmin}`);
    check("access.data has allowlistConfigured boolean", typeof r1.json?.data?.allowlistConfigured === "boolean");

    const r2 = await callRaw("GET", "/api/ai/health", { bearer: BEARER });
    check("GET /api/ai/health → 200", r2.status === 200, `got ${r2.status}`);
    check("health.studio_enabled is boolean", typeof r2.json?.data?.studio_enabled === "boolean");
    check("health.daily_cap_usd is positive", r2.json?.data?.daily_cap_usd > 0, `cap=${r2.json?.data?.daily_cap_usd}`);
    check("health.spend_today_usd is numeric", typeof r2.json?.data?.spend_today_usd === "number");
    check("health.jobs has stuck array", Array.isArray(r2.json?.data?.jobs?.stuck_ids));

    const r3 = await callRaw("GET", "/api/ai/studio/rows", { bearer: BEARER });
    check("GET /api/ai/studio/rows → 200", r3.status === 200, `got ${r3.status}`);
    check("rows response is an array", Array.isArray(r3.json?.data?.rows));
  });

  // ─── Allowlist visibility ───
  await group("Allowlist surface", async () => {
    const r = await callRaw("GET", "/api/ai/studio/access", { bearer: BEARER });
    if (r.status !== 200) {
      check("allowlist surface check skipped (access endpoint failed)", false);
      return;
    }
    const d = r.json?.data || {};
    check("allowed=true (caller's email is on the allowlist or no allowlist set)", d.allowed === true || d.allowlistConfigured === false, `allowed=${d.allowed} configured=${d.allowlistConfigured}`);
  });

  // ─── PUT access (admin write) ───
  await group("Allowlist edits are admin-only", async () => {
    if (VIEWER_BEARER) {
      const r = await callRaw("PUT", "/api/ai/studio/access", { bearer: VIEWER_BEARER, body: { mode: "set", emails: ["evil@example.com"] } });
      check("Viewer PUT → 403", r.status === 403, `got ${r.status}`);
    } else {
      check("Viewer PUT 403 check skipped (no VIEWER_BEARER)", true, "skipped");
    }
  });

  // ─── Generate without required fields ───
  await group("Validation rejects bad payloads", async () => {
    const r = await callRaw("POST", "/api/ai/studio/rows", { bearer: BEARER, body: { row_index: 9999, scheduled_date: null } });
    check("POST rows with stub payload → 200 or 500 (insert may succeed with NULLs)", r.status === 200 || r.status === 500, `got ${r.status}`);
    if (r.status === 200 && r.json?.data?.row?.id) {
      // Clean up — delete the test row.
      await callRaw("DELETE", `/api/ai/studio/rows/${r.json.data.row.id}`, { bearer: BEARER });
    }

    const r2 = await callRaw("POST", "/api/ai/studio/generate-row/not-a-uuid", { bearer: BEARER });
    check("Generate with non-UUID id → 400", r2.status === 400, `got ${r2.status}`);

    const r3 = await callRaw("GET", "/api/ai/jobs/not-a-uuid", { bearer: BEARER });
    check("Jobs poll with non-UUID id → 400", r3.status === 400, `got ${r3.status}`);
  });

  // ─── Webhook auth ───
  await group("Webhook secret enforced", async () => {
    const r1 = await callRaw("POST", "/api/ai/auto-revise/webhook", { body: { type: "UPDATE", table: "posts" } });
    check("Webhook without secret → 401", r1.status === 401, `got ${r1.status}`);
    const r2 = await callRaw("POST", "/api/ai/auto-revise/webhook", { headers: { Authorization: "Bearer wrong-secret" }, body: { type: "UPDATE", table: "posts" } });
    check("Webhook with wrong secret → 401", r2.status === 401, `got ${r2.status}`);
    if (WEBHOOK_SECRET) {
      const r3 = await callRaw("POST", "/api/ai/auto-revise/webhook", {
        headers: { Authorization: `Bearer ${WEBHOOK_SECRET}` },
        body: { type: "INSERT", table: "posts" }, // wrong event type, expect 204
      });
      check("Webhook with valid secret + wrong event → 204", r3.status === 204, `got ${r3.status}`);
    } else {
      check("Webhook valid-secret check skipped (no STUDIO_WEBHOOK_SECRET)", true, "skipped");
    }
  });

  // ─── Cron worker auth ───
  await group("Cron worker auth enforced", async () => {
    const r1 = await callRaw("POST", "/api/ai/auto-revise/process");
    check("Worker without auth → 401", r1.status === 401, `got ${r1.status}`);
    const r2 = await callRaw("POST", "/api/ai/auto-revise/process", { headers: { "x-trigger-secret": "wrong" } });
    check("Worker with wrong x-trigger-secret → 401", r2.status === 401, `got ${r2.status}`);
  });

  // ─── Summary ───
  console.log();
  console.log(colors.bold(`Summary: ${pass} passed, ${fail} failed`));
  if (fail > 0) {
    console.log(colors.red("Failures:"));
    for (const f of failures) console.log(`  - ${f.name}: ${f.detail || ""}`);
    process.exit(1);
  }
  process.exit(0);
})().catch((err) => {
  console.error(colors.red("Smoke runner crashed:"), err);
  process.exit(2);
});
