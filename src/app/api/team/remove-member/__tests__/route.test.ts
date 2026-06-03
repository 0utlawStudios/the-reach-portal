import { beforeEach, describe, expect, it, vi } from "vitest";

type MockResult = { data?: unknown; error?: { message: string } | null };

let actor = { user: { id: "admin-1" }, email: "admin@example.com", role: "admin", workspaceId: "workspace-1" };
let listUsersPages: Array<{ users: Array<{ id: string; email?: string }>; error?: { message: string } | null }>;
let deleteUserResult: MockResult;
let tableResults: Record<string, { maybeSingle?: MockResult | MockResult[]; delete?: MockResult | MockResult[]; list?: MockResult | MockResult[] }>;
let operations: Array<{ table: string; method: string; filters: Array<[string, unknown]> } | { table: "auth.users"; method: "deleteUser"; id: string }>;

function nextResult(value: MockResult | MockResult[] | undefined): MockResult {
  if (Array.isArray(value)) return value.shift() || { data: null, error: null };
  return value || { data: null, error: null };
}

function makeQuery(table: string) {
  const cfg = tableResults[table] || {};
  const state = { method: "", filters: [] as Array<[string, unknown]> };
  const builder: Record<string, unknown> = {};
  builder.select = vi.fn(() => builder);
  builder.delete = vi.fn(() => {
    state.method = "delete";
    operations.push({ table, method: "delete", filters: state.filters });
    return builder;
  });
  builder.eq = vi.fn((column: string, value: unknown) => {
    state.filters.push([column, value]);
    return builder;
  });
  builder.maybeSingle = vi.fn(() => Promise.resolve(nextResult(cfg.maybeSingle)));
  builder.then = (resolve: (value: MockResult) => unknown, reject: (reason: unknown) => unknown) => {
    const value = state.method === "delete" ? nextResult(cfg.delete) : nextResult(cfg.list);
    return Promise.resolve(value).then(resolve, reject);
  };
  return builder;
}

vi.mock("@/lib/auth/require", () => ({
  requireBearerTeamRole: vi.fn(() => Promise.resolve(actor)),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    auth: {
      admin: {
        listUsers: vi.fn(({ page }: { page: number }) => {
          const entry = listUsersPages[page - 1] || { users: [] };
          return Promise.resolve({ data: { users: entry.users }, error: entry.error || null });
        }),
        deleteUser: vi.fn((id: string) => {
          operations.push({ table: "auth.users", method: "deleteUser", id });
          return Promise.resolve(deleteUserResult);
        }),
      },
    },
    from: vi.fn((table: string) => makeQuery(table)),
    rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
  })),
}));

import { POST } from "../route";

function makeRequest(body: Record<string, unknown>) {
  return {
    headers: { get: () => "Bearer admin-token" },
    json: () => Promise.resolve(body),
  } as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  actor = { user: { id: "admin-1" }, email: "admin@example.com", role: "admin", workspaceId: "workspace-1" };
  listUsersPages = [{ users: [{ id: "user-1", email: "member@example.com" }] }];
  deleteUserResult = { data: null, error: null };
  tableResults = {
    workspace_members: { delete: { data: null, error: null } },
    team_members: {
      maybeSingle: { data: { id: "member-row-1", email: "member@example.com", role: "editor", status: "active" }, error: null },
      delete: { data: null, error: null },
      list: { data: [{ id: "admin-1" }, { id: "admin-2" }], error: null },
    },
  };
  operations = [];
});

describe("POST /api/team/remove-member", () => {
  it("cleans workspace_members, team_members, and auth user so the email can be re-invited", async () => {
    const res = await POST(makeRequest({ memberId: "member-row-1", memberEmail: "Member@Example.com" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, authDeleted: true });
    expect(operations).toEqual(expect.arrayContaining([
      { table: "workspace_members", method: "delete", filters: [["user_id", "user-1"]] },
      { table: "team_members", method: "delete", filters: [["id", "member-row-1"], ["email", "member@example.com"]] },
      { table: "auth.users", method: "deleteUser", id: "user-1" },
    ]));
  });

  it("blocks self-removal before any cleanup runs", async () => {
    tableResults.team_members.maybeSingle = { data: { id: "admin-row", email: "admin@example.com", role: "admin", status: "active" }, error: null };
    const res = await POST(makeRequest({ memberId: "admin-row", memberEmail: "admin@example.com" }));
    expect(res.status).toBe(400);
    expect(operations).toEqual([]);
  });

  it("blocks admins from removing admin-level members server-side", async () => {
    tableResults.team_members.maybeSingle = { data: { id: "owner-row", email: "owner@example.com", role: "owner", status: "active" }, error: null };

    const res = await POST(makeRequest({ memberId: "owner-row", memberEmail: "owner@example.com" }));

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("Only a superadmin");
    expect(operations).toEqual([]);
  });

  it("blocks removing the last active superadmin", async () => {
    actor = { user: { id: "superadmin-1" }, email: "root@example.com", role: "superadmin", workspaceId: "workspace-1" };
    tableResults.team_members.maybeSingle = { data: { id: "other-root", email: "other-root@example.com", role: "superadmin", status: "active" }, error: null };
    tableResults.team_members.list = { data: [{ id: "other-root" }], error: null };

    const res = await POST(makeRequest({ memberId: "other-root", memberEmail: "other-root@example.com" }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("last active superadmin");
    expect(operations).toEqual([]);
  });

  it("is idempotent when the auth user is already gone", async () => {
    listUsersPages = [{ users: [] }];
    tableResults.team_members.maybeSingle = { data: { id: "member-row-2", email: "missing@example.com", role: "editor", status: "active" }, error: null };
    const res = await POST(makeRequest({ memberId: "member-row-2", memberEmail: "missing@example.com" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.authDeleted).toBe(false);
    expect(operations).toEqual(expect.arrayContaining([
      { table: "team_members", method: "delete", filters: [["id", "member-row-2"], ["email", "missing@example.com"]] },
    ]));
    expect(operations.some((op) => op.table === "workspace_members")).toBe(false);
  });

  it("does not restore access when only auth cleanup fails after workspace/team removal", async () => {
    deleteUserResult = { data: null, error: { message: "auth service unavailable" } };

    const res = await POST(makeRequest({ memberId: "member-row-1", memberEmail: "member@example.com" }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, authDeleted: false, authCleanupPending: true });
    expect(operations).toEqual(expect.arrayContaining([
      { table: "workspace_members", method: "delete", filters: [["user_id", "user-1"]] },
      { table: "team_members", method: "delete", filters: [["id", "member-row-1"], ["email", "member@example.com"]] },
      { table: "auth.users", method: "deleteUser", id: "user-1" },
    ]));
  });

  it("rejects stale UI payloads when the id and email point to different members", async () => {
    tableResults.team_members.maybeSingle = { data: { id: "member-row-3", email: "other@example.com", role: "editor", status: "active" }, error: null };
    const res = await POST(makeRequest({ memberId: "member-row-3", memberEmail: "member@example.com" }));
    expect(res.status).toBe(409);
    expect(operations).toEqual([]);
  });
});
