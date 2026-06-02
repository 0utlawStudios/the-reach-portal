import { beforeEach, describe, expect, it, vi } from "vitest";

type MockResult = { data?: unknown; error?: { message: string } | null };
type TeamMemberMock = {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  role: string;
  status: "active" | "pending";
  avatar_url?: string | null;
};

let actor = { user: { id: "admin-1" }, email: "admin@example.com", role: "admin", workspaceId: "workspace-1" };
let users: Array<{ id: string; email?: string; user_metadata?: Record<string, unknown> }>;
let updateUserResult: MockResult;
let tableResults: Record<string, { maybeSingle?: MockResult | MockResult[]; update?: MockResult | MockResult[] }>;
let operations: Array<
  | { table: string; method: string; payload?: unknown; filters: Array<[string, unknown]> }
  | { table: "auth.users"; method: string; id: string; payload: unknown }
  | { table: "rpc"; method: string; name: string; payload: unknown }
>;

function nextResult(value: MockResult | MockResult[] | undefined): MockResult {
  if (Array.isArray(value)) return value.shift() || { data: null, error: null };
  return value || { data: null, error: null };
}

function makeQuery(table: string) {
  const cfg = tableResults[table] || {};
  const state = { method: "select", filters: [] as Array<[string, unknown]>, payload: undefined as unknown };
  const builder: Record<string, unknown> = {};
  builder.select = vi.fn(() => builder);
  builder.update = vi.fn((payload: unknown) => {
    state.method = "update";
    state.payload = payload;
    return builder;
  });
  builder.eq = vi.fn((column: string, value: unknown) => {
    state.filters.push([column, value]);
    return builder;
  });
  builder.maybeSingle = vi.fn(() => Promise.resolve(nextResult(cfg.maybeSingle)));
  builder.then = (resolve: (value: MockResult) => unknown, reject: (reason: unknown) => unknown) => {
    const result = state.method === "update" ? nextResult(cfg.update) : { data: null, error: null };
    operations.push({ table, method: state.method, payload: state.payload, filters: state.filters });
    return Promise.resolve(result).then(resolve, reject);
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
        listUsers: vi.fn(() => Promise.resolve({ data: { users }, error: null })),
        updateUserById: vi.fn((id: string, payload: unknown) => {
          operations.push({ table: "auth.users", method: "updateUserById", id, payload });
          return Promise.resolve(updateUserResult);
        }),
      },
    },
    from: vi.fn((table: string) => makeQuery(table)),
    rpc: vi.fn((name: string, payload: unknown) => {
      operations.push({ table: "rpc", method: "rpc", name, payload });
      return Promise.resolve({ data: null, error: null });
    }),
  })),
}));

import { POST } from "../route";

function makeRequest(body: Record<string, unknown>) {
  return {
    headers: { get: () => "Bearer token" },
    json: () => Promise.resolve(body),
  } as unknown as Parameters<typeof POST>[0];
}

function member(overrides: Partial<TeamMemberMock> = {}): TeamMemberMock {
  return {
    id: "member-row-1",
    name: "Member Name",
    email: "member@example.com",
    phone: null,
    role: "approver",
    status: "active",
    avatar_url: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  actor = { user: { id: "admin-1" }, email: "admin@example.com", role: "admin", workspaceId: "workspace-1" };
  users = [{ id: "user-1", email: "member@example.com", user_metadata: { name: "Member Name", role: "approver" } }];
  updateUserResult = { data: { user: { id: "user-1" } }, error: null };
  tableResults = {
    team_members: {
      maybeSingle: { data: member(), error: null },
      update: { data: null, error: null },
    },
    workspace_members: { update: { data: null, error: null } },
  };
  operations = [];
});

describe("POST /api/team/update-member", () => {
  it("syncs active role changes to team_members, workspace_members, auth metadata, and audit", async () => {
    const res = await POST(makeRequest({
      memberId: "member-row-1",
      updates: { name: "Updated Name", role: "creative_director", phone: "+1 555" },
    }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ success: true });
    expect(operations).toEqual(expect.arrayContaining([
      {
        table: "team_members",
        method: "update",
        payload: { name: "Updated Name", phone: "+1 555", role: "creative_director" },
        filters: [["id", "member-row-1"]],
      },
      {
        table: "workspace_members",
        method: "update",
        payload: { role: "creative_director" },
        filters: [["workspace_id", "workspace-1"], ["user_id", "user-1"]],
      },
      {
        table: "auth.users",
        method: "updateUserById",
        id: "user-1",
        payload: expect.objectContaining({
          user_metadata: expect.objectContaining({ name: "Updated Name", role: "creative_director", phone: "+1 555" }),
        }),
      },
      {
        table: "rpc",
        method: "rpc",
        name: "record_audit_event",
        payload: expect.objectContaining({ p_action: "role_changed" }),
      },
    ]));
  });

  it("blocks admins from editing a superadmin profile", async () => {
    tableResults.team_members.maybeSingle = { data: member({ role: "superadmin" }), error: null };

    const res = await POST(makeRequest({ memberId: "member-row-1", updates: { name: "Changed" } }));

    expect(res.status).toBe(403);
    expect(operations).toEqual([]);
  });

  it("rolls team_members back when workspace role sync fails", async () => {
    tableResults.workspace_members.update = { data: null, error: { message: "policy failed" } };

    const res = await POST(makeRequest({ memberId: "member-row-1", updates: { role: "admin" } }));

    expect(res.status).toBe(500);
    expect(operations).toEqual(expect.arrayContaining([
      { table: "team_members", method: "update", payload: { role: "admin" }, filters: [["id", "member-row-1"]] },
      {
        table: "team_members",
        method: "update",
        payload: { name: "Member Name", phone: null, role: "approver", avatar_url: null },
        filters: [["id", "member-row-1"]],
      },
    ]));
  });

  it("rejects active role changes when the matching auth user is missing", async () => {
    users = [];

    const res = await POST(makeRequest({ memberId: "member-row-1", updates: { role: "admin" } }));

    expect(res.status).toBe(409);
    expect(operations.some((op) => op.table === "team_members" && op.method === "update")).toBe(false);
  });

  it("updates pending invite metadata without touching workspace_members", async () => {
    tableResults.team_members.maybeSingle = { data: member({ status: "pending" }), error: null };

    const res = await POST(makeRequest({ memberId: "member-row-1", updates: { name: "Pending Name", role: "video_editor" } }));

    expect(res.status).toBe(200);
    expect(operations).toEqual(expect.arrayContaining([
      {
        table: "team_members",
        method: "update",
        payload: { name: "Pending Name", role: "video_editor" },
        filters: [["id", "member-row-1"]],
      },
      {
        table: "auth.users",
        method: "updateUserById",
        id: "user-1",
        payload: expect.objectContaining({
          user_metadata: expect.objectContaining({ name: "Pending Name", role: "video_editor" }),
        }),
      },
    ]));
    expect(operations.some((op) => op.table === "workspace_members")).toBe(false);
  });
});
