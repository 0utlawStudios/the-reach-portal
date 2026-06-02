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

function makeRequest(token = "Bearer user-token") {
  return {
    headers: { get: (name: string) => (name.toLowerCase() === "authorization" ? token : null) },
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
});
