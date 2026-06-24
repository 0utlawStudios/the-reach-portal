import { beforeEach, describe, expect, it, vi } from "vitest";

type MockResult = { data?: unknown; error?: { message: string } | null };

let authUser: { id: string; email?: string } | null;
let tableResults: Record<string, MockResult | MockResult[]>;

function nextResult(value: MockResult | MockResult[] | undefined): MockResult {
  if (Array.isArray(value)) return value.shift() || { data: null, error: null };
  return value || { data: null, error: null };
}

function makeQuery(table: string) {
  const builder: Record<string, unknown> = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.limit = vi.fn(() => builder);
  builder.maybeSingle = vi.fn(() => Promise.resolve(nextResult(tableResults[table])));
  builder.then = (resolve: (value: MockResult) => unknown, reject: (reason: unknown) => unknown) => {
    const result = nextResult(tableResults[table]);
    const value = table === "workspace_members" && result.data && !Array.isArray(result.data)
      ? { ...result, data: [result.data] }
      : result;
    return Promise.resolve(value).then(resolve, reject);
  };
  return builder;
}

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn(() => Promise.resolve({
        data: { user: authUser },
        error: authUser ? null : { message: "bad token" },
      })),
    },
    from: vi.fn((table: string) => makeQuery(table)),
  })),
}));

import { requireBearerTeamRole } from "../require";

function makeRequest(token = "Bearer user-token", headers: Record<string, string> = {}) {
  return {
    headers: {
      get: (name: string) => {
        const lower = name.toLowerCase();
        if (lower === "authorization") return token;
        return headers[lower] || null;
      },
    },
  } as unknown as Parameters<typeof requireBearerTeamRole>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  authUser = { id: "user-1", email: "admin@example.com" };
  tableResults = {
    workspace_members: {
      data: {
        workspace_id: "00000000-0000-0000-0000-000000000001",
        role: "admin",
        status: "active",
      },
      error: null,
    },
    team_members: {
      data: {
        role: "admin",
        status: "active",
      },
      error: null,
    },
  };
});

describe("requireBearerTeamRole", () => {
  it("allows a caller with active workspace access and an active team profile", async () => {
    const result = await requireBearerTeamRole(makeRequest(), ["admin"]);
    expect(result).not.toHaveProperty("status");
    expect(result).toMatchObject({
      email: "admin@example.com",
      role: "admin",
      workspaceId: "00000000-0000-0000-0000-000000000001",
    });
  });

  it("rejects admin-role team rows that are not active", async () => {
    tableResults.team_members = {
      data: { role: "admin", status: "pending" },
      error: null,
    };

    const result = await requireBearerTeamRole(makeRequest(), ["admin"]);
    expect(result).toHaveProperty("status", 403);
  });

  it("rejects callers without active workspace membership", async () => {
    tableResults.workspace_members = { data: null, error: null };

    const result = await requireBearerTeamRole(makeRequest(), ["admin"]);
    expect(result).toHaveProperty("status", 403);
  });

  it("requires an explicit workspace when the caller has multiple active memberships", async () => {
    tableResults.workspace_members = {
      data: [
        { workspace_id: "00000000-0000-0000-0000-000000000001", role: "admin", status: "active" },
        { workspace_id: "11111111-1111-1111-1111-111111111111", role: "admin", status: "active" },
      ],
      error: null,
    };

    const result = await requireBearerTeamRole(makeRequest(), ["admin"]);
    expect(result).toHaveProperty("status", 409);
  });

  it("uses the requested workspace header when provided", async () => {
    const result = await requireBearerTeamRole(makeRequest("Bearer user-token", {
      "x-workspace-id": "00000000-0000-0000-0000-000000000001",
    }), ["admin"]);

    expect(result).not.toHaveProperty("status");
    expect(result).toMatchObject({ workspaceId: "00000000-0000-0000-0000-000000000001" });
  });
});
