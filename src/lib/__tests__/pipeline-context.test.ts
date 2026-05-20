// Unit tests for the pure, exported helpers of pipeline-context.tsx:
//   dbToCard          — Supabase row → ContentCard mapper (incl. revision-note
//                       reconstruction, the source of the `revised` flag).
//   cardToDb          — ContentCard patch → Supabase update payload.
//   normalizePublishJob — publish_jobs join shape → ContentCard.publishJob.
//   toScheduledAt     — date+time → UTC ISO (DST-aware). Core cases live in
//                       scheduling.test.ts; this file only adds edge cases.
//
// These are the testable seams of an otherwise giant client-side provider.
// Per AGENTS.md §8 the provider itself is not render-tested here — the pure
// exports plus the static guards in iron-law-static.test.ts are the priority.

import { describe, it, expect } from "vitest";
import {
  dbToCard,
  cardToDb,
  normalizePublishJob,
  toScheduledAt,
  type PostRow,
} from "../pipeline-context";
import type { ContentCard } from "../types";

/** Minimal valid PostRow — spread + override per test. */
function baseRow(overrides: Partial<PostRow> = {}): PostRow {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    title: "Untitled",
    stage: "ideas",
    content_type: "image",
    ...overrides,
  };
}

describe("dbToCard — core field mapping", () => {
  it("maps id, title, stage, contentType and trims scheduled_time to HH:MM", () => {
    const card = dbToCard(
      baseRow({
        title: "Launch teaser",
        stage: "awaiting_approval",
        content_type: "video",
        scheduled_date: "2026-06-15",
        scheduled_time: "14:30:00",
      }),
    );
    expect(card.id).toBe("33333333-3333-4333-8333-333333333333");
    expect(card.title).toBe("Launch teaser");
    expect(card.stage).toBe("awaiting_approval");
    expect(card.contentType).toBe("video");
    expect(card.scheduledDate).toBe("2026-06-15");
    expect(card.scheduledTime).toBe("14:30"); // sliced to HH:MM
  });

  it("filters platforms down to known Platform ids", () => {
    const card = dbToCard(
      baseRow({ platforms: ["instagram", "facebook", "myspace", ""] }),
    );
    expect(card.platforms).toEqual(["instagram", "facebook"]);
  });

  it("falls back to DEFAULT_CHECKLIST when checklist is null", () => {
    const card = dbToCard(baseRow({ checklist: null }));
    expect(Array.isArray(card.checklist)).toBe(true);
    expect(card.checklist.length).toBeGreaterThan(0);
  });
});

describe("dbToCard — revision-note reconstruction (drives the `revised` flag)", () => {
  it("a row with NO revision note → revised=false, no revisionHistory", () => {
    const card = dbToCard(baseRow({ notes: "Just a normal note about the post." }));
    expect(card.revised).toBe(false);
    expect(card.revisionHistory).toBeUndefined();
  });

  it("a row with NULL notes → revised=false, no revisionHistory", () => {
    const card = dbToCard(baseRow({ notes: null }));
    expect(card.revised).toBe(false);
    expect(card.revisionHistory).toBeUndefined();
  });

  it("a row with an OLD-format revision note → revised=true, parsed history", () => {
    // Old format: `Revision Note (<at>): <note>`
    const card = dbToCard(
      baseRow({ notes: "Revision Note (Apr 3, 2:15 PM): Fix the hook timing" }),
    );
    expect(card.revised).toBe(true);
    expect(card.revisionHistory).toBeDefined();
    expect(card.revisionHistory).toHaveLength(1);
    expect(card.revisionHistory![0]).toEqual({
      note: "Fix the hook timing",
      by: "Revision Note",
      at: "Apr 3, 2:15 PM",
    });
  });

  it("a row with a NEW-format revision note → revised=true, parsed author + history", () => {
    // New format: `<by> (<at>): Fix submitted — <note>`
    const card = dbToCard(
      baseRow({ notes: "Jane Cruz (Apr 5, 9:00 AM): Fix submitted — Reworked the caption" }),
    );
    expect(card.revised).toBe(true);
    expect(card.revisionHistory).toBeDefined();
    expect(card.revisionHistory).toHaveLength(1);
    expect(card.revisionHistory![0].by).toBe("Jane Cruz");
    expect(card.revisionHistory![0].at).toBe("Apr 5, 9:00 AM");
    expect(card.revisionHistory![0].note).toBe("Reworked the caption");
  });

  it("a row with BOTH formats → revised=true, history contains both entries", () => {
    const notes =
      "Revision Note (Apr 3, 2:15 PM): Fix the hook timing" +
      "\n\n" +
      "Jane Cruz (Apr 5, 9:00 AM): Fix submitted — Reworked the caption";
    const card = dbToCard(baseRow({ notes }));
    expect(card.revised).toBe(true);
    expect(card.revisionHistory).toBeDefined();
    expect(card.revisionHistory!.length).toBe(2);
    // Old-format entry is parsed with the literal "Revision Note" author.
    const oldEntry = card.revisionHistory!.find((e) => e.by === "Revision Note");
    expect(oldEntry?.note).toBe("Fix the hook timing");
    // New-format entry is parsed with the real author name.
    const newEntry = card.revisionHistory!.find((e) => e.by === "Jane Cruz");
    expect(newEntry?.note).toBe("Reworked the caption");
  });
});

describe("cardToDb — scheduled_at is only written when schedule fields are touched", () => {
  it("omits scheduled_at entirely when neither scheduledDate nor scheduledTime is present", () => {
    const out = cardToDb({ title: "No schedule change" });
    expect("scheduled_at" in out).toBe(false);
    expect("scheduled_date" in out).toBe(false);
    expect("scheduled_time" in out).toBe(false);
  });

  it("sets scheduled_at to an ISO string when both date and time are provided", () => {
    const out = cardToDb({ scheduledDate: "2026-06-15", scheduledTime: "14:30" });
    expect("scheduled_at" in out).toBe(true);
    expect(typeof out.scheduled_at).toBe("string");
    // 2026-06-15 14:30 CDT (UTC-5) → 19:30 UTC.
    expect(out.scheduled_at).toBe("2026-06-15T19:30:00.000Z");
    expect(out.scheduled_date).toBe("2026-06-15");
    expect(out.scheduled_time).toBe("14:30");
  });

  it("sets scheduled_at to null when the schedule fields are CLEARED to empty strings", () => {
    // Touching the fields with empty values means "clear the schedule".
    const out = cardToDb({ scheduledDate: "", scheduledTime: "" });
    expect("scheduled_at" in out).toBe(true);
    expect(out.scheduled_at).toBeNull();
    expect(out.scheduled_date).toBeNull();
    expect(out.scheduled_time).toBeNull();
  });

  it("sets scheduled_at to null when only one of date/time is present (incomplete)", () => {
    // A date with no time cannot resolve to a real instant — must be null,
    // never a half-formed timestamp.
    const out = cardToDb({ scheduledDate: "2026-06-15" });
    expect("scheduled_at" in out).toBe(true);
    expect(out.scheduled_at).toBeNull();
  });

  it("maps only the fields explicitly present on the patch", () => {
    const patch: Partial<ContentCard> = { title: "Renamed", stage: "revision_needed" };
    const out = cardToDb(patch);
    expect(out.title).toBe("Renamed");
    expect(out.stage).toBe("revision_needed");
    expect("caption" in out).toBe(false);
  });
});

describe("normalizePublishJob", () => {
  it("returns undefined for null input", () => {
    expect(normalizePublishJob(null)).toBeUndefined();
  });

  it("returns undefined for an empty array input", () => {
    expect(normalizePublishJob([])).toBeUndefined();
  });

  it("normalizes a single-object job input", () => {
    const job = normalizePublishJob({
      state: "scheduled",
      platform_publish_attempts: [
        { platform: "instagram", state: "pending", external_post_id: null },
      ],
    });
    expect(job).toBeDefined();
    expect(job!.state).toBe("scheduled");
    expect(job!.platformAttempts).toHaveLength(1);
    expect(job!.platformAttempts[0].platform).toBe("instagram");
    expect(job!.platformAttempts[0].state).toBe("pending");
    expect(job!.platformAttempts[0].externalPostId).toBeNull();
  });

  it("takes the first element when given an array of jobs", () => {
    const job = normalizePublishJob([
      { state: "queued", platform_publish_attempts: [] },
      { state: "ignored-second", platform_publish_attempts: [] },
    ]);
    expect(job).toBeDefined();
    expect(job!.state).toBe("queued");
  });

  it("wraps a SINGLE platform_publish_attempts object into an array", () => {
    const job = normalizePublishJob({
      state: "scheduled",
      platform_publish_attempts: {
        platform: "facebook",
        state: "succeeded",
        external_post_id: "fb_123",
      },
    });
    expect(job!.platformAttempts).toHaveLength(1);
    expect(job!.platformAttempts[0].platform).toBe("facebook");
    expect(job!.platformAttempts[0].externalPostId).toBe("fb_123");
  });

  it("handles an ARRAY of platform_publish_attempts", () => {
    const job = normalizePublishJob({
      state: "scheduled",
      platform_publish_attempts: [
        { platform: "instagram", state: "succeeded", external_post_id: "ig_1" },
        { platform: "facebook", state: "failed", external_post_id: null },
      ],
    });
    expect(job!.platformAttempts).toHaveLength(2);
    expect(job!.platformAttempts.map((a) => a.platform)).toEqual([
      "instagram",
      "facebook",
    ]);
  });

  it("coerces a null/undefined platform_publish_attempts to an empty array", () => {
    const job = normalizePublishJob({ state: "scheduled", platform_publish_attempts: null });
    expect(job).toBeDefined();
    expect(job!.platformAttempts).toEqual([]);
  });
});

describe("toScheduledAt — additional edge cases", () => {
  // Core DST + null-guard cases live in scheduling.test.ts. These cover
  // boundaries that suite does not exercise.
  it("returns undefined when both args are omitted", () => {
    expect(toScheduledAt()).toBeUndefined();
  });

  it("handles midnight (00:00) without rolling to the previous day's instant incorrectly", () => {
    // 2026-06-15 00:00 CDT (UTC-5) → 05:00 UTC same calendar day.
    expect(toScheduledAt("2026-06-15", "00:00")).toBe("2026-06-15T05:00:00.000Z");
  });

  it("returns null for a malformed time string", () => {
    expect(toScheduledAt("2026-06-15", "not-a-time")).toBeNull();
  });
});
