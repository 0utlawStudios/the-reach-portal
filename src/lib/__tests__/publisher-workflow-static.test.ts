import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const WORKFLOW = JSON.parse(readFileSync(join(process.cwd(), "n8n/the-reach-auto-publisher-v4.json"), "utf8")) as {
  nodes: Array<{ name: string; parameters?: { jsCode?: string } }>;
};
const PUBLISH_LEDGER_MIGRATION = readFileSync(join(process.cwd(), "supabase/migrations/0010_publish_ledger.sql"), "utf8");
const REQUEUE_RESET_MIGRATION = readFileSync(join(process.cwd(), "supabase/migrations/0059_publish_job_requeue_reset.sql"), "utf8");
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

  it("does not let a late AI revision overwrite a post that left revision_needed", () => {
    expect(AI_PERSIST_SRC).toContain("RevisionNoLongerPendingError");
    expect(AI_PERSIST_SRC).toContain('.eq("stage", "revision_needed")');
    expect(AI_PERSIST_SRC).toContain(".select(\"id\")");
    expect(AI_WORKER_SRC).toContain("err instanceof RevisionNoLongerPendingError");
    expect(AI_WORKER_SRC).toContain("ai_post_revise_cancelled");
  });
});
