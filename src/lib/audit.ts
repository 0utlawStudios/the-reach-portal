import { supabase } from "./supabaseClient";
import { isValidUuid } from "./utils";

const isConfigured = !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

// Writes through the record_audit_event() security-definer RPC (migration 0009).
// The function derives workspace_id from auth.uid() automatically, so no
// workspace_id needs to be passed from the client.
export async function logAudit(postId: string, userName: string, actionType: string, details?: string) {
  if (!isConfigured) return;
  await supabase.rpc("record_audit_event", {
    p_entity_type: "post",
    p_action: actionType,
    p_entity_id: isValidUuid(postId) ? postId : null,
    p_metadata: { user_name: userName, details: details || null },
  });
}

export interface AuditEntry {
  id: string;
  post_id: string;
  user_name: string;
  action_type: string;
  details: string | null;
  created_at: string;
}

// Audit reads go through v_audit_log_with_actor (migration 0025) which
// resolves actor_name via the fallback chain: metadata.user_name >
// metadata.movedBy > metadata.approvedBy > metadata.changedBy >
// team_members.name (via auth.users.email) > actor_role. Reading from this
// view means the UI gets a real name in nearly every case — "Unknown" only
// fires when literally every signal is missing.
type AuditLogV2Row = {
  id: string;
  entity_id: string | null;
  action: string;
  metadata: { user_name?: string; details?: string | null; movedBy?: string; approvedBy?: string; changedBy?: string } | null;
  actor_role: string | null;
  actor_name: string | null;
  created_at: string;
};

const LAUNCH_CLEANUP_EMAILS = new Set([
  "alex@ten80ten.com",
  "carlo@ten80ten.com",
  "christer@ten80ten.com",
  "hanes@ten80ten.com",
  "muaaz.ten80ten@gmail.com",
  "shang.ten80ten@gmail.com",
]);

function isLaunchCleanupRemoval(details: string): boolean {
  if (details.startsWith("Reach launch cleanup removed ")) return true;
  if (/^Removed qa-(invite|request)-\d+@example\.com from team, workspace access, and auth$/.test(details)) return true;
  const removed = details.match(/^Removed ([^ ]+) from team, workspace access, and auth$/);
  const email = removed?.[1]?.toLowerCase();
  return !!email && LAUNCH_CLEANUP_EMAILS.has(email);
}

function resolveAuditActorName(row: AuditLogV2Row): string {
  const m = row.metadata || {};
  const details = typeof m.details === "string" ? m.details : "";
  if (row.action === "member_removed" && isLaunchCleanupRemoval(details)) {
    return "SYSTEM";
  }
  return row.actor_name
    || m.user_name
    || m.movedBy
    || m.approvedBy
    || m.changedBy
    || row.actor_role
    || "Unknown";
}

function toAuditEntry(row: AuditLogV2Row): AuditEntry {
  const m = row.metadata || {};
  const name = resolveAuditActorName(row);
  return {
    id: row.id,
    post_id: row.entity_id || "",
    user_name: name,
    action_type: row.action,
    details: m.details || null,
    created_at: row.created_at,
  };
}

const AUDIT_SELECT = "id, entity_id, action, metadata, actor_role, actor_name, created_at";

export async function fetchAuditLogs(postId: string): Promise<AuditEntry[]> {
  if (!isConfigured || !isValidUuid(postId)) return [];
  const { data, error } = await supabase
    .from("v_audit_log_with_actor")
    .select(AUDIT_SELECT)
    .eq("entity_id", postId)
    .eq("entity_type", "post")
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return (data as AuditLogV2Row[]).map(toAuditEntry);
}

export async function fetchAllAuditLogs(limit = 100): Promise<AuditEntry[]> {
  if (!isConfigured) return [];
  const { data, error } = await supabase
    .from("v_audit_log_with_actor")
    .select(AUDIT_SELECT)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return (data as AuditLogV2Row[]).map(toAuditEntry);
}
