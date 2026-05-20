// Contract-level tests for POST /api/notifications/mention.
//
// SEC-012: this route must require an authenticated caller — an anonymous
// client could otherwise enumerate team_members via crafted @mentions and
// send email on behalf of impersonated names. The auth gate is requireBearerUser.
//
// These tests assert ONLY HTTP status codes (the stable contract). Error
// message text is being changed by other agents in parallel.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

// ── Mock the auth helper. requireBearerUser returns either { user } or a
// NextResponse (the 401 to return directly). `authMode` flips per test. ────
let authMode: "unauth" | "ok";
vi.mock("@/lib/auth/require", () => ({
  requireBearerUser: vi.fn(() => {
    if (authMode === "unauth") {
      return Promise.resolve(
        NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      );
    }
    return Promise.resolve({ user: { id: "user-1", email: "caller@ten80ten.com" } });
  }),
}));

// Supabase admin client — only reached after auth passes.
function makeQuery() {
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "ilike", "in"]) builder[m] = vi.fn(() => builder);
  builder.maybeSingle = vi.fn(() => Promise.resolve({ data: null, error: null }));
  // `.in(...)` is awaited directly for the mentioned-members lookup.
  builder.then = (resolve: (v: unknown) => unknown) =>
    resolve({ data: [], error: null });
  return builder;
}
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    from: vi.fn(() => makeQuery()),
    rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
  })),
}));

// Rate-limit always allows — auth is what these tests assert.
vi.mock("@/lib/rate-limit", () => ({
  consume: vi.fn(() =>
    Promise.resolve({ allowed: true, remaining: 10, resetAt: new Date() }),
  ),
  getClientIp: vi.fn(() => "1.2.3.4"),
}));

// Email layer — never actually send.
vi.mock("@/lib/email-utils", () => ({
  getTransporter: vi.fn(() => ({ sendMail: vi.fn(() => Promise.resolve()) })),
  getFromAddress: vi.fn(() => "noreply@ten80ten.com"),
  esc: (v: unknown) => String(v ?? ""),
  safeSubject: (v: unknown) => String(v ?? ""),
}));

import { POST } from "../route";

function makeRequest(headers: Record<string, string>, body: unknown) {
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
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  authMode = "unauth";
});

describe("POST /api/notifications/mention — auth contract", () => {
  it("rejects an unauthenticated caller with 401", async () => {
    authMode = "unauth";
    const res = await POST(
      makeRequest({}, { comment: "@Jane look", postTitle: "Post", postId: "p1" }),
    );
    expect(res.status).toBe(401);
  });

  it("does NOT reach a 2xx response when the caller is unauthenticated", async () => {
    authMode = "unauth";
    const res = await POST(
      makeRequest({ Authorization: "Bearer bad" }, { comment: "@Jane", postTitle: "P" }),
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe("POST /api/notifications/mention — authenticated request proceeds past auth", () => {
  it("an authenticated caller is NOT blocked by the 401 gate", async () => {
    authMode = "ok";
    const res = await POST(
      makeRequest(
        { Authorization: "Bearer good" },
        { comment: "no mentions here", postTitle: "Post", postId: "p1" },
      ),
    );
    // Past the auth gate the contract is "not a 401". The exact 2xx/4xx shape
    // depends on downstream logic other agents may change.
    expect(res.status).not.toBe(401);
  });
});
