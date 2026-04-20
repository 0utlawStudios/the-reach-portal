import { supabase } from "./supabaseClient";

const isConfigured = !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

function isValidUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

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

type AuditLogV2Row = {
  id: string;
  entity_id: string | null;
  action: string;
  metadata: { user_name?: string; details?: string | null } | null;
  actor_role: string | null;
  created_at: string;
};

function toAuditEntry(row: AuditLogV2Row): AuditEntry {
  return {
    id: row.id,
    post_id: row.entity_id || "",
    user_name: row.metadata?.user_name || row.actor_role || "Unknown",
    action_type: row.action,
    details: row.metadata?.details || null,
    created_at: row.created_at,
  };
}

export async function fetchAuditLogs(postId: string): Promise<AuditEntry[]> {
  if (!isConfigured || !isValidUuid(postId)) return [];
  const { data, error } = await supabase
    .from("audit_log_v2")
    .select("id, entity_id, action, metadata, actor_role, created_at")
    .eq("entity_id", postId)
    .eq("entity_type", "post")
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return (data as AuditLogV2Row[]).map(toAuditEntry);
}

export async function fetchAllAuditLogs(limit = 100): Promise<AuditEntry[]> {
  if (!isConfigured) return [];
  const { data, error } = await supabase
    .from("audit_log_v2")
    .select("id, entity_id, action, metadata, actor_role, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return (data as AuditLogV2Row[]).map(toAuditEntry);
}
