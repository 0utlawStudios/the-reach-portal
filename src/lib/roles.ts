const PIPELINE_APPROVER_ROLES = new Set([
  "superadmin",
  "admin",
  "owner",
  "approver",
  "creative_director",
]);

export function isPipelineApproverRole(role: string | null | undefined): boolean {
  if (!role) return false;
  return PIPELINE_APPROVER_ROLES.has(role.trim().toLowerCase());
}
