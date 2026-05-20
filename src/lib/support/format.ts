// Pure formatting helpers and shared constants for the Support Center.
// No imports — safe to use from server routes, client components, and tests.

import type { SupportThreadStatus } from "./types";

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
