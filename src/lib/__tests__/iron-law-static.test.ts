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
import { assertStageMoveCommitted, formatPipelineError, resolveLoadedCards, type PostRow } from "../pipeline-context";
import { canDeletePostRole, isPipelineApproverRole } from "../roles";

const PIPELINE_PATH = join(process.cwd(), "src/lib/pipeline-context.tsx");
const PIPELINE_SRC = readFileSync(PIPELINE_PATH, "utf8");
const KANBAN_BOARD_SRC = readFileSync(join(process.cwd(), "src/components/kanban-board.tsx"), "utf8");
const ASSET_DRAWER_SRC = readFileSync(join(process.cwd(), "src/components/asset-review-drawer.tsx"), "utf8");
const POST_DELETE_ROUTE_SRC = readFileSync(join(process.cwd(), "src/app/api/posts/[id]/route.ts"), "utf8");
const CONTENT_CARD_SRC = readFileSync(join(process.cwd(), "src/components/content-card.tsx"), "utf8");
const MANUAL_POSTED_ROUTE_SRC = readFileSync(
  join(process.cwd(), "src/app/api/admin/posts/[id]/manual-posted/route.ts"),
  "utf8",
);
const MANUAL_POSTED_SETTINGS_ROUTE_SRC = readFileSync(
  join(process.cwd(), "src/app/api/admin/manual-posted-settings/route.ts"),
  "utf8",
);
const BACKFILL_MEDIA_ROUTE_SRC = readFileSync(
  join(process.cwd(), "src/app/api/admin/backfill-media/route.ts"),
  "utf8",
);
const MANUAL_POSTED_SETTINGS_SRC = readFileSync(join(process.cwd(), "src/lib/manual-posted-settings.ts"), "utf8");
const SETTINGS_PAGE_SRC = readFileSync(join(process.cwd(), "src/components/pages/settings-page.tsx"), "utf8");
const REVISION_MODAL_SRC = readFileSync(join(process.cwd(), "src/components/revision-modal.tsx"), "utf8");
const KICKBACK_MODAL_SRC = readFileSync(join(process.cwd(), "src/components/kickback-modal.tsx"), "utf8");
const AUDIT_SRC = readFileSync(join(process.cwd(), "src/lib/audit.ts"), "utf8");
const AI_WORKER_SRC = readFileSync(join(process.cwd(), "src/lib/ai/worker.ts"), "utf8");
const DEEP_CHECK_SRC = readFileSync(join(process.cwd(), "src/app/api/health/deep-check/route.ts"), "utf8");
const POST_SAFETY_MIGRATION_SRC = readFileSync(join(process.cwd(), "supabase/migrations/0015_post_safety.sql"), "utf8");
const POST_STAGE_GUARD_MIGRATION_SRC = readFileSync(
  join(process.cwd(), "supabase/migrations/0046_post_stage_transition_guard.sql"),
  "utf8",
);
const NOTIFICATIONS_SHARED_SRC = readFileSync(join(process.cwd(), "src/app/api/notifications/_shared.ts"), "utf8");
const NOTIFICATION_ROUTE_SRCS = [
  "approved",
  "awaiting-approval",
  "mention",
  "revision",
].map((name) => readFileSync(join(process.cwd(), `src/app/api/notifications/${name}/route.ts`), "utf8"));

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

  it("stage moves require proof that exactly the target post reached the target stage", () => {
    const id = "33333333-3333-4333-8333-333333333333";
    expect(() => assertStageMoveCommitted(null, id, "awaiting_approval")).toThrow(
      /No post row was updated/,
    );
    expect(() => assertStageMoveCommitted(
      { id: "44444444-4444-4444-8444-444444444444", stage: "awaiting_approval" },
      id,
      "awaiting_approval",
    )).toThrow(/different post/);
    expect(() => assertStageMoveCommitted(
      { id, stage: "ideas" },
      id,
      "awaiting_approval",
    )).toThrow(/expected "awaiting_approval"/);
    expect(() => assertStageMoveCommitted(
      { id, stage: "awaiting_approval" },
      id,
      "awaiting_approval",
    )).not.toThrow();
  });

  it("stage move errors preserve PostgREST object details instead of rendering [object Object]", () => {
    expect(formatPipelineError({
      message: "new row violates row-level security policy",
      details: "No active workspace membership",
      hint: "Provision workspace access",
      code: "42501",
    })).toBe(
      "new row violates row-level security policy — No active workspace membership — Provision workspace access — code 42501",
    );
    expect(formatPipelineError({ message: "invalid input value for enum pipeline_stage" })).toBe(
      "invalid input value for enum pipeline_stage",
    );
    expect(formatPipelineError({ status: 0, error: "fetch failed" })).toBe(
      '{"status":0,"error":"fetch failed"}',
    );
  });

  it("moveCard requests the updated post row before treating a stage move as committed", () => {
    expect(PIPELINE_SRC).toMatch(
      /\.update\(\s*\{\s*stage:\s*newStage\s*\}\s*\)[\s\S]{0,200}\.eq\(\s*["']id["']\s*,\s*cardId\s*\)[\s\S]{0,120}\.select\(\s*["']id,\s*stage["']\s*\)[\s\S]{0,80}\.maybeSingle\(\s*\)/,
    );
    expect(PIPELINE_SRC).toMatch(/assertStageMoveCommitted\s*\(\s*data\s+as\s+StageMoveCommitRow\s*,\s*cardId\s*,\s*newStage\s*\)/);
    expect(PIPELINE_SRC).toMatch(/const message = formatPipelineError\s*\(\s*error\s*\)/);
    expect(PIPELINE_SRC).not.toMatch(/stage_change failed[\s\S]{0,240}String\s*\(\s*error\s*\)/);
  });

  it("stage-move callers do not show success toasts before provider persistence is proven", () => {
    expect(ASSET_DRAWER_SRC).not.toMatch(
      /moveCard\s*\(\s*selectedCard\.id\s*,\s*["']approved_scheduled["']\s*\)\s*;\s*addToast\s*\(\s*["']Post approved and scheduled/,
    );
    expect(ASSET_DRAWER_SRC).not.toMatch(
      /moveCard\s*\(\s*selectedCard\.id\s*,\s*nextStage\s*\)\s*;\s*addToast\s*\([^)]*Post moved/,
    );
    expect(REVISION_MODAL_SRC).not.toContain("Revision submitted. Sent for re-approval.");
    expect(KICKBACK_MODAL_SRC).not.toContain("Revision requested. Creator and approvers notified.");
  });

  it("board and drawer share the same approver-role helper", () => {
    for (const role of ["superadmin", "admin", "owner", "approver", "creative_director"]) {
      expect(isPipelineApproverRole(role), role).toBe(true);
    }
    for (const role of ["editor", "social_media_specialist", "video_editor", "graphic_designer", "specialist", "viewer"]) {
      expect(isPipelineApproverRole(role), role).toBe(false);
    }
    expect(KANBAN_BOARD_SRC).toMatch(/isPipelineApproverRole\s*\(\s*currentMember\?\.role\s*\|\|\s*currentUser\.role\s*\)/);
    expect(ASSET_DRAWER_SRC).toMatch(/isPipelineApproverRole\s*\(\s*currentMember\?\.role\s*\|\|\s*currentUser\.role\s*\)/);
    expect(ASSET_DRAWER_SRC).not.toMatch(/if\s*\(\s*!me\s*\)\s*return\s+false/);
  });

  it("database stage-transition guard locks posted source and approver-only approval", () => {
    expect(KANBAN_BOARD_SRC).toMatch(/sourceCard\.stage\s*===\s*["']posted["']/);
    expect(PIPELINE_SRC).toMatch(/card\?\.stage\s*===\s*["']posted["']/);
    expect(POST_STAGE_GUARD_MIGRATION_SRC).toMatch(/CREATE OR REPLACE FUNCTION public\.block_manual_posted_transition\(\)/);
    expect(POST_STAGE_GUARD_MIGRATION_SRC).toMatch(/OLD\.stage\s*=\s*'posted'/);
    expect(POST_STAGE_GUARD_MIGRATION_SRC).toMatch(/Published posts cannot be moved out of "posted"/);
    expect(POST_STAGE_GUARD_MIGRATION_SRC).toMatch(/NEW\.stage\s*=\s*'approved_scheduled'/);
    expect(POST_STAGE_GUARD_MIGRATION_SRC).toMatch(/public\.workspace_members/);
    expect(POST_STAGE_GUARD_MIGRATION_SRC).toMatch(/wm\.user_id\s*=\s*auth\.uid\(\)/);
    expect(POST_STAGE_GUARD_MIGRATION_SRC).toMatch(
      /'superadmin', 'admin', 'owner', 'approver', 'creative_director'/,
    );
    expect(POST_STAGE_GUARD_MIGRATION_SRC).toMatch(/DROP TRIGGER IF EXISTS posts_block_manual_posted/);
    expect(POST_STAGE_GUARD_MIGRATION_SRC).toMatch(/CREATE TRIGGER posts_block_manual_posted/);
  });

  it("manual Posted override is globally toggled by superadmin and usable by approvers only for approved cards", () => {
    expect(MANUAL_POSTED_SETTINGS_SRC).toContain("/api/admin/manual-posted-settings");
    expect(MANUAL_POSTED_SETTINGS_SRC).not.toContain("loadState");
    expect(MANUAL_POSTED_SETTINGS_SRC).not.toContain("saveState");
    expect(SETTINGS_PAGE_SRC).toContain("{isSuperadmin && (");
    expect(MANUAL_POSTED_SETTINGS_ROUTE_SRC).toContain("MANUAL_POSTED_TOGGLE_ROLES");
    expect(KANBAN_BOARD_SRC).toContain("useManualPostedMovesEnabled");
    expect(KANBAN_BOARD_SRC).toContain('sourceCard.stage !== "approved_scheduled"');
    expect(KANBAN_BOARD_SRC).toContain("blocked_posted_approver_required");
    expect(PIPELINE_SRC).toContain("useManualPostedMovesEnabled");
    expect(PIPELINE_SRC).toContain("/api/admin/posts/${cardId}/manual-posted");
    expect(PIPELINE_SRC).toContain('card?.stage !== "approved_scheduled"');
    expect(MANUAL_POSTED_ROUTE_SRC).toContain("requireBearerTeamRole(request, MANUAL_POSTED_MOVE_ROLES)");
    expect(MANUAL_POSTED_ROUTE_SRC).toContain("MANUAL_POSTED_FLAG_NAME");
    expect(MANUAL_POSTED_ROUTE_SRC).toContain('existing.stage !== "approved_scheduled"');
    expect(MANUAL_POSTED_ROUTE_SRC).toContain("createServiceRoleClient");
    expect(MANUAL_POSTED_ROUTE_SRC).toMatch(/\.update\(\{\s*stage:\s*"posted",\s*posted_at:\s*postedAt\s*\}\)/);
    expect(MANUAL_POSTED_ROUTE_SRC).toContain('p_action: "manual_posted"');
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

  it("post update paths verify Supabase actually updated a row before side effects", () => {
    expect(PIPELINE_SRC).toContain("assertPostUpdateCommitted");
    expect(PIPELINE_SRC.match(/\.update\([\s\S]{0,140}\.eq\("id", cardId\)[\s\S]{0,180}\.select\("id"\)[\s\S]{0,60}\.maybeSingle\(\)/g) || []).toHaveLength(3);
  });

  it("post deletes go through the server route and require a confirmed deleted row", () => {
    expect(PIPELINE_SRC).toContain("fetch(`/api/posts/${cardId}`");
    expect(PIPELINE_SRC).toContain('method: "DELETE"');
    expect(PIPELINE_SRC).toMatch(/fetch\(`\/api\/posts\/\$\{cardId\}`[\s\S]{0,220}"X-Workspace-Id": workspaceIdRef\.current \|\| BASELINE_WORKSPACE_ID/);
    expect(PIPELINE_SRC).not.toMatch(/from\(["']posts["']\)\.delete\(\)\.eq\(["']id["'],\s*cardId\)/);
    expect(POST_DELETE_ROUTE_SRC).toContain("requireBearerTeamRole(request, POST_DELETE_ALLOWED_ROLES)");
    expect(POST_DELETE_ROUTE_SRC).toContain('PROTECTED_DELETE_STAGES = new Set(["approved_scheduled", "posted"])');
    expect(POST_DELETE_ROUTE_SRC).toContain(".select(\"id, title, stage, workspace_id\")");
    expect(POST_DELETE_ROUTE_SRC).toContain('"no_row_deleted"');
  });

  it("creative directors have delete access through the confirmed server route", () => {
    expect(canDeletePostRole("superadmin")).toBe(true);
    expect(canDeletePostRole("admin")).toBe(true);
    expect(canDeletePostRole("creative_director")).toBe(true);
    expect(canDeletePostRole("approver")).toBe(false);
    expect(canDeletePostRole("editor")).toBe(false);
    expect(ASSET_DRAWER_SRC).toContain("canDeletePostRole(currentMember?.role || currentUser.role)");
    expect(ASSET_DRAWER_SRC).toContain('selectedCard.stage === "approved_scheduled" || selectedCard.stage === "posted"');
  });

  it("localStorage fallback strips initial seeded sample/demo cards", () => {
    expect(PIPELINE_SRC).toContain("function loadCardBackup()");
    expect(PIPELINE_SRC).toContain("!isInitialSampleCard(card)");
    expect(PIPELINE_SRC).toMatch(/\^Sample\\b/i);
    expect(PIPELINE_SRC).toMatch(/\^Demo Archive Post\\b/i);
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
    // Delete moved to /api/posts/[id], so the remaining direct Supabase
    // id-keyed mutation sites are move/reapproval/kickback/update.
    expect(checked).toBeGreaterThanOrEqual(4);
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
    const selectIdx = body.search(/supabase\s*\.\s*from\("posts"\)\s*\.\s*select/);
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

  it("subscribes to posts realtime from resolved workspace state, not a stale ref", () => {
    expect(PIPELINE_SRC).toContain("const [workspaceId, setWorkspaceId] = useState<string | null>(null)");
    expect(PIPELINE_SRC).toContain("if (!useSupabase || !workspaceId) return");
    expect(PIPELINE_SRC).toContain("const wsId = workspaceId");
    const realtimeBlock = PIPELINE_SRC.match(/\/\/ ─── Realtime subscription ───[\s\S]*?\/\/ ─── Persist localStorage backup/);
    expect(realtimeBlock).not.toBeNull();
    expect(realtimeBlock![0]).not.toContain("if (!useSupabase || !workspaceIdRef.current) return");
    expect(realtimeBlock![0]).not.toContain("const wsId = workspaceIdRef.current");
  });

  it("scopes post loads and client post updates to the active workspace", () => {
    expect(PIPELINE_SRC).toContain("const wsId = workspaceIdRef.current || BASELINE_WORKSPACE_ID");
    expect(PIPELINE_SRC.match(/\.from\("posts"\)\s*[\s\S]{0,120}\.select\([\s\S]{0,120}\.eq\("workspace_id", wsId\)/g) || []).toHaveLength(2);
    expect(PIPELINE_SRC.match(/\.eq\("workspace_id", workspaceIdRef\.current \|\| BASELINE_WORKSPACE_ID\)/g) || []).toHaveLength(4);
  });

  it("treats realtime UPDATE payloads as canonical instead of suppressing peer or publisher updates", () => {
    expect(PIPELINE_SRC).not.toContain("if (recentMutations.current.has(updated.id)) return");
    expect(PIPELINE_SRC).toContain("recentMutations.current.delete(updated.id)");
    expect(PIPELINE_SRC).toContain("stage='posted'");
  });

  it("guards revision kickbacks against temp IDs before opening or submitting the modal", () => {
    const requestKickbackMatch = PIPELINE_SRC.match(/const requestKickback[\s\S]{0,500}setPendingKickback/);
    expect(requestKickbackMatch).not.toBeNull();
    expect(requestKickbackMatch![0]).toMatch(/useSupabase[\s\S]{0,120}!isValidUuid\s*\(\s*cardId\s*\)/);
    const submitKickbackMatch = PIPELINE_SRC.match(/const submitKickback[\s\S]{0,500}const now = new Date/);
    expect(submitKickbackMatch).not.toBeNull();
    expect(submitKickbackMatch![0]).toMatch(/useSupabase[\s\S]{0,120}!isValidUuid\s*\(\s*cardId\s*\)/);
  });

  it("sends protected notification routes with bearer auth and checks non-2xx responses", () => {
    expect(PIPELINE_SRC).toContain("const postNotification = useCallback");
    expect(PIPELINE_SRC).toContain("headers.Authorization = `Bearer ${token}`");
    expect(PIPELINE_SRC).toContain("if (!res.ok)");
    expect(PIPELINE_SRC).toContain('postNotification("/api/notifications/revision"');
    expect(PIPELINE_SRC).toContain('postNotification("/api/notifications/mention"');
    expect(ASSET_DRAWER_SRC).toContain("headers.Authorization = `Bearer ${accessToken}`");
    expect(ASSET_DRAWER_SRC).toContain("if (!res.ok)");
    expect(ASSET_DRAWER_SRC).toContain("[asset-review-drawer] mention notify failed");
  });

  it("reconciles createCard temp IDs idempotently when realtime insert echoes first", () => {
    expect(PIPELINE_SRC).toContain("const savedCard = dbToCard(data as PostRow)");
    expect(PIPELINE_SRC).toContain("existing.id === tempId || existing.id === savedCard.id");
    expect(PIPELINE_SRC).toContain("return inserted ? next : [savedCard, ...next]");
    expect(PIPELINE_SRC).toContain("recentMutations.current.delete(tempId)");
  });

  it("notification APIs require active workspace access and verify the post belongs to that workspace", () => {
    expect(NOTIFICATIONS_SHARED_SRC).toContain("roles: readonly string[] = ACTIVE_NOTIFICATION_ROLES");
    expect(NOTIFICATIONS_SHARED_SRC).toContain("requireBearerTeamRole(request, roles)");
    expect(NOTIFICATIONS_SHARED_SRC).toContain(".eq(\"workspace_id\", workspaceId)");
    for (const src of NOTIFICATION_ROUTE_SRCS) {
      expect(src).toContain("requireNotificationContext(request");
      expect(src).toContain("loadWorkspacePost");
      expect(src).toContain("p_workspace_id: ctx.workspaceId");
    }
  });

  it("AI worker audit events carry the job workspace id", () => {
    expect(AI_WORKER_SRC).toContain("p_workspace_id: workspaceId");
    expect(AI_WORKER_SRC.match(/await recordAudit\(sb, job\.workspace_id/g) || []).toHaveLength(5);
  });

  it("admin media backfill is scoped to the caller's workspace", () => {
    expect(BACKFILL_MEDIA_ROUTE_SRC).toContain("requireBearerTeamRole(request, ADMIN_ROLES)");
    expect(BACKFILL_MEDIA_ROUTE_SRC).toContain("const workspaceId = auth.workspaceId");
    expect(BACKFILL_MEDIA_ROUTE_SRC).toMatch(/\.from\("posts"\)[\s\S]{0,220}\.eq\("workspace_id", workspaceId\)/);
    expect(BACKFILL_MEDIA_ROUTE_SRC).toMatch(/\.from\("media_assets"\)[\s\S]{0,220}\.eq\("workspace_id", workspaceId\)/);
    expect(BACKFILL_MEDIA_ROUTE_SRC).toMatch(
      /\.update\(\{[\s\S]{0,80}used_in: newUsedIn[\s\S]{0,160}\.eq\("workspace_id", workspaceId\)/,
    );
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

  it("does not report expected post_hard_deleted audit rows as orphaned health failures", () => {
    expect(POST_SAFETY_MIGRATION_SRC).toContain("'post_hard_deleted'");
    expect(DEEP_CHECK_SRC).toContain("const deletedPostAuditIds = new Set");
    expect(DEEP_CHECK_SRC).toContain('a.action === "post_hard_deleted"');
    expect(DEEP_CHECK_SRC).toContain("!deletedPostAuditIds.has(a.entity_id)");
    expect(DEEP_CHECK_SRC).toContain("expectedDeletedPostAudits");
  });
});

describe("pipeline drag surface contract", () => {
  it("keeps the whole Reach content card draggable while preserving a visible handle", () => {
    const rootStart = CONTENT_CARD_SRC.indexOf("ref={setNodeRef}");
    const handleLabel = CONTENT_CARD_SRC.indexOf('aria-label="Drag card"');
    const handleStart = CONTENT_CARD_SRC.lastIndexOf("<button", handleLabel);
    expect(rootStart).toBeGreaterThan(-1);
    expect(handleStart).toBeGreaterThan(rootStart);

    const rootSegment = CONTENT_CARD_SRC.slice(rootStart, handleStart);
    expect(rootSegment).toContain("{...attributes}");
    expect(rootSegment).toContain("{...listeners}");
    expect(rootSegment).toContain("cursor-grab");
    expect(rootSegment).toContain("touch-none");

    const handleSegment = CONTENT_CARD_SRC.slice(handleStart, CONTENT_CARD_SRC.indexOf("{cardContent}", handleStart));
    expect(handleSegment).toContain('aria-label="Drag card"');
    expect(handleSegment).not.toContain("{...listeners}");
    expect(handleSegment).not.toContain("{...attributes}");
    expect(handleSegment).not.toMatch(/pointer-events-none/);
    expect(CONTENT_CARD_SRC).toMatch(/visible drag affordance; the whole card surface is draggable/i);
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
