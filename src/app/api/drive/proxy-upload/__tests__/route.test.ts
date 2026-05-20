// Contract-level tests for POST /api/drive/proxy-upload.
//
// SEC-001: this route streams bytes into the team's Google Drive. It was
// previously unauthenticated — anyone could write to the Drive folder. The
// Bearer-token gate must reject unauthenticated callers BEFORE any upload work.
//
// These tests assert ONLY HTTP status codes (the stable contract). Error
// message text is being changed by other agents in parallel.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Configurable Supabase auth, reset per test. ───────────────────────────
type AuthResult = { data: { user: unknown }; error: unknown };
let getUserResult: AuthResult;
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    auth: { getUser: vi.fn(() => Promise.resolve(getUserResult)) },
  })),
}));

// Rate-limit always allows — auth is what these tests assert.
vi.mock("@/lib/rate-limit", () => ({
  consume: vi.fn(() =>
    Promise.resolve({ allowed: true, remaining: 30, resetAt: new Date() }),
  ),
  getClientIp: vi.fn(() => "1.2.3.4"),
}));

// Google Drive layer — never actually called in the auth-rejection paths,
// mocked so an accidental reach does not hit the network.
vi.mock("@/lib/google-drive", () => ({
  getRootFolderId: vi.fn(() => "root-folder"),
  ensureSubfolder: vi.fn(() => Promise.resolve("sub-folder")),
  setPublicPermission: vi.fn(() => Promise.resolve()),
  getAccessToken: vi.fn(() => Promise.resolve("drive-token")),
}));

import { POST } from "../route";

function makeRequest(headers: Record<string, string>) {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return {
    headers: { get: (n: string) => lower[n.toLowerCase()] ?? null },
    formData: () => Promise.resolve(new FormData()),
  } as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  getUserResult = { data: { user: null }, error: null };
});

describe("POST /api/drive/proxy-upload — auth contract", () => {
  it("rejects a request with no Authorization header with 401", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(401);
  });

  it("rejects a request whose Bearer token fails getUser with 401", async () => {
    getUserResult = { data: { user: null }, error: { message: "invalid token" } };
    const res = await POST(makeRequest({ Authorization: "Bearer bad-token" }));
    expect(res.status).toBe(401);
  });

  it("rejects a request whose getUser resolves with no user with 401", async () => {
    getUserResult = { data: { user: null }, error: null };
    const res = await POST(makeRequest({ Authorization: "Bearer stale-token" }));
    expect(res.status).toBe(401);
  });

  it("does not return 2xx for any unauthenticated request", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
