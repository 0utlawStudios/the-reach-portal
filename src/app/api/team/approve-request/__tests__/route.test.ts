import { beforeEach, describe, expect, it, vi } from "vitest";

type MockResult = { data?: unknown; error?: { message: string } | null };

let signupRequestResult: MockResult;
let existingMemberResult: MockResult;
let memberInsertResult: MockResult;
let requestUpdateResult: MockResult;
let workspaceDeleteResult: MockResult;
let teamDeleteResult: MockResult;
let createUserResult: MockResult;
let generateLinkResult: MockResult;
let deleteUserResult: MockResult;
let listUsersPages: Array<{ users: Array<{ id: string; email?: string }>; error?: { message: string } | null }>;
let operations: Array<
  | { table: string; method: "insert" | "update"; payload: unknown; filters?: Array<[string, unknown]> }
  | { table: string; method: "delete"; filters: Array<[string, unknown]> }
  | { table: "auth.users"; method: "createUser" | "generateLink"; payload: unknown }
  | { table: "auth.users"; method: "deleteUser"; id: string }
>;

function makeQuery(table: string) {
  const state = { method: "", payload: undefined as unknown, filters: [] as Array<[string, unknown]> };
  const builder: Record<string, unknown> = {};
  builder.select = vi.fn(() => builder);
  builder.insert = vi.fn((payload: unknown) => {
    state.method = "insert";
    state.payload = payload;
    return builder;
  });
  builder.update = vi.fn((payload: unknown) => {
    state.method = "update";
    state.payload = payload;
    return builder;
  });
  builder.delete = vi.fn(() => {
    state.method = "delete";
    return builder;
  });
  builder.eq = vi.fn((column: string, value: unknown) => {
    state.filters.push([column, value]);
    return builder;
  });
  builder.single = vi.fn(() => {
    if (table === "signup_requests") return Promise.resolve(signupRequestResult);
    if (table === "team_members" && state.method === "insert") {
      operations.push({ table, method: "insert", payload: state.payload });
      return Promise.resolve(memberInsertResult);
    }
    return Promise.resolve({ data: null, error: null });
  });
  builder.maybeSingle = vi.fn(() => {
    if (table === "team_members") return Promise.resolve(existingMemberResult);
    return Promise.resolve({ data: null, error: null });
  });
  builder.then = (resolve: (value: MockResult) => unknown, reject: (reason: unknown) => unknown) => {
    let result: MockResult = { data: null, error: null };
    if (state.method === "update") {
      operations.push({ table, method: "update", payload: state.payload, filters: state.filters });
      result = table === "signup_requests" ? requestUpdateResult : { data: null, error: null };
    } else if (state.method === "delete") {
      operations.push({ table, method: "delete", filters: state.filters });
      result = table === "workspace_members" ? workspaceDeleteResult : teamDeleteResult;
    }
    return Promise.resolve(result).then(resolve, reject);
  };
  return builder;
}

vi.mock("@/lib/auth/require", () => ({
  requireBearerTeamRole: vi.fn(() => Promise.resolve({
    user: { id: "admin-user" },
    email: "admin@example.com",
    role: "superadmin",
    workspaceId: "00000000-0000-0000-0000-000000000001",
  })),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    auth: {
      admin: {
        listUsers: vi.fn(({ page }: { page: number }) => {
          const entry = listUsersPages[page - 1] || { users: [] };
          return Promise.resolve({ data: { users: entry.users }, error: entry.error || null });
        }),
        createUser: vi.fn((payload: unknown) => {
          operations.push({ table: "auth.users", method: "createUser", payload });
          return Promise.resolve(createUserResult);
        }),
        generateLink: vi.fn((payload: unknown) => {
          operations.push({ table: "auth.users", method: "generateLink", payload });
          return Promise.resolve(generateLinkResult);
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
  process.env.NEXT_PUBLIC_SITE_URL = "https://thereach.ten80ten.com";
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  signupRequestResult = {
    data: {
      id: "request-1",
      name: "Hanes Abasola",
      email: " Hanes@Ten80Ten.com ",
      phone: "+639111111111",
      status: "pending",
    },
    error: null,
  };
  existingMemberResult = { data: null, error: null };
  memberInsertResult = { data: { id: "member-row-1" }, error: null };
  requestUpdateResult = { data: null, error: null };
  workspaceDeleteResult = { data: null, error: null };
  teamDeleteResult = { data: null, error: null };
  createUserResult = { data: { user: { id: "fresh-auth-user" } }, error: null };
  generateLinkResult = { data: { properties: { hashed_token: "hashed-token" } }, error: null };
  deleteUserResult = { data: null, error: null };
  listUsersPages = [{ users: [] }];
  operations = [];
});

describe("POST /api/team/approve-request", () => {
  it("approves only after auth, team row, and request status are reconciled", async () => {
    const res = await POST(makeRequest({ requestId: "request-1", action: "approve", role: "admin" }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      success: true,
      action: "approved",
      email: "hanes@ten80ten.com",
      emailSent: false,
      inviteUrl: "https://thereach.ten80ten.com/auth/confirm?token_hash=hashed-token&type=invite",
    });
    expect(operations).toEqual(expect.arrayContaining([
      {
        table: "auth.users",
        method: "createUser",
        payload: expect.objectContaining({ email: "hanes@ten80ten.com" }),
      },
      {
        table: "team_members",
        method: "insert",
        payload: expect.objectContaining({ email: "hanes@ten80ten.com", status: "pending", role: "admin" }),
      },
      {
        table: "signup_requests",
        method: "update",
        payload: expect.objectContaining({ status: "approved", reviewed_by: "admin@example.com" }),
        filters: [["id", "request-1"]],
      },
    ]));
  });

  it("rolls back newly-created invite state when request finalization fails", async () => {
    requestUpdateResult = { data: null, error: { message: "status write failed" } };

    const res = await POST(makeRequest({ requestId: "request-1", action: "approve", role: "approver" }));

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({ error: "Failed to finalize access request approval" });
    expect(operations).toEqual(expect.arrayContaining([
      { table: "team_members", method: "delete", filters: [["id", "member-row-1"]] },
      { table: "workspace_members", method: "delete", filters: [["user_id", "fresh-auth-user"]] },
      { table: "auth.users", method: "deleteUser", id: "fresh-auth-user" },
    ]));
  });

  it("does not create auth or team rows for invalid approval roles", async () => {
    const res = await POST(makeRequest({ requestId: "request-1", action: "approve", role: "superadmin" }));

    expect(res.status).toBe(400);
    expect(operations).toEqual([]);
  });

  it("returns a real error if rejecting cannot update the request", async () => {
    requestUpdateResult = { data: null, error: { message: "db down" } };

    const res = await POST(makeRequest({ requestId: "request-1", action: "reject" }));

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({ error: "Failed to reject request" });
  });
});
