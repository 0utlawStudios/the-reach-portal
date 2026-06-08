import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { consume, getClientIp } from "@/lib/rate-limit";
import { isValidUuid } from "@/lib/utils";
import { notifyUploadFailure, type UploadAlertPath } from "@/lib/upload-alerts";
import { loadCallerProfile, requireNotificationContext } from "@/app/api/notifications/_shared";

export const runtime = "nodejs";
export const maxDuration = 30;

type UploadFailureRequest = {
  phase?: unknown;
  route?: unknown;
  uploadPath?: unknown;
  cardId?: unknown;
  postTitle?: unknown;
  folder?: unknown;
  fileName?: unknown;
  mimeType?: unknown;
  fileSize?: unknown;
  batchTotal?: unknown;
  batchFailed?: unknown;
  errorMessage?: unknown;
  errorStatus?: unknown;
  errorDetail?: unknown;
};

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase admin credentials not configured");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 1000) : fallback;
}

function num(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function uploadPath(value: unknown): UploadAlertPath {
  const path = text(value).toLowerCase();
  return path === "proxy" || path === "resumable" ? path : "unknown";
}

export async function POST(request: NextRequest) {
  const ctx = await requireNotificationContext(request);
  if (ctx instanceof NextResponse) return ctx;

  const ip = getClientIp(request);
  const rl = await consume("drive-upload-failure:user", `user:${ctx.user.id}|ip:${ip}`, 30, 300);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many upload failure reports." }, { status: 429 });
  }

  let body: UploadFailureRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const errorMessage = text(body.errorMessage, "Upload failed");
  if (!errorMessage) return NextResponse.json({ error: "Missing error message" }, { status: 400 });

  const admin = getAdminClient();
  const caller = await loadCallerProfile(admin, ctx.email);
  const cardId = text(body.cardId);
  const safeCardId = isValidUuid(cardId) ? cardId : null;

  const result = await notifyUploadFailure({
    source: "client",
    phase: text(body.phase, "client_upload"),
    route: text(body.route, "/api/drive/upload-failure"),
    uploadPath: uploadPath(body.uploadPath),
    workspaceId: ctx.workspaceId,
    userId: ctx.user.id,
    userName: caller.name,
    userEmail: caller.email,
    userRole: ctx.role,
    cardId: safeCardId,
    postTitle: text(body.postTitle) || null,
    folder: text(body.folder) || null,
    fileName: text(body.fileName) || null,
    mimeType: text(body.mimeType) || null,
    fileSize: num(body.fileSize),
    batchTotal: num(body.batchTotal),
    batchFailed: num(body.batchFailed),
    errorMessage,
    errorStatus: num(body.errorStatus),
    errorDetail: text(body.errorDetail) || null,
    userAgent: request.headers.get("user-agent"),
    ip,
    requestUrl: request.url,
  });

  try {
    await admin.rpc("record_audit_event", {
      p_entity_type: "upload",
      p_action: "upload_failed_alerted",
      p_entity_id: safeCardId,
      p_workspace_id: ctx.workspaceId,
      p_metadata: {
        user_name: caller.name,
        file_name: text(body.fileName) || null,
        folder: text(body.folder) || null,
        phase: text(body.phase, "client_upload"),
        upload_path: uploadPath(body.uploadPath),
        error: errorMessage.slice(0, 500),
        email_sent: result.emailSent,
        telegram_sent: result.telegramSent,
      },
    });
  } catch (err) {
    console.error("[drive/upload-failure] audit failed:", err instanceof Error ? err.message : err);
  }

  return NextResponse.json({ ok: true, ...result });
}
