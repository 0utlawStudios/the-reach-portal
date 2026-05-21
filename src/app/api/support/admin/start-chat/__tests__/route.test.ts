import { beforeEach, describe, expect, it, vi } from "vitest";

type MockResult = { data?: unknown; error?: { message: string } | null };

let actor = { user: { id: "admin-1" }, email: "admin@example.com", role: "superadmin" };
let rpcResult: MockResult;
let teamMemberResult: MockResult;
let workspaceUpsertResult: MockResult;
let listUsersPages: Array<{ users: Array<{ id: string; email?: string }>; error?: { message: string } | null }>;
let operations: Array<{ table: string; method: string; payload?: unknown; options?: unknown; filters: Array<[string, unknown]> }>;

function makeQuery(table: string) {
  const state = { filters: [] as Array<[string, unknown]> };
  const builder: Record<string, unknown> = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn((column: string, value: unknown) => {
    state.filters.push([column, value]);
    return builder;
  });
  builder.maybeSingle = vi.fn(() => Promise.resolve(table === "team_members" ? teamMemberResult : { data: null, error: null }));
  builder.upsert = vi.fn((payload: unknown, options?: unknown) => {
    operations.push({ table, method: "upsert", payload, options, filters: [] });
    return Promise.resolve(workspaceUpsertResult);
  });
  return builder;
}

const adminClient = {
  auth: {
    admin: {
      listUsers: vi.fn(({ page }: { page: number }) => {
        const entry = listUsersPages[page - 1] || { users: [] };
        return Promise.resolve({ data: { users: entry.users }, error: entry.error || null });
      }),
    },
  },
  from: vi.fn((table: string) => makeQuery(table)),
  rpc: vi.fn(() => Promise.resolve(rpcResult)),
};

vi.mock("@/lib/auth/require", () => ({
  requireBearerTeamRole: vi.fn(() => Promise.resolve(actor)),
}));

vi.mock("@/lib/rate-limit", () => ({
  consume: vi.fn(() => Promise.resolve({ allowed: true })),
}));

vi.mock("@/lib/support/server", () => ({
  getSupportAdminClient: vi.fn(() => adminClient),
  resolveWorkspaceId: vi.fn(() => Promise.resolve("00000000-0000-0000-0000-000000000001")),
  resolveUserName: vi.fn(() => Promise.resolve("Alex Nicholson")),
  getOrCreateChatThread: vi.fn(() => Promise.resolve({
    id: "11111111-1111-4111-8111-111111111111",
    workspace_id: "00000000-0000-0000-0000-000000000001",
    created_by: "user-1",
    created_by_email: "alex@example.com",
    created_by_name: "Alex Nicholson",
    kind: "chat",
    subject: "Live chat",
    category: null,
    status: "open",
    last_message_at: "2026-05-21T00:00:00.000Z",
    last_sender_type: null,
    unread_for_user: false,
    unread_for_admin: false,
    last_user_notified_at: null,
    last_admin_notified_at: null,
    user_last_read_at: null,
    admin_last_read_at: null,
    created_at: "2026-05-21T00:00:00.000Z",
    updated_at: "2026-05-21T00:00:00.000Z",
  })),
}));

import { POST } from "../route";

function makeRequest(email: string) {
  return {
    headers: { get: () => "Bearer admin-token" },
    json: () => Promise.resolve({ email }),
  } as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  actor = { user: { id: "admin-1" }, email: "admin@example.com", role: "superadmin" };
  rpcResult = { data: null, error: null };
  teamMemberResult = { data: { role: "admin", status: "active" }, error: null };
  workspaceUpsertResult = { data: null, error: null };
  listUsersPages = [{ users: [{ id: "user-1", email: "alex@example.com" }] }];
  operations = [];
});

describe("POST /api/support/admin/start-chat", () => {
  it("self-heals an active team member missing workspace_members before starting chat", async () => {
    const res = await POST(makeRequest("Alex@Example.com"));
    expect(res.status).toBe(200);
    expect(operations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        table: "workspace_members",
        method: "upsert",
        payload: expect.objectContaining({
          workspace_id: "00000000-0000-0000-0000-000000000001",
          user_id: "user-1",
          role: "admin",
          status: "active",
        }),
        options: { onConflict: "workspace_id,user_id" },
      }),
    ]));
  });

  it("does not self-heal a pending invite", async () => {
    teamMemberResult = { data: { role: "admin", status: "pending" }, error: null };
    const res = await POST(makeRequest("alex@example.com"));
    expect(res.status).toBe(400);
    expect(operations).toEqual([]);
    const body = await res.json();
    expect(body.error).toContain("has not activated");
  });
});
