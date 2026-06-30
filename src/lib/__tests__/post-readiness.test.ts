import { describe, expect, it } from "vitest";
import type { ContentCard } from "@/lib/types";
import { getPostReadinessIssues, stageRequiresPostReadiness } from "@/lib/post-readiness";

function readyCard(overrides: Partial<ContentCard> = {}): ContentCard {
  return {
    id: "post-1",
    title: "Client product launch",
    stage: "ideas",
    platforms: ["instagram"],
    contentType: "video",
    thumbnailUrl: "/api/drive/stream?id=aaaaaaaaaaaaaaaaaaaa",
    scheduledDate: "2026-07-01",
    scheduledTime: "09:00",
    caption: "Launch caption",
    createdAt: "2026-06-30T00:00:00.000Z",
    updatedAt: "2026-06-30T00:00:00.000Z",
    assetSource: "Client Provided",
    checklist: [
      { id: "rights", label: "Rights confirmed", checked: true },
      { id: "caption", label: "Caption checked", checked: true },
    ],
    sourceVault: {
      rawFiles: [{
        name: "raw.mov",
        url: "/api/drive/stream?id=bbbbbbbbbbbbbbbbbbbb",
        usageType: "master",
        uploadedAt: "2026-06-30T00:00:00.000Z",
      }],
    },
    ...overrides,
  };
}

describe("post readiness", () => {
  it("only applies readiness gates to approval-forward stages", () => {
    expect(stageRequiresPostReadiness("ideas")).toBe(false);
    expect(stageRequiresPostReadiness("revision_needed")).toBe(false);
    expect(stageRequiresPostReadiness("awaiting_approval")).toBe(true);
    expect(stageRequiresPostReadiness("approved_scheduled")).toBe(true);
  });

  it("accepts a fully prepared post", () => {
    expect(getPostReadinessIssues(readyCard())).toEqual([]);
  });

  it("lists the fields that sparse Ideas posts must complete before approval", () => {
    const issues = getPostReadinessIssues(readyCard({
      platforms: [],
      scheduledDate: undefined,
      scheduledTime: undefined,
      thumbnailUrl: "",
      caption: "",
      assetSource: "",
      checklist: [],
      sourceVault: { rawFiles: [] },
    }));

    expect(issues.map((issue) => issue.id)).toEqual([
      "platforms",
      "postDateTime",
      "thumbnail",
      "contentForPublishing",
      "caption",
      "assetSource",
      "checklist",
    ]);
    expect(issues.find((issue) => issue.id === "checklist")?.guidance).toContain("Checklist tab");
  });

  it("requires all checklist items to be checked", () => {
    const issues = getPostReadinessIssues(readyCard({
      checklist: [{ id: "caption", label: "Caption checked", checked: false }],
    }));
    expect(issues.map((issue) => issue.id)).toEqual(["checklist"]);
  });
});
