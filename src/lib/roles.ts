const PIPELINE_APPROVER_ROLES = new Set([
  "superadmin",
  "admin",
  "owner",
  "approver",
  "creative_director",
]);

const POST_DELETE_ROLES = new Set([
  "superadmin",
  "admin",
  "creative_director",
]);

export function isPipelineApproverRole(role: string | null | undefined): boolean {
  if (!role) return false;
  return PIPELINE_APPROVER_ROLES.has(role.trim().toLowerCase());
}

export function canDeletePostRole(role: string | null | undefined): boolean {
  if (!role) return false;
  return POST_DELETE_ROLES.has(role.trim().toLowerCase());
}

export const POST_DELETE_ALLOWED_ROLES: ReadonlyArray<string> = Array.from(POST_DELETE_ROLES);
