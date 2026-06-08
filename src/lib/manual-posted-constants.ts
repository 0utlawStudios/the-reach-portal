export const MANUAL_POSTED_FLAG_NAME = "manual_posted_moves";

export const MANUAL_POSTED_TOGGLE_ROLES: ReadonlyArray<string> = ["superadmin"];

export const MANUAL_POSTED_MOVE_ROLES: ReadonlyArray<string> = [
  "superadmin",
  "admin",
  "owner",
  "approver",
  "creative_director",
];

export const MANUAL_POSTED_READ_ROLES: ReadonlyArray<string> = [
  "superadmin",
  "admin",
  "owner",
  "approver",
  "creative_director",
  "editor",
  "social_media_specialist",
  "video_editor",
  "graphic_designer",
  "specialist",
  "technician",
  "viewer",
];

export function isManualPostedToggleRole(role: string | null | undefined): boolean {
  return Boolean(role && MANUAL_POSTED_TOGGLE_ROLES.includes(role.trim().toLowerCase()));
}
