// Static-grep + unit enforcement for the "posts must never disappear" iron-law
// guards in pipeline-context.tsx + audit.ts.
//
// Each guard maps to a real prod incident — see AGENTS.md §1b, §1c, §3, §5, §8.
// These tests fail the build if the forbidden patterns ever come back.
//
// Why static-grep instead of runtime? The whole point of these guards is that
// they sit inside huge client-side flows with Supabase + realtime + auth deps.
// A grep is a 1ms regression detector with zero mock surface. Where a pure
// function has been extracted (resolveLoadedCards), we ALSO unit-test the real
// code path so behavior — not just textual shape — is locked.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { resolveLoadedCards, type PostRow } from "../pipeline-context";

const PIPELINE_PATH = join(process.cwd(), "src/lib/pipeline-context.tsx");
const PIPELINE_SRC = readFileSync(PIPELINE_PATH, "utf8");
const ASSET_DRAWER_SRC = readFileSync(join(process.cwd(), "src/components/asset-review-drawer.tsx"), "utf8");
const CONTENT_CARD_SRC = readFileSync(join(process.cwd(), "src/components/content-card.tsx"), "utf8");
const AUDIT_SRC = readFileSync(join(process.cwd(), "src/lib/audit.ts"), "utf8");

/** Recursively collect every *.ts / *.tsx file under a directory. */
function walkSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walkSourceFiles(full));
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe("iron-law guards in pipeline-context.tsx", () => {
  it("does NOT fall back to PLACEHOLDER_CARDS on empty DB result — static (AGENTS.md §1b)", () => {
    // FORBIDDEN shapes — every variant of "gate the DB result on a non-empty
    // length, then fall back to loadState in the else branch":
    //   result.data && result.data.length > 0    ... else ... setCards(loadState
    //   result.data?.length                      ... else ... setCards(loadState
    //   result.data.length !== 0                 ... else ... setCards(loadState
    //   result.data.length >= 1                  ... else ... setCards(loadState
    const forbidden = [
      /result\.data\s*&&\s*result\.data\.length\s*>\s*0[\s\S]{0,400}else[\s\S]{0,200}setCards\(\s*loadState/,
      /result\.data\?\.length[\s\S]{0,400}else[\s\S]{0,200}setCards\(\s*loadState/,
      /result\.data\.length\s*!==?\s*0[\s\S]{0,400}else[\s\S]{0,200}setCards\(\s*loadState/,
      /result\.data\.length\s*>=\s*1[\s\S]{0,400}else[\s\S]{0,200}setCards\(\s*loadState/,
    ];
    for (const re of forbidden) {
      expect(PIPELINE_SRC).not.toMatch(re);
    }
  });

  it("resolveLoadedCards returns [] (not the fallback) on an empty DB result — unit (AGENTS.md §1b)", () => {
    // The single most important behavioral guarantee in the codebase: an empty
    // array is a VALID empty board. It must NOT trigger the localStorage
    // fallback, which would mask real "you have no posts" state with stale data.
    let fallbackCalls = 0;
    const fallback = (): never[] => {
      fallbackCalls++;
      return [{ id: "STALE" }] as unknown as never[];
    };
    const cards = resolveLoadedCards({ error: null, data: [] }, fallback as never);
    expect(cards).toEqual([]);
    expect(fallbackCalls).toBe(0); // fallback must NOT have been consulted
  });

  it("resolveLoadedCards returns the fallback ONLY on a real DB error — unit (AGENTS.md §1b)", () => {
    const fallbackValue = [
      { id: "11111111-1111-4111-8111-111111111111", title: "backup" },
    ] as never;
    const fallback = () => fallbackValue;
    const cards = resolveLoadedCards(
      { error: new Error("connection reset"), data: null },
      fallback as never,
    );
    expect(cards).toBe(fallbackValue);
  });

  it("resolveLoadedCards maps DB rows to cards on a non-empty result — unit (AGENTS.md §1b)", () => {
    const row: PostRow = {
      id: "22222222-2222-4222-8222-222222222222",
      title: "Real post",
      stage: "ideas",
      content_type: "image",
      platforms: ["instagram"],
    };
    let fallbackCalls = 0;
    const fallback = (): never[] => {
      fallbackCalls++;
      return [] as never[];
    };
    const cards = resolveLoadedCards({ error: null, data: [row] }, fallback as never);
    expect(fallbackCalls).toBe(0);
    expect(cards).toHaveLength(1);
    expect(cards[0].id).toBe(row.id);
    expect(cards[0].title).toBe("Real post");
    expect(cards[0].platforms).toEqual(["instagram"]);
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

  it("asset drawer revision requests use submitKickback instead of split note/stage/notification writes", () => {
    expect(ASSET_DRAWER_SRC).toMatch(/submitKickback\s*\(\s*selectedCard\.id\s*,\s*feedback\s*\)/);
    expect(ASSET_DRAWER_SRC).not.toMatch(
      /updateCard\s*\(\s*selectedCard\.id\s*,\s*\{\s*notes[\s\S]{0,600}moveCard\s*\(\s*selectedCard\.id\s*,\s*["']revision_needed["']\s*\)/,
    );
    expect(ASSET_DRAWER_SRC).not.toMatch(
      /body:\s*JSON\.stringify\s*\(\s*\{[\s\S]{0,250}revisionNote:\s*feedback/,
    );
  });

  it("every .eq(\"id\", cardId) on supabase posts is preceded by an isValidUuid guard (AGENTS.md §5)", () => {
    // STRONGER than a raw count: a NEW unguarded `.eq("id", cardId)` call —
    // e.g. someone adding a sixth mutation site — must FAIL this test.
    // For every `.eq("id", cardId)` occurrence, walk back ~600 chars and
    // require an `isValidUuid(cardId)` guard in that window.
    const eqRe = /\.eq\(\s*["']id["']\s*,\s*cardId\s*\)/g;
    let m: RegExpExecArray | null;
    let checked = 0;
    while ((m = eqRe.exec(PIPELINE_SRC)) !== null) {
      checked++;
      const windowStart = Math.max(0, m.index - 600);
      const preceding = PIPELINE_SRC.slice(windowStart, m.index);
      expect(
        /isValidUuid\s*\(\s*cardId\s*\)/.test(preceding),
        `Unguarded .eq("id", cardId) at char ${m.index} — missing isValidUuid(cardId) ` +
          `guard within the preceding 600 chars. Every id-keyed Supabase op MUST ` +
          `be guarded (AGENTS.md §5).`,
      ).toBe(true);
    }
    // Sanity: the mutation sites still exist; the regex did not silently
    // match zero occurrences due to a refactor of the call shape.
    expect(checked).toBeGreaterThanOrEqual(5);
  });

  it("provision is called before posts SELECT in load(), and not inside a comment (AGENTS.md §1b, §4)", () => {
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

    // The provision string must be a REAL call, not a commented-out line. Walk
    // back from the match to the start of its physical line and reject if that
    // line is a `//` or `*` comment.
    const lineStart = body.lastIndexOf("\n", provisionIdx) + 1;
    const linePrefix = body.slice(lineStart, provisionIdx).trimStart();
    expect(
      linePrefix.startsWith("//") || linePrefix.startsWith("*"),
      "The /api/workspace/provision reference in load() is inside a comment — " +
        "the provision call must be live code (AGENTS.md §1b, §4).",
    ).toBe(false);
  });
});

describe("iron-law guards in audit.ts", () => {
  it("does NOT write to post_audit_logs from audit.ts client code (AGENTS.md §3)", () => {
    // The legacy table has no INSERT RLS for authenticated users — client
    // writes silently drop. Audit writes must use the record_audit_event RPC.
    expect(AUDIT_SRC).not.toMatch(
      /from\(['"]post_audit_logs['"]\)\.(insert|update|delete|upsert)/,
    );
    expect(AUDIT_SRC).toMatch(/rpc\(['"]record_audit_event['"]/);
  });
});

describe("pipeline drag handle contract", () => {
  it("keeps the Ten80Ten drag handle as a real listener button", () => {
    const handleMatch = CONTENT_CARD_SRC.match(
      /<button[\s\S]{0,500}aria-label="Drag card"[\s\S]{0,500}>\s*<span/,
    );
    expect(handleMatch).not.toBeNull();
    const handle = handleMatch![0];
    expect(handle).toMatch(/\{\.\.\.attributes\}/);
    expect(handle).toMatch(/\{\.\.\.listeners\}/);
    expect(handle).not.toMatch(/pointer-events-none/);
    expect(CONTENT_CARD_SRC).not.toMatch(/visible drag affordance; the whole card is draggable/i);
    expect(CONTENT_CARD_SRC).toMatch(/draggable=\{false\}/);
  });
});

describe("iron-law: no write to post_audit_logs anywhere under src/ (AGENTS.md §3)", () => {
  it("no file under src/ inserts/updates/deletes/upserts post_audit_logs", () => {
    // Broadened from audit.ts-only: a write to the legacy table from ANY file
    // (a route handler, a component, a future helper) is silently dropped by
    // RLS. `.select` reads are allowed — only mutations are forbidden.
    const srcRoot = join(process.cwd(), "src");
    const files = walkSourceFiles(srcRoot);
    const writeRe = /from\(\s*["']post_audit_logs["']\s*\)\s*\.\s*(insert|update|delete|upsert)\b/;
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      if (writeRe.test(text)) {
        offenders.push(file.replace(srcRoot, "src"));
      }
    }
    expect(
      offenders,
      `These files write to the legacy post_audit_logs table — use the ` +
        `record_audit_event RPC instead (AGENTS.md §3): ${offenders.join(", ")}`,
    ).toEqual([]);
    // Sanity: the walk actually visited a meaningful number of files.
    expect(files.length).toBeGreaterThan(10);
  });
});
