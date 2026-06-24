import { beforeEach, describe, expect, it, vi } from "vitest";

type MockResult = { data?: unknown; error?: { message: string } | null };
type TeamMemberMock = { id: string; name: string; email: string; role: string; status: "active" | "pending" };

let actor = { user: { id: "user-1" }, email: "member@example.com", role: "social_media_specialist", workspaceId: "workspace-1" };
let users: Array<{ id: string; email?: string; user_metadata?: Record<string, unknown> }>;
let createUserResult: MockResult;
let generateLinkResult: MockResult;
let deleteUserResult: MockResult;
let updateUserResults: MockResult[];
let tableResults: Record<string, {
  maybeSingle?: MockResult | MockResult[];
  update?: MockResult | MockResult[];
  delete?: MockResult | MockResult[];
}>;
let operations: Array<
  | { table: string; method: string; payload?: unknown; filters: Array<[string, unknown]> }
  | { table: "auth.users"; method: string; id?: string; payload?: unknown }
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
  builder.delete = vi.fn(() => {
    state.method = "delete";
    return builder;
  });
  builder.eq = vi.fn((column: string, value: unknown) => {
    state.filters.push([column, value]);
    return builder;
  });
  builder.maybeSingle = vi.fn(() => Promise.resolve(nextResult(cfg.maybeSingle)));
  builder.then = (resolve: (value: MockResult) => unknown, reject: (reason: unknown) => unknown) => {
    const result = state.method === "update" ? nextResult(cfg.update) : state.method === "delete" ? nextResult(cfg.delete) : { data: null, error: null };
    operations.push({ table, method: state.method, payload: state.payload, filters: state.filters });
    return Promise.resolve(result).then(resolve, reject);
  };
  return builder;
}

vi.mock("@/lib/auth/require", () => ({
  requireBearerTeamRole: vi.fn(() => Promise.resolve(actor)),
}));

vi.mock("@/lib/email-utils", () => ({
  getTransporter: vi.fn(() => ({ sendMail: vi.fn(() => Promise.resolve()) })),
  getFromAddress: vi.fn(() => "The Reach <hello@example.com>"),
  getSiteUrl: vi.fn(() => "https://thereach.ten80ten.com"),
  buildInviteEmailHtml: vi.fn((_name: string, _role: string, url: string) => `<a href="${url}">Invite</a>`),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    auth: {
      admin: {
        listUsers: vi.fn(() => Promise.resolve({ data: { users }, error: null })),
        updateUserById: vi.fn((id: string, payload: unknown) => {
          operations.push({ table: "auth.users", method: "updateUserById", id, payload });
          return Promise.resolve(updateUserResults.shift() || { data: { user: { id } }, error: null });
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

function activeMember(overrides: Partial<TeamMemberMock> = {}): TeamMemberMock {
  return {
    id: "member-row-1",
    name: "Stored Member",
    email: "member@example.com",
    role: "social_media_specialist",
    status: "active",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  process.env.NEXT_PUBLIC_SITE_URL = "https://thereach.ten80ten.com";
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  actor = { user: { id: "user-1" }, email: "member@example.com", role: "social_media_specialist", workspaceId: "workspace-1" };
  users = [{ id: "user-1", email: "member@example.com", user_metadata: { name: "Stored Member" } }];
  createUserResult = { data: { user: { id: "new-pending-user" } }, error: null };
  generateLinkResult = { data: { properties: { hashed_token: "hashed-token" } }, error: null };
  deleteUserResult = { data: null, error: null };
  updateUserResults = [{ data: { user: { id: "user-1" } }, error: null }];
  tableResults = {
    team_members: {
      maybeSingle: [
        { data: activeMember(), error: null },
        { data: null, error: null },
      ],
      update: { data: null, error: null },
    },
    support_threads: { update: { data: null, error: null } },
    posts: { update: { data: null, error: null } },
    media_assets: { update: { data: null, error: null } },
    workspace_members: { delete: { data: null, error: null } },
  };
  operations = [];
});

describe("POST /api/team/change-email", () => {
  it("changes an active user's own Auth email and reconciles app identity rows", async () => {
    const res = await POST(makeRequest({ memberId: "member-row-1", newEmail: " New@Example.com " }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      success: true,
      email: "new@example.com",
      requiresSignIn: true,
    });
    expect(operations).toEqual(expect.arrayContaining([
      {
        table: "auth.users",
        method: "updateUserById",
        id: "user-1",
        payload: expect.objectContaining({ email: "new@example.com", email_confirm: true }),
      },
      {
        table: "team_members",
        method: "update",
        payload: { email: "new@example.com" },
        filters: [["id", "member-row-1"]],
      },
      {
        table: "support_threads",
        method: "update",
        payload: { created_by_email: "new@example.com" },
        filters: [["created_by", "user-1"], ["workspace_id", "workspace-1"]],
      },
      {
        table: "posts",
        method: "update",
        payload: { created_by: "Stored Member" },
        filters: [["created_by", "member@example.com"], ["workspace_id", "workspace-1"]],
      },
      {
        table: "media_assets",
        method: "update",
        payload: { added_by: "Stored Member" },
        filters: [["added_by", "member@example.com"], ["workspace_id", "workspace-1"]],
      },
      {
        table: "rpc",
        method: "rpc",
        name: "record_audit_event",
        payload: expect.objectContaining({ p_action: "member_email_changed" }),
      },
    ]));
  });

  it("rejects duplicate team emails before touching Auth", async () => {
    tableResults.team_members.maybeSingle = [
      { data: activeMember(), error: null },
      { data: { id: "other-member" }, error: null },
    ];

    const res = await POST(makeRequest({ memberId: "member-row-1", newEmail: "taken@example.com" }));

    expect(res.status).toBe(409);
    expect(operations.some((op) => op.table === "auth.users")).toBe(false);
  });

  it("rejects active non-self changes to avoid breaking another live session", async () => {
    actor = { user: { id: "admin-1" }, email: "admin@example.com", role: "admin", workspaceId: "workspace-1" };
    users = [{ id: "user-2", email: "member@example.com" }];

    const res = await POST(makeRequest({ memberId: "member-row-1", newEmail: "new@example.com" }));

    expect(res.status).toBe(409);
    expect(operations.some((op) => op.table === "auth.users" && op.method === "updateUserById")).toBe(false);
  });

  it("regenerates a pending invite at the new email and invalidates the old auth user", async () => {
    actor = { user: { id: "admin-1" }, email: "admin@example.com", role: "admin", workspaceId: "workspace-1" };
    users = [{ id: "old-pending-user", email: "pending@example.com" }];
    tableResults.team_members.maybeSingle = [
      { data: activeMember({ email: "pending@example.com", status: "pending", role: "approver" }), error: null },
      { data: null, error: null },
    ];

    const res = await POST(makeRequest({
      memberId: "member-row-1",
      newEmail: "fresh@example.com",
      name: "Fresh Invite",
      role: "creative_director",
    }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      success: true,
      email: "fresh@example.com",
      emailSent: false,
      inviteUrl: "https://thereach.ten80ten.com/auth/confirm?token_hash=hashed-token&type=invite",
    });
    expect(operations).toEqual(expect.arrayContaining([
      {
        table: "auth.users",
        method: "createUser",
        payload: expect.objectContaining({
          email: "fresh@example.com",
          email_confirm: false,
          user_metadata: { name: "Fresh Invite", role: "creative_director" },
        }),
      },
      {
        table: "team_members",
        method: "update",
        payload: { email: "fresh@example.com", name: "Fresh Invite", role: "creative_director" },
        filters: [["id", "member-row-1"]],
      },
      { table: "workspace_members", method: "delete", filters: [["user_id", "old-pending-user"], ["workspace_id", "workspace-1"]] },
      { table: "auth.users", method: "deleteUser", id: "old-pending-user" },
    ]));
  });

  it("rolls Auth back when the active team update fails", async () => {
    updateUserResults = [
      { data: { user: { id: "user-1" } }, error: null },
      { data: { user: { id: "user-1" } }, error: null },
    ];
    tableResults.team_members.update = { data: null, error: { message: "db unavailable" } };

    const res = await POST(makeRequest({ memberId: "member-row-1", newEmail: "new@example.com" }));

    expect(res.status).toBe(500);
    const authUpdates = operations.filter((op) => op.table === "auth.users" && op.method === "updateUserById");
    expect(authUpdates).toHaveLength(2);
    expect(authUpdates[0]).toMatchObject({ payload: expect.objectContaining({ email: "new@example.com" }) });
    expect(authUpdates[1]).toMatchObject({ payload: expect.objectContaining({ email: "member@example.com" }) });
  });
});
