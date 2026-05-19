// Static-grep enforcement for the "posts must never disappear" iron-law guards
// in pipeline-context.tsx + audit.ts.
//
// Each guard maps to a real prod incident — see AGENTS.md §1b, §1c, §3, §5, §8.
// These tests fail the build if the forbidden patterns ever come back.
//
// Why static-grep instead of runtime? The whole point of these guards is that
// they sit inside huge client-side flows with Supabase + realtime + auth deps.
// A grep is a 1ms regression detector with zero mock surface.

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const PIPELINE_SRC = readFileSync(
  join(process.cwd(), "src/lib/pipeline-context.tsx"),
  "utf8",
);
const AUDIT_SRC = readFileSync(
  join(process.cwd(), "src/lib/audit.ts"),
  "utf8",
);

describe("iron-law guards in pipeline-context.tsx", () => {
  it("does NOT fall back to PLACEHOLDER_CARDS on empty DB result (AGENTS.md §1b)", () => {
    // FORBIDDEN: `result.data && result.data.length > 0 ... else ... setCards(loadState`
    // CORRECT:   `result.data ... else ... setCards(loadState`  (no length>0 gate)
    expect(PIPELINE_SRC).not.toMatch(
      /result\.data\s*&&\s*result\.data\.length\s*>\s*0[\s\S]{0,400}else[\s\S]{0,200}setCards\(\s*loadState/,
    );
  });

  it("createCard always sets workspace_id via fallback, not conditional-only (AGENTS.md §1c)", () => {
    // FORBIDDEN: `if (workspaceIdRef.current) insertRow.workspace_id = ...`
    //   — silently omits workspace_id when the ref is null and the INSERT fails RLS.
    expect(PIPELINE_SRC).not.toMatch(
      /if\s*\(\s*workspaceIdRef\.current\s*\)\s*\{?\s*insertRow\.workspace_id\s*=/,
    );
    // REQUIRED: `insertRow.workspace_id = workspaceIdRef.current || "<baseline-uuid>"`
    expect(PIPELINE_SRC).toMatch(
      /insertRow\.workspace_id\s*=\s*workspaceIdRef\.current\s*\|\|\s*["']00000000-0000-0000-0000-000000000001["']/,
    );
  });

  it("guards mutation sites with isValidUuid before hitting Supabase (AGENTS.md §5)", () => {
    // Temp IDs are timestamp strings and would 400 on a UUID column.
    // Sites: moveCard, submitReapproval, submitKickback, updateCard, deleteCard.
    const guardSites = PIPELINE_SRC.match(/isValidUuid\s*\(\s*cardId\s*\)/g) || [];
    expect(guardSites.length).toBeGreaterThanOrEqual(5);
  });

  it("provision is called before posts SELECT in load() (AGENTS.md §1b, §4)", () => {
    // The provisioner must establish workspace membership BEFORE the posts
    // SELECT, otherwise RLS returns an empty array and the user thinks their
    // posts vanished.
    const loadFnMatch = PIPELINE_SRC.match(
      /async function load\(\)[\s\S]*?hydrated\.current\s*=\s*true/,
    );
    expect(loadFnMatch).not.toBeNull();
    const body = loadFnMatch![0];
    const provisionIdx = body.indexOf("/api/workspace/provision");
    const selectIdx = body.indexOf('supabase.from("posts").select');
    expect(provisionIdx).toBeGreaterThan(-1);
    expect(selectIdx).toBeGreaterThan(-1);
    expect(provisionIdx).toBeLessThan(selectIdx);
  });
});

describe("iron-law guards in audit.ts", () => {
  it("does NOT write to post_audit_logs from client code (AGENTS.md §3)", () => {
    // The legacy table has no INSERT RLS for authenticated users — client
    // writes silently drop. Audit writes must use the record_audit_event RPC.
    expect(AUDIT_SRC).not.toMatch(
      /from\(['"]post_audit_logs['"]\)\.(insert|update|delete)/,
    );
    expect(AUDIT_SRC).toMatch(/rpc\(['"]record_audit_event['"]/);
  });
});
