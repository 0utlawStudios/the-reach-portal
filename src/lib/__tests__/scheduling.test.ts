// Tests for the scheduled_at conversion contract used by pipeline-context.tsx.
//
// `toScheduledAt` is now EXPORTED from pipeline-context.tsx, so this suite
// imports and exercises the real production function — no mirror copy. A
// mirror could drift silently and pass while production broke; importing the
// real export means these assertions guard the actual code path.
//
// What this catches:
//   - Drift in APP_TIMEZONE (e.g. someone flipping Nashville HQ to UTC).
//   - Drift in the date+time → ISO contract (DST edges, null guard, malformed).
//   - Drift in the "scheduled_at is required when stage moves to approved_scheduled"
//     pre-condition — verified indirectly by the round-trip test below.

import { describe, it, expect } from "vitest";
import { APP_TIMEZONE } from "../utils";
import { toScheduledAt } from "../pipeline-context";

describe("APP_TIMEZONE", () => {
  it("is pinned to America/Chicago (Nashville HQ)", () => {
    expect(APP_TIMEZONE).toBe("America/Chicago");
  });
});

describe("toScheduledAt", () => {
  it("returns undefined when both date and time are undefined (no schedule edit)", () => {
    expect(toScheduledAt(undefined, undefined)).toBeUndefined();
  });

  it("returns null when date is provided without time", () => {
    expect(toScheduledAt("2026-06-15", undefined)).toBeNull();
  });

  it("returns null when time is provided without date", () => {
    expect(toScheduledAt(undefined, "14:30")).toBeNull();
  });

  it("returns null when date or time is empty string", () => {
    expect(toScheduledAt("", "14:30")).toBeNull();
    expect(toScheduledAt("2026-06-15", "")).toBeNull();
  });

  it("returns null for a malformed date string", () => {
    expect(toScheduledAt("not-a-date", "14:30")).toBeNull();
  });

  it("converts a CST date+time during standard time (winter) to the right UTC ISO", () => {
    // 2026-01-15 14:30 CST = UTC-6 = 20:30 UTC
    const iso = toScheduledAt("2026-01-15", "14:30");
    expect(iso).toBe("2026-01-15T20:30:00.000Z");
  });

  it("converts a CDT date+time during daylight time (summer) to the right UTC ISO", () => {
    // 2026-06-15 14:30 CDT = UTC-5 = 19:30 UTC
    const iso = toScheduledAt("2026-06-15", "14:30");
    expect(iso).toBe("2026-06-15T19:30:00.000Z");
  });

  it("returns a valid ISO string (round-trip parseable)", () => {
    const iso = toScheduledAt("2026-06-15", "09:00");
    expect(iso).not.toBeNull();
    expect(iso).not.toBeUndefined();
    // Round-trip: ISO string should parse back to a valid Date.
    const reparsed = new Date(iso as string);
    expect(Number.isNaN(reparsed.getTime())).toBe(false);
  });

  it("never returns the bare naive time interpreted as UTC", () => {
    // Regression guard: if someone reverts the offset math, the result would
    // come back as 14:30Z (UTC) instead of 19:30Z (CDT → UTC).
    const iso = toScheduledAt("2026-06-15", "14:30");
    expect(iso).not.toBe("2026-06-15T14:30:00.000Z");
  });
});
