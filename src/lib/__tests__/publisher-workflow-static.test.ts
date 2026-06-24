import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const WORKFLOW = JSON.parse(readFileSync(join(process.cwd(), "n8n/the-reach-auto-publisher-v4.json"), "utf8")) as {
  nodes: Array<{ name: string; parameters?: { jsCode?: string } }>;
};
const LEGACY_WORKFLOW_SRC = readFileSync(join(process.cwd(), "n8n/the-reach-auto-publisher.json"), "utf8");
const WORKFLOW_SRC = readFileSync(join(process.cwd(), "n8n/the-reach-auto-publisher-v4.json"), "utf8");
const PUBLISH_LEDGER_MIGRATION = readFileSync(join(process.cwd(), "supabase/migrations/0010_publish_ledger.sql"), "utf8");
const REQUEUE_RESET_MIGRATION = readFileSync(join(process.cwd(), "supabase/migrations/0059_publish_job_requeue_reset.sql"), "utf8");
const PARTIAL_RETRY_MIGRATION = readFileSync(join(process.cwd(), "supabase/migrations/0061_claim_partial_publish_retries.sql"), "utf8");
const AI_PERSIST_SRC = readFileSync(join(process.cwd(), "src/lib/ai/persist.ts"), "utf8");
const AI_WORKER_SRC = readFileSync(join(process.cwd(), "src/lib/ai/worker.ts"), "utf8");

function code(name: string): string {
  const node = WORKFLOW.nodes.find((candidate) => candidate.name === name);
  if (!node?.parameters?.jsCode) throw new Error(`Missing workflow code node: ${name}`);
  return node.parameters.jsCode;
}

describe("publisher workflow hardening contracts", () => {
  it("turns pre-flight validation failures into a terminal failed result before any platform publish", () => {
    const preflight = code("Pre-flight");
    expect(preflight).toContain("preflightFailed: true");
    expect(preflight).toContain("post: { ...post, platforms: [] }");
    expect(preflight).toContain("platform: 'preflight', success: false");

    for (const nodeName of ["Publish Facebook", "Publish Instagram", "Publish LinkedIn"]) {
      const publish = code(nodeName);
      const guardIdx = publish.indexOf("item.preflightFailed || item.hasJob === false || item.error");
      const platformCheckIdx = publish.indexOf("plat.includes");
      expect(guardIdx, nodeName).toBeGreaterThan(-1);
      expect(platformCheckIdx, nodeName).toBeGreaterThan(guardIdx);
      expect(publish, nodeName).toContain("reason: 'preflight_failed'");
    }
  });

  it("writes only columns that exist on platform_publish_attempts", () => {
    const finalize = code("Finalize Job");
    expect(PUBLISH_LEDGER_MIGRATION).not.toContain("post_url");
    expect(finalize).not.toContain("post_url:");
    expect(finalize).toContain("external_post_id: result.externalPostId || null");
    expect(finalize).toContain("response_payload: JSON.stringify({ response: result.response || null, postUrl: result.postUrl || null })");
  });

  it("resets retry state when a failed publish job is re-queued", () => {
    expect(REQUEUE_RESET_MIGRATION).toContain("attempts = 0");
    expect(REQUEUE_RESET_MIGRATION).toContain("last_error = null");
    expect(REQUEUE_RESET_MIGRATION).toContain("next_retry_at = null");
    expect(REQUEUE_RESET_MIGRATION).toContain("attempt_count = 0");
    expect(REQUEUE_RESET_MIGRATION).toContain("ON CONFLICT (job_id, platform) DO UPDATE");
  });

  it("retries partial publishes without double-posting platforms that already succeeded", () => {
    const claim = code("Claim Next Job");
    expect(claim).toContain("/rest/v1/platform_publish_attempts?job_id=eq.");
    expect(claim).toContain("const platformAttempts = Array.isArray(attemptRes) ? attemptRes : []");
    expect(claim).toContain("platformAttempts, _results");

    for (const [nodeName, platform] of [
      ["Publish Facebook", "facebook"],
      ["Publish Instagram", "instagram"],
      ["Publish LinkedIn", "linkedin"],
    ] as const) {
      const publish = code(nodeName);
      expect(publish).toContain(`a.platform === '${platform}'`);
      expect(publish).toContain("priorAttempt?.state === 'succeeded'");
      expect(publish).toContain("reason: 'already_succeeded'");
    }

    expect(PARTIAL_RETRY_MIGRATION).toContain("p.stage = 'posted'");
    expect(PARTIAL_RETRY_MIGRATION).toContain("p.posted_at IS NOT NULL");
    expect(PARTIAL_RETRY_MIGRATION).toContain("a.state = 'succeeded'");
    expect(PARTIAL_RETRY_MIGRATION).toContain("a.state <> 'succeeded'");
  });

  it("keeps every n8n workflow off the legacy audit table", () => {
    expect(WORKFLOW_SRC).toContain("/rest/v1/audit_log_v2");
    expect(LEGACY_WORKFLOW_SRC).toContain("/rest/v1/audit_log_v2");
    expect(WORKFLOW_SRC).not.toContain("post_audit_logs");
    expect(LEGACY_WORKFLOW_SRC).not.toContain("post_audit_logs");
  });

  it("all workflow artifacts satisfy the posted-stage lockdown contract", () => {
    for (const src of [WORKFLOW_SRC, LEGACY_WORKFLOW_SRC]) {
      expect(src).toContain("stage: 'posted'");
      expect(src).toContain("posted_at: new Date().toISOString()");
      expect(src).toContain("posted_urls: postedUrls");
    }
  });

  it("does not let a late AI revision overwrite a post that left revision_needed", () => {
    expect(AI_PERSIST_SRC).toContain("RevisionNoLongerPendingError");
    expect(AI_PERSIST_SRC).toContain('.eq("stage", "revision_needed")');
    expect(AI_PERSIST_SRC).toContain(".select(\"id\")");
    expect(AI_WORKER_SRC).toContain("err instanceof RevisionNoLongerPendingError");
    expect(AI_WORKER_SRC).toContain("ai_post_revise_cancelled");
  });
});
