import { describe, expect, it } from "vitest";
import { isArchivedPostedCard, isCurrentPostedCard, resolvePostedArchiveDate } from "@/lib/post-archive";
import type { ContentCard } from "@/lib/types";

function card(overrides: Partial<ContentCard>): ContentCard {
  return {
    id: "post-1",
    title: "Post",
    stage: "posted",
    platforms: ["instagram"],
    contentType: "image",
    thumbnailUrl: "/thumb.png",
    createdAt: "2026-05-01",
    updatedAt: "2026-05-01",
    checklist: [],
    ...overrides,
  };
}

describe("posted archive bucketing", () => {
  const weekStart = new Date("2026-06-07T00:00:00.000Z");

  it("uses postedAt before scheduledDate so manual posts archive from actual publish date", () => {
    const item = card({
      postedAt: "2026-06-09T03:00:00.000Z",
      scheduledDate: "2026-05-01",
    });
    expect(resolvePostedArchiveDate(item)).toBe("2026-06-09");
    expect(isCurrentPostedCard(item, weekStart)).toBe(true);
    expect(isArchivedPostedCard(item, weekStart)).toBe(false);
  });

  it("archives posted cards from prior weeks", () => {
    const item = card({ postedAt: "2026-06-01T12:00:00.000Z" });
    expect(isArchivedPostedCard(item, weekStart)).toBe(true);
    expect(isCurrentPostedCard(item, weekStart)).toBe(false);
  });

  it("falls back to updatedAt when legacy posted cards have no publish date", () => {
    const item = card({ postedAt: undefined, scheduledDate: undefined, updatedAt: "2026-06-08" });
    expect(resolvePostedArchiveDate(item)).toBe("2026-06-08");
    expect(isCurrentPostedCard(item, weekStart)).toBe(true);
  });
});
