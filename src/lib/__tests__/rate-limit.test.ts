// Tests for src/lib/rate-limit.ts.
//
// Two behaviors are load-bearing:
//   1. consume() defaults to FAIL OPEN so normal authenticated UX does not go
//      down during a rate-limit backend outage.
//   2. consume(..., { onError: "deny" }) must FAIL CLOSED for public or
//      abuse-prone endpoints such as auth and upload-session minting.
//   3. getClientIp() header precedence: cf-connecting-ip > x-forwarded-for
//      (first entry) > x-real-ip > "unknown".

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mock @supabase/supabase-js so consume()'s admin client is fully controlled.
// `rpcImpl` is swapped per-test to simulate success / error / throw / no-row.
const rpcImpl = vi.fn();
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    rpc: (...args: unknown[]) => rpcImpl(...args),
  })),
}));

import { consume, getClientIp } from "../rate-limit";

beforeEach(() => {
  rpcImpl.mockReset();
  // getAdminClient() throws unless both env vars are set — set them so the
  // mocked createClient (not the env guard) is what the test exercises.
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
});

describe("consume — happy path", () => {
  it("returns the RPC row when the backend allows the request", async () => {
    rpcImpl.mockResolvedValue({
      data: [{ allowed: true, remaining: 9, reset_at: "2026-06-15T00:00:00.000Z" }],
      error: null,
    });
    const result = await consume("test-scope", "1.2.3.4", 10, 60);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(9);
    expect(result.resetAt).toBeInstanceOf(Date);
  });

  it("returns allowed:false when the backend denies the request", async () => {
    rpcImpl.mockResolvedValue({
      data: [{ allowed: false, remaining: 0, reset_at: "2026-06-15T00:00:00.000Z" }],
      error: null,
    });
    const result = await consume("test-scope", "1.2.3.4", 10, 60);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("accepts a single-object RPC result (not wrapped in an array)", async () => {
    rpcImpl.mockResolvedValue({
      data: { allowed: false, remaining: 0, reset_at: "2026-06-15T00:00:00.000Z" },
      error: null,
    });
    const result = await consume("test-scope", "1.2.3.4", 10, 60);
    expect(result.allowed).toBe(false);
  });
});

describe("consume — FAIL OPEN on infrastructure failure", () => {
  it("returns allowed:true when the RPC returns an error", async () => {
    rpcImpl.mockResolvedValue({ data: null, error: { message: "relation does not exist" } });
    const result = await consume("test-scope", "1.2.3.4", 5, 60);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(5); // falls back to the full limit
  });

  it("returns allowed:true when the RPC throws (network / client exception)", async () => {
    rpcImpl.mockRejectedValue(new Error("network down"));
    const result = await consume("test-scope", "1.2.3.4", 7, 60);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(7);
  });

  it("returns allowed:true when the RPC returns no row", async () => {
    rpcImpl.mockResolvedValue({ data: [], error: null });
    const result = await consume("test-scope", "1.2.3.4", 3, 60);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(3);
  });

  it("returns allowed:true when admin credentials are missing (config error)", async () => {
    // getAdminClient() throws synchronously — consume()'s try/catch must still
    // fail open rather than letting the throw escape to the caller.
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const result = await consume("test-scope", "1.2.3.4", 4, 60);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
  });

  it("the fail-open resetAt is a future Date based on the window", async () => {
    rpcImpl.mockRejectedValue(new Error("boom"));
    const before = Date.now();
    const result = await consume("test-scope", "1.2.3.4", 5, 120);
    expect(result.resetAt.getTime()).toBeGreaterThanOrEqual(before + 120_000 - 5_000);
  });
});

describe("consume — FAIL CLOSED on protected infrastructure failure", () => {
  it("returns allowed:false when the RPC returns an error and onError=deny", async () => {
    rpcImpl.mockResolvedValue({ data: null, error: { message: "relation does not exist" } });
    const result = await consume("test-scope", "1.2.3.4", 5, 60, { onError: "deny" });
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("returns allowed:false when the RPC throws and onError=deny", async () => {
    rpcImpl.mockRejectedValue(new Error("network down"));
    const result = await consume("test-scope", "1.2.3.4", 7, 60, { onError: "deny" });
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("returns allowed:false when admin credentials are missing and onError=deny", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const result = await consume("test-scope", "1.2.3.4", 4, 60, { onError: "deny" });
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });
});

describe("getClientIp — header precedence", () => {
  function reqWith(headers: Record<string, string>): Request {
    return new Request("https://reach.example.com/api/x", { headers });
  }

  it("prefers cf-connecting-ip over everything else", () => {
    const ip = getClientIp(
      reqWith({
        "cf-connecting-ip": "9.9.9.9",
        "x-forwarded-for": "1.1.1.1, 2.2.2.2",
        "x-real-ip": "3.3.3.3",
      }),
    );
    expect(ip).toBe("9.9.9.9");
  });

  it("falls back to the FIRST entry of x-forwarded-for when cf is absent", () => {
    const ip = getClientIp(
      reqWith({ "x-forwarded-for": "1.1.1.1, 2.2.2.2", "x-real-ip": "3.3.3.3" }),
    );
    expect(ip).toBe("1.1.1.1");
  });

  it("falls back to x-real-ip when cf and x-forwarded-for are absent", () => {
    const ip = getClientIp(reqWith({ "x-real-ip": "3.3.3.3" }));
    expect(ip).toBe("3.3.3.3");
  });

  it("returns 'unknown' when no IP header is present", () => {
    const ip = getClientIp(reqWith({}));
    expect(ip).toBe("unknown");
  });

  it("trims whitespace around the resolved IP", () => {
    const ip = getClientIp(reqWith({ "cf-connecting-ip": "  4.4.4.4  " }));
    expect(ip).toBe("4.4.4.4");
  });

  it("trims whitespace around the first x-forwarded-for entry", () => {
    const ip = getClientIp(reqWith({ "x-forwarded-for": "  5.5.5.5  ,  6.6.6.6  " }));
    expect(ip).toBe("5.5.5.5");
  });
});

afterEach(() => {
  vi.clearAllMocks();
});
