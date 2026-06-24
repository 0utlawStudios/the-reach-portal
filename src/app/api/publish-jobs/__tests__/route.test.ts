// Contract-level tests for POST /api/publish-jobs.
//
// This route creates a publish job for an approved post. It must reject
// unauthenticated callers BEFORE doing any work. Other agents are actively
// changing the error-message text of this route, so these tests assert ONLY
// HTTP status codes — the stable contract — never response body strings.
//
//   no / invalid session → 401
//   authenticated but not a write-role workspace member → 403

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Configurable Supabase behavior, reset per test. ───────────────────────
type AuthResult = { data: { user: unknown }; error: unknown };
let callerGetUser: AuthResult;
let tableResults: Record<string, unknown>;
let rpcMock: ReturnType<typeof vi.fn>;

function makeQuery(table: string) {
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "limit"]) {
    builder[m] = vi.fn(() => builder);
  }
  builder.maybeSingle = vi.fn(() =>
    Promise.resolve(tableResults[table] ?? { data: null, error: null }),
  );
  return builder;
}

// The route builds two clients (caller + admin) via the same createClient.
// The caller client's getUser() is what gates auth; both share the from() mock.
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    auth: { getUser: vi.fn(() => Promise.resolve(callerGetUser)) },
    from: vi.fn((table: string) => makeQuery(table)),
    rpc: vi.fn((...args: unknown[]) => rpcMock(...args)),
  })),
}));

// Rate-limit always allows in these tests — auth is what we are asserting.
vi.mock("@/lib/rate-limit", () => ({
  consume: vi.fn(() =>
    Promise.resolve({ allowed: true, remaining: 30, resetAt: new Date() }),
  ),
  getClientIp: vi.fn(() => "1.2.3.4"),
}));

import { POST } from "../route";

const VALID_UUID = "44444444-4444-4444-8444-444444444444";
const WORKSPACE_A = "00000000-0000-0000-0000-000000000001";
const WORKSPACE_B = "11111111-1111-1111-1111-111111111111";

// Minimal NextRequest stand-in: route reads headers + json().
function makeRequest(headers: Record<string, string>, body: unknown = {}) {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return {
    headers: { get: (n: string) => lower[n.toLowerCase()] ?? null },
    json: () => Promise.resolve(body),
  } as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  callerGetUser = { data: { user: null }, error: null };
  tableResults = {};
  rpcMock = vi.fn(() => Promise.resolve({ data: { id: "job-1" }, error: null }));
});

describe("POST /api/publish-jobs — auth contract", () => {
  it("rejects an unauthenticated caller with 401 (no session)", async () => {
    callerGetUser = { data: { user: null }, error: null };
    const res = await POST(makeRequest({}, { postId: VALID_UUID }));
    expect(res.status).toBe(401);
  });

  it("rejects a caller whose getUser errors with 401", async () => {
    callerGetUser = { data: { user: null }, error: { message: "bad jwt" } };
    const res = await POST(
      makeRequest({ Authorization: "Bearer bad" }, { postId: VALID_UUID }),
    );
    expect(res.status).toBe(401);
  });
});

describe("POST /api/publish-jobs — authorization contract", () => {
  it("rejects an authenticated non-member with 403", async () => {
    callerGetUser = { data: { user: { id: "user-1" } }, error: null };
    // posts lookup returns a post; workspace_members lookup returns no row.
    tableResults = {
      posts: {
        data: { id: VALID_UUID, workspace_id: "ws-1", stage: "approved_scheduled" },
        error: null,
      },
      workspace_members: { data: null, error: null },
    };
    const res = await POST(
      makeRequest({ Authorization: "Bearer good" }, { postId: VALID_UUID }),
    );
    expect(res.status).toBe(403);
  });

  it("rejects an authenticated member whose role is not a write role with 403", async () => {
    callerGetUser = { data: { user: { id: "user-2" } }, error: null };
    tableResults = {
      posts: {
        data: { id: VALID_UUID, workspace_id: "ws-1", stage: "approved_scheduled" },
        error: null,
      },
      workspace_members: { data: { role: "viewer" }, error: null },
    };
    const res = await POST(
      makeRequest({ Authorization: "Bearer good" }, { postId: VALID_UUID }),
    );
    expect(res.status).toBe(403);
  });

  it("rejects a publish job when the post is outside the active workspace", async () => {
    callerGetUser = { data: { user: { id: "user-3" } }, error: null };
    tableResults = {
      posts: {
        data: {
          id: VALID_UUID,
          workspace_id: WORKSPACE_B,
          stage: "approved_scheduled",
          scheduled_at: "2026-06-25T12:00:00.000Z",
        },
        error: null,
      },
      workspace_members: { data: { role: "editor" }, error: null },
    };

    const res = await POST(
      makeRequest({ Authorization: "Bearer good", "X-Workspace-Id": WORKSPACE_A }, { postId: VALID_UUID }),
    );

    expect(res.status).toBe(403);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed active workspace header before creating a job", async () => {
    callerGetUser = { data: { user: { id: "user-4" } }, error: null };

    const res = await POST(
      makeRequest({ Authorization: "Bearer good", "X-Workspace-Id": "not-a-workspace" }, { postId: VALID_UUID }),
    );

    expect(res.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
