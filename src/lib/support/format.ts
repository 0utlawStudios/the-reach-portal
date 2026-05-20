// Pure formatting helpers and shared constants for the Support Center.
// No imports — safe to use from server routes, client components, and tests.

import type { SupportThreadStatus, SupportSenderType } from "./types";

/**
 * Human-readable reference for a thread, shown to the user and in
 * notifications. First 6 hex characters of the UUID, uppercased — e.g.
 * "3F9A0C". Not a uniqueness guarantee; the UUID remains the real key.
 */
export function threadShortCode(id: string): string {
  return id.replace(/-/g, "").slice(0, 6).toUpperCase();
}

// Attachment limits. Kept in sync with the storage bucket's file_size_limit
// and allowed_mime_types in migration 0027_support_center.sql.
export const SUPPORT_MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB
export const SUPPORT_MAX_FILES = 5;

export const SUPPORT_ALLOWED_MIME = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/quicktime",
] as const;

export type SupportAllowedMime = (typeof SUPPORT_ALLOWED_MIME)[number];

export function isAllowedSupportMime(mime: string): mime is SupportAllowedMime {
  return (SUPPORT_ALLOWED_MIME as readonly string[]).includes(mime);
}

export function attachmentKind(mime: string): "image" | "video" {
  return mime.startsWith("video/") ? "video" : "image";
}

// Issue categories offered in the ticket form.
export const SUPPORT_ISSUE_CATEGORIES = [
  { id: "bug", label: "Bug" },
  { id: "question", label: "Question" },
  { id: "billing", label: "Billing" },
  { id: "other", label: "Other" },
] as const;

export type SupportIssueCategory = (typeof SUPPORT_ISSUE_CATEGORIES)[number]["id"];

export function categoryLabel(id: string | null | undefined): string {
  if (!id) return "General";
  const found = SUPPORT_ISSUE_CATEGORIES.find((c) => c.id === id);
  return found ? found.label : id;
}

export const SUPPORT_STATUS_LABEL: Record<SupportThreadStatus, string> = {
  open: "Open",
  in_progress: "In Progress",
  resolved: "Resolved",
  closed: "Closed",
};

// Description bounds for a ticket submission.
export const SUPPORT_MIN_BODY = 5;
export const SUPPORT_MAX_BODY = 4000;

/**
 * Insert `insert` into `value`, replacing the [start, end) selection range.
 * Returns the new string and the caret position to place just after the
 * insertion. Indices are clamped, so out-of-range selection values are safe.
 * Used by the support composers' emoji picker.
 */
export function spliceAtSelection(
  value: string,
  start: number,
  end: number,
  insert: string,
): { value: string; caret: number } {
  const len = value.length;
  const safeStart = Math.max(0, Math.min(Number.isFinite(start) ? start : len, len));
  const safeEnd = Math.max(safeStart, Math.min(Number.isFinite(end) ? end : len, len));
  return {
    value: value.slice(0, safeStart) + insert + value.slice(safeEnd),
    caret: safeStart + insert.length,
  };
}

/**
 * Decide which of the viewer's own messages should carry a "Seen" receipt.
 * Returns the id of the viewer's last sent message plus the read time, when
 * the other party's last_read_at is at or after that message — otherwise null.
 * Pure; unit-tested.
 */
export function seenReceipt(
  messages: ReadonlyArray<{ id: string; senderType: SupportSenderType; createdAt: string }>,
  viewerRole: "user" | "admin",
  otherSideLastReadAt: string | null,
): { messageId: string; readAt: string } | null {
  if (!otherSideLastReadAt) return null;
  const readMs = new Date(otherSideLastReadAt).getTime();
  if (Number.isNaN(readMs)) return null;

  const mine: SupportSenderType = viewerRole === "admin" ? "admin" : "user";
  let last: { id: string; createdAt: string } | null = null;
  for (const m of messages) {
    if (m.senderType === mine) last = { id: m.id, createdAt: m.createdAt };
  }
  if (!last) return null;

  const msgMs = new Date(last.createdAt).getTime();
  if (Number.isNaN(msgMs)) return null;
  return readMs >= msgMs ? { messageId: last.id, readAt: otherSideLastReadAt } : null;
}
