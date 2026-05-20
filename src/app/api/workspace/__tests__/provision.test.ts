// Contract-level tests for the GET handler of /api/workspace/provision.
//
// This route is the self-healing workspace provisioner — it runs on every app
// load and is the gate that keeps RLS from making a user's posts "vanish".
// These tests assert STABLE CONTRACTS (HTTP status + presence of a workspaceId)
// — never exact error strings, since error copy is changed by other agents.
//
//   no Authorization header        → 401
//   token whose getUser errors     → 401
//   valid user, no team_members row → 403
//   valid pending team member       → 403 and no workspaceId
//   valid active team member        → 200 + { workspaceId }

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Configurable behaviors, reset per test. ───────────────────────────────
type GetUserResult = { data: { user: unknown }; error: unknown };
let getUserResult: GetUserResult;
// Keyed by table name → the resolved value for that table's terminal call.
let tableResults: Record<string, { maybeSingle?: unknown; upsert?: unknown }>;

// ── Chainable Supabase query-builder mock. Every filter/select method returns
// `this`; terminal methods resolve with the per-table configured value. ─────
function makeQuery(table: string) {
  const cfg = tableResults[table] || {};
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq", "ilike", "limit", "order", "in"]) {
    builder[m] = vi.fn(() => builder);
  }
  builder.maybeSingle = vi.fn(() =>
    Promise.resolve(cfg.maybeSingle ?? { data: null, error: null }),
  );
  builder.upsert = vi.fn(() =>
    Promise.resolve(cfg.upsert ?? { data: null, error: null }),
  );
  return builder;
}

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn(() => Promise.resolve(getUserResult)),
    },
    from: vi.fn((table: string) => makeQuery(table)),
  })),
}));

import { GET } from "../provision/route";

// Minimal NextRequest stand-in: the route only reads `.headers.get(...)`.
function makeRequest(headers: Record<string, string> = {}) {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return {
    headers: { get: (name: string) => lower[name.toLowerCase()] ?? null },
  } as unknown as Parameters<typeof GET>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  getUserResult = { data: { user: null }, error: null };
  tableResults = {};
});

describe("GET /api/workspace/provision — auth contract", () => {
  it("returns 401 when no Authorization header is present", async () => {
    const res = await GET(makeRequest({}));
    expect(res.status).toBe(401);
  });

  it("returns 401 when the token's getUser call errors", async () => {
    getUserResult = { data: { user: null }, error: { message: "invalid token" } };
    const res = await GET(makeRequest({ Authorization: "Bearer bad-token" }));
    expect(res.status).toBe(401);
  });

  it("returns 401 when getUser resolves with no user", async () => {
    getUserResult = { data: { user: null }, error: null };
    const res = await GET(makeRequest({ Authorization: "Bearer stale-token" }));
    expect(res.status).toBe(401);
  });
});

describe("GET /api/workspace/provision — membership contract", () => {
  it("returns 403 for a valid user with no team_members row", async () => {
    getUserResult = {
      data: { user: { id: "user-1", email: "nobody@ten80ten.com" } },
      error: null,
    };
    // workspace_members lookup → not a member; team_members lookup → no row.
    tableResults = {
      workspace_members: { maybeSingle: { data: null, error: null } },
      team_members: { maybeSingle: { data: null, error: null } },
    };
    const res = await GET(makeRequest({ Authorization: "Bearer good-token" }));
    expect(res.status).toBe(403);
  });

  it("returns 403 for a team_members row with an empty role", async () => {
    getUserResult = {
      data: { user: { id: "user-2", email: "norole@ten80ten.com" } },
      error: null,
    };
    tableResults = {
      workspace_members: { maybeSingle: { data: null, error: null } },
      team_members: { maybeSingle: { data: { role: "", status: "active" }, error: null } },
    };
    const res = await GET(makeRequest({ Authorization: "Bearer good-token" }));
    expect(res.status).toBe(403);
  });

  it("returns 200 + workspaceId for an existing active workspace member", async () => {
    getUserResult = {
      data: { user: { id: "user-3", email: "member@ten80ten.com" } },
      error: null,
    };
    tableResults = {
      workspace_members: {
        maybeSingle: {
          data: { workspace_id: "00000000-0000-0000-0000-000000000001", status: "active" },
          error: null,
        },
      },
    };
    const res = await GET(makeRequest({ Authorization: "Bearer good-token" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.workspaceId).toBe("00000000-0000-0000-0000-000000000001");
  });

  it("returns 403 and no workspaceId for a pending invite", async () => {
    getUserResult = {
      data: { user: { id: "user-4", email: "pending@ten80ten.com" } },
      error: null,
    };
    tableResults = {
      workspace_members: {
        maybeSingle: { data: { workspace_id: "00000000-0000-0000-0000-000000000001", status: "pending" }, error: null },
      },
      team_members: {
        maybeSingle: { data: { role: "social_media_specialist", status: "pending" }, error: null },
      },
    };
    const res = await GET(makeRequest({ Authorization: "Bearer pending-token" }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.workspaceId).toBeUndefined();
    expect(body.status).toBe("pending");
  });

  it("returns 200 + workspaceId after provisioning a new active team member", async () => {
    getUserResult = {
      data: { user: { id: "user-5", email: "newhire@ten80ten.com" } },
      error: null,
    };
    // Not yet a workspace member, but has an active team_members row →
    // the route upserts membership and returns 200.
    tableResults = {
      workspace_members: {
        maybeSingle: { data: null, error: null },
        upsert: { data: null, error: null },
      },
      team_members: {
        maybeSingle: { data: { role: "editor", status: "active" }, error: null },
      },
    };
    const res = await GET(makeRequest({ Authorization: "Bearer good-token" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.workspaceId).toBe("string");
    expect(body.workspaceId.length).toBeGreaterThan(0);
  });

  it("promotes a stale pending workspace_members row when team_members is active", async () => {
    getUserResult = {
      data: { user: { id: "user-6", email: "retry@ten80ten.com" } },
      error: null,
    };
    tableResults = {
      workspace_members: {
        maybeSingle: { data: { workspace_id: "00000000-0000-0000-0000-000000000001", status: "pending" }, error: null },
        upsert: { data: null, error: null },
      },
      team_members: {
        maybeSingle: { data: { role: "social_media_specialist", status: "active" }, error: null },
      },
    };
    const res = await GET(makeRequest({ Authorization: "Bearer retry-token" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.workspaceId).toBe("00000000-0000-0000-0000-000000000001");
    expect(body.provisioned).toBe(true);
  });
});
