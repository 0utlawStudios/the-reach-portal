import { supabase } from "./supabaseClient";

const isConfigured = !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

export async function logAudit(postId: string, userName: string, actionType: string, details?: string) {
  if (!isConfigured) return;
  await supabase.from("post_audit_logs").insert({
    post_id: postId,
    user_name: userName,
    action_type: actionType,
    details: details || null,
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

export async function fetchAuditLogs(postId: string): Promise<AuditEntry[]> {
  if (!isConfigured) return [];
  const { data, error } = await supabase
    .from("post_audit_logs")
    .select("*")
    .eq("post_id", postId)
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return data as AuditEntry[];
}

export async function fetchAllAuditLogs(limit = 100): Promise<AuditEntry[]> {
  if (!isConfigured) return [];
  const { data, error } = await supabase
    .from("post_audit_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return data as AuditEntry[];
}
