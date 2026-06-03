import { beforeEach, describe, expect, it, vi } from "vitest";

type MockResult = { data?: unknown; error?: { message: string } | null };

let teamMember: { id: string; name: string; role: string; status: string } | null;
let listUsersPages: Array<{ users: Array<{ id: string; email?: string }>; error?: { message: string } | null }>;
let operations: Array<
  | { table: string; method: string; filters: Array<[string, unknown]> }
  | { table: "auth.users"; method: string; payload: unknown }
  | { table: "auth.users"; method: "deleteUser"; id: string }
>;

function makeQuery(table: string) {
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
  builder.single = vi.fn(() => {
    if (table === "team_members") return Promise.resolve({ data: teamMember, error: null });
    return Promise.resolve({ data: null, error: null });
  });
  builder.then = (resolve: (value: MockResult) => unknown, reject: (reason: unknown) => unknown) => {
    return Promise.resolve({ data: null, error: null }).then(resolve, reject);
  };
  return builder;
}

vi.mock("@/lib/auth/require", () => ({
  requireBearerTeamRole: vi.fn(() => Promise.resolve({ user: { id: "admin-1" }, email: "admin@example.com", role: "admin", workspaceId: "workspace-1" })),
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
          return Promise.resolve({ data: null, error: null });
        }),
        createUser: vi.fn((payload: unknown) => {
          operations.push({ table: "auth.users", method: "createUser", payload });
          return Promise.resolve({ data: { user: { id: "fresh-user" } }, error: null });
        }),
        generateLink: vi.fn((payload: unknown) => {
          operations.push({ table: "auth.users", method: "generateLink", payload });
          return Promise.resolve({ data: { properties: { hashed_token: "hashed-token" } }, error: null });
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
  teamMember = { id: "member-row-1", name: "Stored Name", role: "approver", status: "pending" };
  listUsersPages = [{ users: [{ id: "old-auth-user", email: "member@example.com" }] }];
  operations = [];
});

describe("POST /api/team/resend-invite", () => {
  it("uses the pending member row and cleans stale workspace access before recreating the invite user", async () => {
    const res = await POST(makeRequest({
      email: " Member@Example.com ",
      name: "Body Name",
      role: "admin",
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      success: true,
      emailSent: false,
      inviteUrl: "https://thereach.ten80ten.com/auth/confirm?token_hash=hashed-token&type=invite",
    });
    expect(operations).toEqual(expect.arrayContaining([
      { table: "workspace_members", method: "delete", filters: [["user_id", "old-auth-user"]] },
      { table: "auth.users", method: "deleteUser", id: "old-auth-user" },
      {
        table: "auth.users",
        method: "createUser",
        payload: expect.objectContaining({
          email: "member@example.com",
          user_metadata: { name: "Stored Name", role: "approver" },
        }),
      },
      {
        table: "auth.users",
        method: "generateLink",
        payload: expect.objectContaining({
          email: "member@example.com",
          options: { data: { name: "Stored Name", role: "approver" } },
        }),
      },
    ]));
  });

  it("does not recreate auth users for already-active members", async () => {
    teamMember = { id: "member-row-1", name: "Stored Name", role: "approver", status: "active" };

    const res = await POST(makeRequest({ email: "member@example.com" }));

    expect(res.status).toBe(409);
    expect(operations).toEqual([]);
  });
});
