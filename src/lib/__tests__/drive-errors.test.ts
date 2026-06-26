import { describe, expect, it } from "vitest";
import {
  sanitizeGoogleDriveError,
  sessionInvalidError,
  statusForSanitizedDriveError,
} from "@/lib/drive-errors";

describe("drive error taxonomy", () => {
  it("returns an explicit, non-storage session reason for token-verify failures", () => {
    const err = sessionInvalidError();
    expect(err.errorReason).toBe("sessionInvalid");
    expect(err.retryable).toBe(false);
    expect(err.error).not.toContain("Storage rejected");
    expect(statusForSanitizedDriveError(err)).toBe(403);
  });

  it("still maps a genuine Google rate-limit 403 to driveRateLimited (retryable)", () => {
    const err = sanitizeGoogleDriveError(403, { error: { errors: [{ reason: "userRateLimitExceeded" }] } });
    expect(err.errorReason).toBe("driveRateLimited");
    expect(err.retryable).toBe(true);
  });

  it("maps a generic Google 4xx to a storage rejection that no longer dead-ends the user", () => {
    const err = sanitizeGoogleDriveError(403, { error: { message: "forbidden" } });
    expect(err.errorReason).toBe("storageRejected");
    // The message must be honest/actionable, not the old terminal "Storage rejected the upload."
    expect(err.error).toMatch(/retry|contact support/i);
  });

  it("keeps 5xx retryable and 400/415 terminal", () => {
    expect(sanitizeGoogleDriveError(503, "").retryable).toBe(true);
    expect(sanitizeGoogleDriveError(400, "").errorReason).toBe("validation");
    expect(sanitizeGoogleDriveError(415, "").errorReason).toBe("unsupportedType");
  });
});
