import { beforeEach, describe, expect, it, vi } from "vitest";

type MockResult = { data?: unknown; error?: { message: string } | null };

let actor = { user: { id: "admin-1" }, email: "admin@example.com", role: "admin" };
let listUsersPages: Array<{ users: Array<{ id: string; email?: string }>; error?: { message: string } | null }>;
let deleteUserResult: MockResult;
let tableResults: Record<string, { delete?: MockResult | MockResult[] }>;
let operations: Array<{ table: string; method: string; filters: Array<[string, unknown]> } | { table: "auth.users"; method: "deleteUser"; id: string }>;

function nextResult(value: MockResult | MockResult[] | undefined): MockResult {
  if (Array.isArray(value)) return value.shift() || { data: null, error: null };
  return value || { data: null, error: null };
}

function makeQuery(table: string) {
  const cfg = tableResults[table] || {};
  const state = { method: "", filters: [] as Array<[string, unknown]> };
  const builder: Record<string, unknown> = {};
  builder.delete = vi.fn(() => {
    state.method = "delete";
    operations.push({ table, method: "delete", filters: state.filters });
    return builder;
  });
  builder.eq = vi.fn((column: string, value: unknown) => {
    state.filters.push([column, value]);
    return builder;
  });
  builder.then = (resolve: (value: MockResult) => unknown, reject: (reason: unknown) => unknown) => {
    const value = state.method === "delete" ? nextResult(cfg.delete) : { data: null, error: null };
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
  actor = { user: { id: "admin-1" }, email: "admin@example.com", role: "admin" };
  listUsersPages = [{ users: [{ id: "user-1", email: "member@example.com" }] }];
  deleteUserResult = { data: null, error: null };
  tableResults = {
    workspace_members: { delete: { data: null, error: null } },
    team_members: { delete: [{ data: null, error: null }, { data: null, error: null }] },
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
      { table: "team_members", method: "delete", filters: [["id", "member-row-1"]] },
      { table: "team_members", method: "delete", filters: [["email", "member@example.com"]] },
      { table: "auth.users", method: "deleteUser", id: "user-1" },
    ]));
  });

  it("blocks self-removal before any cleanup runs", async () => {
    const res = await POST(makeRequest({ memberId: "admin-row", memberEmail: "admin@example.com" }));
    expect(res.status).toBe(400);
    expect(operations).toEqual([]);
  });

  it("is idempotent when the auth user is already gone", async () => {
    listUsersPages = [{ users: [] }];
    const res = await POST(makeRequest({ memberId: "member-row-2", memberEmail: "missing@example.com" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.authDeleted).toBe(false);
    expect(operations).toEqual(expect.arrayContaining([
      { table: "team_members", method: "delete", filters: [["id", "member-row-2"]] },
      { table: "team_members", method: "delete", filters: [["email", "missing@example.com"]] },
    ]));
    expect(operations.some((op) => op.table === "workspace_members")).toBe(false);
  });
});
