import { describe, it, expect } from "vitest";
import {
  threadShortCode,
  isAllowedSupportMime,
  attachmentKind,
  categoryLabel,
  SUPPORT_ALLOWED_MIME,
  SUPPORT_MAX_FILE_BYTES,
  SUPPORT_MAX_FILES,
  SUPPORT_STATUS_LABEL,
} from "@/lib/support/format";

describe("threadShortCode", () => {
  it("returns the first 6 hex chars uppercased", () => {
    expect(threadShortCode("3f9a0c12-dead-beef-0000-111122223333")).toBe("3F9A0C");
  });
  it("strips dashes before slicing", () => {
    expect(threadShortCode("ab-cd-ef-12-34")).toBe("ABCDEF");
  });
  it("handles input shorter than six characters", () => {
    expect(threadShortCode("abc")).toBe("ABC");
  });
});

describe("isAllowedSupportMime", () => {
  it("accepts allowed image and video types", () => {
    expect(isAllowedSupportMime("image/png")).toBe(true);
    expect(isAllowedSupportMime("image/jpeg")).toBe(true);
    expect(isAllowedSupportMime("video/mp4")).toBe(true);
    expect(isAllowedSupportMime("video/quicktime")).toBe(true);
  });
  it("rejects disallowed types", () => {
    expect(isAllowedSupportMime("application/x-msdownload")).toBe(false);
    expect(isAllowedSupportMime("text/html")).toBe(false);
    expect(isAllowedSupportMime("image/svg+xml")).toBe(false);
    expect(isAllowedSupportMime("")).toBe(false);
  });
});

describe("attachmentKind", () => {
  it("classifies video and image mime types", () => {
    expect(attachmentKind("video/mp4")).toBe("video");
    expect(attachmentKind("video/quicktime")).toBe("video");
    expect(attachmentKind("image/png")).toBe("image");
    expect(attachmentKind("image/gif")).toBe("image");
  });
});

describe("categoryLabel", () => {
  it("maps known category ids to labels", () => {
    expect(categoryLabel("bug")).toBe("Bug");
    expect(categoryLabel("billing")).toBe("Billing");
    expect(categoryLabel("question")).toBe("Question");
  });
  it("falls back to General for null or undefined", () => {
    expect(categoryLabel(null)).toBe("General");
    expect(categoryLabel(undefined)).toBe("General");
  });
  it("returns the raw id for an unknown category", () => {
    expect(categoryLabel("weird")).toBe("weird");
  });
});

describe("support constants", () => {
  it("caps attachments at 25 MB and 5 files", () => {
    expect(SUPPORT_MAX_FILE_BYTES).toBe(25 * 1024 * 1024);
    expect(SUPPORT_MAX_FILES).toBe(5);
  });
  it("allows exactly the documented mime types", () => {
    expect([...SUPPORT_ALLOWED_MIME].sort()).toEqual(
      ["image/gif", "image/jpeg", "image/png", "image/webp", "video/mp4", "video/quicktime"].sort(),
    );
  });
  it("has a label for every thread status", () => {
    expect(SUPPORT_STATUS_LABEL.open).toBe("Open");
    expect(SUPPORT_STATUS_LABEL.in_progress).toBe("In Progress");
    expect(SUPPORT_STATUS_LABEL.resolved).toBe("Resolved");
    expect(SUPPORT_STATUS_LABEL.closed).toBe("Closed");
  });
});
