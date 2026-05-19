// Tests for src/lib/utils.ts — focus on isValidUuid, the most load-bearing
// guard in this codebase (AGENTS.md §5). A bug here would let temp-id strings
// reach Supabase and produce 400s that trigger the rollback, snapping cards
// back on every move/update.

import { describe, it, expect } from "vitest";
import { isValidUuid, APP_TIMEZONE } from "../utils";

describe("isValidUuid", () => {
  it("accepts a canonical v4 UUID", () => {
    expect(isValidUuid("4d3e7c1a-1b2f-4d5a-9f0b-1234567890ab")).toBe(true);
  });

  it("accepts a v1 UUID", () => {
    expect(isValidUuid("550e8400-e29b-11d4-a716-446655440000")).toBe(true);
  });

  it("accepts a v5 UUID", () => {
    expect(isValidUuid("21f7f8de-8051-5b89-8680-0195ef798b6a")).toBe(true);
  });

  it("accepts uppercase hex (case-insensitive)", () => {
    expect(isValidUuid("4D3E7C1A-1B2F-4D5A-9F0B-1234567890AB")).toBe(true);
  });

  it("rejects the zero UUID (version nibble 0 is invalid)", () => {
    expect(isValidUuid("00000000-0000-0000-0000-000000000000")).toBe(false);
  });

  it("rejects an unversioned-but-formatted UUID (v=0)", () => {
    expect(isValidUuid("12345678-1234-0234-8234-123456789abc")).toBe(false);
  });

  it("rejects an invalid variant nibble", () => {
    // Variant must be 8, 9, a, or b. "c" is out of range.
    expect(isValidUuid("12345678-1234-4234-c234-123456789abc")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isValidUuid("")).toBe(false);
  });

  it("rejects a timestamp temp-id (Date.now().toString())", () => {
    expect(isValidUuid("1713600000000")).toBe(false);
  });

  it("rejects a UUID with missing hyphens", () => {
    expect(isValidUuid("4d3e7c1a1b2f4d5a9f0b1234567890ab")).toBe(false);
  });

  it("rejects a UUID with non-hex chars", () => {
    expect(isValidUuid("4d3e7c1a-1b2f-4d5a-9f0b-gggggggggggg")).toBe(false);
  });

  it("rejects whitespace-padded input", () => {
    expect(isValidUuid(" 4d3e7c1a-1b2f-4d5a-9f0b-1234567890ab ")).toBe(false);
  });
});

describe("APP_TIMEZONE", () => {
  it("is America/Chicago (CST, Nashville HQ)", () => {
    expect(APP_TIMEZONE).toBe("America/Chicago");
  });
});
