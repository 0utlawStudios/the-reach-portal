export type DriveErrorReason =
  | "driveRateLimited"
  | "appRateLimited"
  | "auth"
  | "validation"
  | "notFound"
  | "unsupportedType"
  | "tooLarge"
  | "storageRejected"
  | "serverError"
  | "network"
  | "timeout"
  | "unknown";

export interface SanitizedDriveError {
  error: string;
  errorReason: DriveErrorReason;
  retryable: boolean;
  retryAfterMs?: number;
}

const MESSAGE_BY_REASON: Record<DriveErrorReason, string> = {
  driveRateLimited: "Storage is busy. Retrying automatically.",
  appRateLimited: "Too many uploads. Please wait a moment before trying again.",
  auth: "Upload authorization failed. Please sign in again.",
  validation: "The upload request is invalid.",
  notFound: "The uploaded file could not be found.",
  unsupportedType: "Unsupported file type for this upload location.",
  tooLarge: "The file is too large for this upload location.",
  storageRejected: "Storage rejected the upload.",
  serverError: "Upload service failed. Please try again.",
  network: "Network error during upload.",
  timeout: "Upload timed out.",
  unknown: "Upload failed. Please try again.",
};

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function retryAfterMsFromReset(resetAt: unknown): number | undefined {
  const t = resetAt instanceof Date ? resetAt.getTime() : new Date(String(resetAt || "")).getTime();
  if (!Number.isFinite(t)) return undefined;
  return Math.max(1000, t - Date.now());
}

export function appRateLimitError(resetAt?: unknown): SanitizedDriveError {
  const retryAfterMs = retryAfterMsFromReset(resetAt);
  return {
    error: MESSAGE_BY_REASON.appRateLimited,
    errorReason: "appRateLimited",
    retryable: false,
    ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
  };
}

export function extractGoogleDriveReason(raw: unknown): string {
  if (!raw) return "";
  if (typeof raw === "string") {
    try {
      return extractGoogleDriveReason(JSON.parse(raw));
    } catch {
      const lower = raw.toLowerCase();
      if (lower.includes("userratelimitexceeded")) return "userRateLimitExceeded";
      if (lower.includes("ratelimitexceeded")) return "rateLimitExceeded";
      if (lower.includes("notfound")) return "notFound";
      return "";
    }
  }

  const root = asRecord(raw);
  const error = asRecord(root?.error);
  const errors = Array.isArray(error?.errors) ? error.errors : [];
  for (const item of errors) {
    const reason = cleanText(asRecord(item)?.reason);
    if (reason) return reason;
  }
  return cleanText(error?.reason) || cleanText(root?.reason);
}

export function sanitizeGoogleDriveError(status: number, raw: unknown): SanitizedDriveError {
  const reason = extractGoogleDriveReason(raw);
  const lower = reason.toLowerCase();

  if (status === 429 || lower === "ratelimitexceeded" || lower === "userratelimitexceeded") {
    return {
      error: MESSAGE_BY_REASON.driveRateLimited,
      errorReason: "driveRateLimited",
      retryable: true,
    };
  }
  if (status === 401) {
    return { error: MESSAGE_BY_REASON.auth, errorReason: "auth", retryable: false };
  }
  if (status === 400) {
    return { error: MESSAGE_BY_REASON.validation, errorReason: "validation", retryable: false };
  }
  if (status === 404 || lower === "notfound") {
    return { error: MESSAGE_BY_REASON.notFound, errorReason: "notFound", retryable: false };
  }
  if (status === 413) {
    return { error: MESSAGE_BY_REASON.tooLarge, errorReason: "tooLarge", retryable: false };
  }
  if (status === 415) {
    return { error: MESSAGE_BY_REASON.unsupportedType, errorReason: "unsupportedType", retryable: false };
  }
  if (status >= 500) {
    return { error: MESSAGE_BY_REASON.serverError, errorReason: "serverError", retryable: true };
  }
  return { error: MESSAGE_BY_REASON.storageRejected, errorReason: "storageRejected", retryable: false };
}

export function sanitizeUnknownUploadError(error: unknown): SanitizedDriveError {
  const message = error instanceof Error ? error.message : String(error || "");
  const statusMatch = message.match(/\b(4\d\d|5\d\d)\b/);
  if (statusMatch) return sanitizeGoogleDriveError(Number(statusMatch[1]), message);
  if (/timed out/i.test(message)) return { error: MESSAGE_BY_REASON.timeout, errorReason: "timeout", retryable: true };
  if (/network/i.test(message)) return { error: MESSAGE_BY_REASON.network, errorReason: "network", retryable: true };
  return { error: MESSAGE_BY_REASON.serverError, errorReason: "serverError", retryable: true };
}

export function sanitizedErrorResponse(
  error: SanitizedDriveError,
  status: number,
): Response {
  return Response.json(error, { status });
}

export function statusForSanitizedDriveError(error: SanitizedDriveError, fallback = 500): number {
  switch (error.errorReason) {
    case "driveRateLimited":
    case "appRateLimited":
      return 429;
    case "auth":
      return 401;
    case "validation":
      return 400;
    case "notFound":
      return 404;
    case "unsupportedType":
      return 415;
    case "tooLarge":
      return 413;
    default:
      return fallback;
  }
}

export function sanitizedDriveErrorDetail(error: SanitizedDriveError, status?: number): string {
  return [
    typeof status === "number" ? `status=${status}` : null,
    `reason=${error.errorReason}`,
    `retryable=${error.retryable}`,
    typeof error.retryAfterMs === "number" ? `retryAfterMs=${error.retryAfterMs}` : null,
  ].filter(Boolean).join(" ");
}
