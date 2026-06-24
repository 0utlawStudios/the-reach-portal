import { beforeEach, describe, expect, it, vi } from "vitest";

type MockResult = { data?: unknown; error?: { message: string } | null };
type TableConfig = {
  select?: MockResult | MockResult[];
  maybeSingle?: MockResult;
  update?: MockResult | MockResult[];
  upsert?: MockResult;
};

let getUserResult: { data: { user: { id?: string; email?: string; user_metadata?: Record<string, unknown> } | null }; error: unknown };
let authUpdateResult: MockResult;
let tableResults: Record<string, TableConfig>;
let operations: Array<{
  table: string;
  method: string;
  payload?: unknown;
  options?: unknown;
  filters: Array<[string, unknown]>;
}>;

function nextResult(value: MockResult | MockResult[] | undefined): MockResult {
  if (Array.isArray(value)) return value.shift() || { data: null, error: null };
  return value || { data: null, error: null };
}

function makeQuery(table: string) {
  const cfg = tableResults[table] || {};
  const state = {
    method: "",
    payload: undefined as unknown,
    filters: [] as Array<[string, unknown]>,
  };
  const builder: Record<string, unknown> = {};
  builder.select = vi.fn(() => {
    if (!state.method) state.method = "select";
    return builder;
  });
  builder.eq = vi.fn((column: string, value: unknown) => {
    state.filters.push([column, value]);
    return builder;
  });
  builder.limit = vi.fn(() => builder);
  builder.order = vi.fn(() => builder);
  builder.update = vi.fn((payload: unknown) => {
    state.method = "update";
    state.payload = payload;
    operations.push({ table, method: "update", payload, filters: state.filters });
    return builder;
  });
  builder.maybeSingle = vi.fn(() => Promise.resolve(cfg.maybeSingle || { data: null, error: null }));
  builder.upsert = vi.fn((payload: unknown, options?: unknown) => {
    operations.push({ table, method: "upsert", payload, options, filters: [] });
    return Promise.resolve(cfg.upsert || { data: null, error: null });
  });
  builder.then = (resolve: (value: MockResult) => unknown, reject: (reason: unknown) => unknown) => {
    const value = state.method === "update" ? nextResult(cfg.update) : nextResult(cfg.select);
    return Promise.resolve(value).then(resolve, reject);
  };
  return builder;
}

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn(() => Promise.resolve(getUserResult)),
      admin: {
        updateUserById: vi.fn(() => Promise.resolve(authUpdateResult)),
      },
    },
    from: vi.fn((table: string) => makeQuery(table)),
    rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
  })),
}));

import { POST } from "../route";

function makeRequest(body: Record<string, unknown>, authorization = "Bearer good-token", workspaceId?: string) {
  return {
    headers: {
      get: (name: string) => {
        const lower = name.toLowerCase();
        if (lower === "authorization") return authorization;
        if (lower === "x-workspace-id") return workspaceId || null;
        return null;
      },
    },
    json: () => Promise.resolve(body),
  } as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  getUserResult = {
    data: { user: { id: "user-1", email: "ace@example.com", user_metadata: {} } },
    error: null,
  };
  authUpdateResult = { data: null, error: null };
  tableResults = {
    team_members: {
      select: {
        data: [{ id: "member-1", workspace_id: "00000000-0000-0000-0000-000000000001", role: "social_media_specialist", status: "pending", avatar_url: null }],
        error: null,
      },
      update: { data: null, error: null },
    },
    workspace_members: {
      select: { data: [], error: null },
      upsert: { data: null, error: null },
    },
  };
  operations = [];
});

describe("POST /api/auth/complete-setup", () => {
  it("requires a Bearer token", async () => {
    const res = await POST(makeRequest({ name: "Ace Creatives" }, ""));
    expect(res.status).toBe(401);
  });

  it("activates the team row and upserts active workspace membership", async () => {
    const res = await POST(makeRequest({
      name: "Ace Creatives",
      phone: "+63 915 495 4549",
      avatarUrl: "https://test.supabase.co/storage/v1/object/public/avatars/profiles/user-1/ace.png",
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.workspaceId).toBe("00000000-0000-0000-0000-000000000001");

    expect(operations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        table: "team_members",
        method: "update",
        payload: expect.objectContaining({
          status: "active",
          name: "Ace Creatives",
          phone: "+639154954549",
          avatar_url: "https://test.supabase.co/storage/v1/object/public/avatars/profiles/user-1/ace.png",
        }),
      }),
      expect.objectContaining({
        table: "workspace_members",
        method: "upsert",
        payload: expect.objectContaining({
          workspace_id: "00000000-0000-0000-0000-000000000001",
          user_id: "user-1",
          role: "social_media_specialist",
          status: "active",
        }),
        options: { onConflict: "workspace_id,user_id" },
      }),
    ]));
  });

  it("rejects setup when the invitation is missing", async () => {
    tableResults.team_members = { select: { data: [], error: null } };
    const res = await POST(makeRequest({ name: "Ace Creatives" }));
    expect(res.status).toBe(403);
  });

  it("requires a safe profile photo before activation when no avatar exists", async () => {
    const res = await POST(makeRequest({ name: "Ace Creatives", avatarUrl: "javascript:alert(1)" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Profile photo is required");
    expect(operations.some((op) => op.table === "workspace_members" && op.method === "upsert")).toBe(false);
  });

  it("requires the setup photo to be uploaded under the authenticated user's profile path", async () => {
    const res = await POST(makeRequest({
      name: "Ace Creatives",
      avatarUrl: "https://test.supabase.co/storage/v1/object/public/avatars/profiles/other-user/ace.png",
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Profile photo is required");
    expect(operations.some((op) => op.table === "workspace_members" && op.method === "upsert")).toBe(false);
  });

  it("allows setup without a new avatar when the member already has a profile photo", async () => {
    tableResults.team_members.select = {
      data: [{
        id: "member-1",
        workspace_id: "00000000-0000-0000-0000-000000000001",
        role: "social_media_specialist",
        status: "active",
        avatar_url: "https://test.supabase.co/storage/v1/object/public/avatars/existing.png",
      }],
      error: null,
    };
    const res = await POST(makeRequest({ name: "Ace Creatives" }));
    expect(res.status).toBe(200);
    const teamUpdate = operations.find((op) => op.table === "team_members" && op.method === "update");
    expect(teamUpdate?.payload).not.toHaveProperty("avatar_url");
  });

  it("rejects ambiguous email-only invitations without workspace context", async () => {
    tableResults.team_members.select = {
      data: [
        { id: "member-1", workspace_id: "00000000-0000-0000-0000-000000000001", role: "admin", status: "pending", avatar_url: null },
        { id: "member-2", workspace_id: "11111111-1111-1111-1111-111111111111", role: "admin", status: "pending", avatar_url: null },
      ],
      error: null,
    };
    const res = await POST(makeRequest({
      name: "Ace Creatives",
      avatarUrl: "https://test.supabase.co/storage/v1/object/public/avatars/profiles/user-1/ace.png",
    }));
    expect(res.status).toBe(409);
    expect(operations.some((op) => op.table === "workspace_members" && op.method === "upsert")).toBe(false);
  });

  it("uses explicit workspace context when activating a matching invite", async () => {
    const workspaceId = "11111111-1111-1111-1111-111111111111";
    tableResults.team_members.select = {
      data: [{ id: "member-2", workspace_id: workspaceId, role: "admin", status: "pending", avatar_url: null }],
      error: null,
    };
    const res = await POST(makeRequest({
      name: "Ace Creatives",
      avatarUrl: "https://test.supabase.co/storage/v1/object/public/avatars/profiles/user-1/ace.png",
      workspaceId,
    }, "Bearer good-token", workspaceId));
    expect(res.status).toBe(200);
    expect(operations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        table: "team_members",
        method: "update",
        filters: expect.arrayContaining([["workspace_id", workspaceId]]),
      }),
      expect.objectContaining({
        table: "workspace_members",
        method: "upsert",
        payload: expect.objectContaining({ workspace_id: workspaceId }),
      }),
    ]));
  });
});
