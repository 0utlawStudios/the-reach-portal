// Queryable upload telemetry.
//
// The recurring "Storage rejected the upload." incident went undiagnosed for months
// because the only record of a failure was an email + Telegram ping — the real Google
// `status=…reason=…` and the failing server guard were never written anywhere you could
// query. This module persists both upload FAILURES (with the real detail) and SUCCESSES
// (for a failure-rate denominator) to `audit_log_v2` via the existing record_audit_event
// RPC, so the next incident is answerable with one SQL query instead of a forensics dig.
//
// All writes are best-effort and time-bounded: telemetry must never delay or fail a real
// upload. They run server-side with the service-role admin client.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { UploadAlertPath } from "@/lib/upload-alerts";

const AUDIT_PERSIST_TIMEOUT_MS = 5_000;

// Version-AGNOSTIC UUID shape check. The shared isValidUuid() requires a v1-v5
// version nibble, which REJECTS this deployment's all-zeros baseline workspace
// (00000000-0000-0000-0000-000000000001, version nibble 0). Using it here would
// silently drop every audit for the only workspace that exists. This accepts the
// baseline while still rejecting non-UUID garbage; record_audit_event casts to uuid.
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function adminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function recordAudit(
  action: "upload_failed_server" | "upload_succeeded",
  workspaceId: string | null | undefined,
  metadata: Record<string, unknown>,
): Promise<boolean> {
  // record_audit_event requires a real workspace UUID; skip silently otherwise.
  if (!workspaceId || !UUID_SHAPE.test(workspaceId)) return false;
  const admin = adminClient();
  if (!admin) return false;
  try {
    const rpc = admin.rpc("record_audit_event", {
      p_entity_type: "upload",
      p_action: action,
      p_entity_id: null,
      p_workspace_id: workspaceId,
      p_metadata: metadata,
    });
    const result = (await Promise.race([
      rpc,
      new Promise<{ error: { message: string } }>((resolve) =>
        setTimeout(() => resolve({ error: { message: "audit persist timed out" } }), AUDIT_PERSIST_TIMEOUT_MS),
      ),
    ])) as { error: unknown };
    if (result?.error) {
      console.error("[upload-audit] persist failed:", JSON.stringify(result.error));
      return false;
    }
    return true;
  } catch (err) {
    console.error("[upload-audit] persist threw:", err instanceof Error ? err.message : err);
    return false;
  }
}

export interface ServerUploadFailureAudit {
  workspaceId?: string | null;
  phase?: string | null;
  route?: string | null;
  uploadPath?: UploadAlertPath | null;
  fileName?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
  errorStatus?: number | null;
  /** The REAL detail string, e.g. "status=403 reason=sessionInvalid retryable=false". */
  errorDetail?: string | null;
  errorMessage?: string | null;
  userId?: string | null;
}

/** Persist a server-side upload failure with the real Google/guard detail. */
export async function recordServerUploadFailure(input: ServerUploadFailureAudit): Promise<boolean> {
  return recordAudit("upload_failed_server", input.workspaceId, {
    phase: input.phase || null,
    route: input.route || null,
    upload_path: input.uploadPath || "unknown",
    file_name: input.fileName || null,
    mime_type: input.mimeType || null,
    file_size: input.fileSize ?? null,
    error_status: input.errorStatus ?? null,
    error_detail: input.errorDetail || null,
    error_message: input.errorMessage || null,
    user_id: input.userId || null,
  });
}

export interface UploadSuccessAudit {
  workspaceId?: string | null;
  fileId?: string | null;
  fileName?: string | null;
  folder?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
  uploadPath?: UploadAlertPath | null;
  userId?: string | null;
}

/** Persist a successful upload so failure rate has a denominator (parity counter). */
export async function recordUploadSuccess(input: UploadSuccessAudit): Promise<boolean> {
  return recordAudit("upload_succeeded", input.workspaceId, {
    file_id: input.fileId || null,
    file_name: input.fileName || null,
    folder: input.folder || null,
    mime_type: input.mimeType || null,
    file_size: input.fileSize ?? null,
    upload_path: input.uploadPath || "unknown",
    user_id: input.userId || null,
  });
}
