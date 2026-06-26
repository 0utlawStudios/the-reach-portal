import {
  esc,
  getFromAddress,
  getSiteUrl,
  getTransporter,
  isValidEmail,
  safeSubject,
} from "@/lib/email-utils";
import { pingTelegram, tgEscape } from "@/lib/support/telegram";
import { recordServerUploadFailure } from "@/lib/upload-audit";

export type UploadAlertSource = "client" | "server";
export type UploadAlertPath = "proxy" | "resumable" | "unknown";

export interface UploadFailureAlert {
  source: UploadAlertSource;
  phase: string;
  route?: string;
  uploadPath?: UploadAlertPath;
  workspaceId?: string | null;
  userId?: string | null;
  userName?: string | null;
  userEmail?: string | null;
  userRole?: string | null;
  cardId?: string | null;
  postTitle?: string | null;
  folder?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
  batchTotal?: number | null;
  batchFailed?: number | null;
  errorMessage: string;
  errorStatus?: number | null;
  errorDetail?: string | null;
  userAgent?: string | null;
  ip?: string | null;
  requestUrl?: string | null;
  occurredAt?: string | null;
}

const MAX_DETAIL = 3000;
const MAX_FIELD = 500;

function truncate(value: unknown, max = MAX_FIELD): string {
  const text = String(value ?? "");
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function redact(value: unknown): string {
  return truncate(value, MAX_DETAIL)
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[redacted]")
    .replace(/(authorization["']?\s*[:=]\s*["']?)[^"',\s}]+/gi, "$1[redacted]")
    .replace(/(password|passwd|secret|token|api[_-]?key)(["']?\s*[:=]\s*["']?)[^"',\s}]+/gi, "$1$2[redacted]");
}

function formatBytes(value?: number | null): string {
  if (!Number.isFinite(value || NaN) || !value || value <= 0) return "unknown";
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

function smtpReady(): boolean {
  return Boolean(process.env.SMTP_USER && process.env.SMTP_PASS);
}

function ownerEmail(): string | null {
  const value = process.env.UPLOAD_ALERT_EMAIL || process.env.UPLOAD_FAILURE_NOTIFY_EMAIL || process.env.SUPPORT_NOTIFY_EMAIL || process.env.SMTP_USER;
  return isValidEmail(value) ? String(value).trim().toLowerCase() : null;
}

function buildRows(alert: UploadFailureAlert): string {
  const rows: Array<[string, unknown]> = [
    ["When", alert.occurredAt || new Date().toISOString()],
    ["Source", alert.source],
    ["Phase", alert.phase],
    ["Route", alert.route || ""],
    ["Path", alert.uploadPath || "unknown"],
    ["User", [alert.userName, alert.userEmail].filter(Boolean).join(" / ")],
    ["Role", alert.userRole || ""],
    ["Workspace", alert.workspaceId || ""],
    ["Card", alert.cardId || ""],
    ["Post", alert.postTitle || ""],
    ["Folder", alert.folder || ""],
    ["File", alert.fileName || ""],
    ["MIME", alert.mimeType || ""],
    ["Size", formatBytes(alert.fileSize)],
    ["Batch", alert.batchTotal ? `${alert.batchFailed || 1} failed of ${alert.batchTotal}` : ""],
    ["Status", alert.errorStatus || ""],
    ["IP", alert.ip || ""],
    ["User Agent", alert.userAgent || ""],
    ["Request URL", alert.requestUrl || ""],
  ];

  return rows
    .filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== "")
    .map(([label, value]) => `
      <tr>
        <td style="padding:7px 14px 7px 0;color:#6b7280;font-size:12px;font-weight:700;white-space:nowrap;vertical-align:top;">${esc(label)}</td>
        <td style="padding:7px 0;color:#111827;font-size:12px;line-height:1.45;word-break:break-word;">${esc(truncate(value))}</td>
      </tr>
    `)
    .join("");
}

function buildEmailHtml(alert: UploadFailureAlert): string {
  const siteUrl = getSiteUrl();
  const errorDetail = redact(alert.errorDetail || alert.errorMessage);
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:32px 16px;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:680px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e5e7eb;">
    <div style="background:#991b1b;padding:22px 28px;">
      <p style="margin:0;color:#fecaca;font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;">The Reach Upload Failure</p>
      <h1 style="margin:6px 0 0;color:#fff;font-size:20px;line-height:1.25;">${esc(alert.fileName || "Upload failed")}</h1>
    </div>
    <div style="padding:26px 28px;">
      <p style="margin:0 0 18px;color:#111827;font-size:14px;line-height:1.6;">
        A production upload failed and needs attention. The user-facing upload should fail closed and preserve the post draft state.
      </p>
      <div style="background:#fef2f2;border-left:4px solid #dc2626;padding:14px 16px;border-radius:0 8px 8px 0;margin:0 0 22px;">
        <p style="margin:0 0 6px;color:#7f1d1d;font-size:11px;font-weight:800;text-transform:uppercase;">Error</p>
        <p style="margin:0;color:#111827;font-size:13px;line-height:1.55;white-space:pre-wrap;">${esc(redact(alert.errorMessage))}</p>
      </div>
      <table style="border-collapse:collapse;width:100%;margin:0 0 22px;">${buildRows(alert)}</table>
      ${errorDetail ? `<div style="background:#111827;color:#f9fafb;border-radius:10px;padding:14px 16px;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:11px;line-height:1.5;white-space:pre-wrap;word-break:break-word;">${esc(errorDetail)}</div>` : ""}
      <p style="margin:22px 0 0;"><a href="${esc(siteUrl)}" style="display:inline-block;background:#991b1b;color:#fff;text-decoration:none;padding:11px 18px;border-radius:8px;font-size:13px;font-weight:800;">Open The Reach</a></p>
    </div>
  </div>
</body>
</html>`;
}

function buildTelegramText(alert: UploadFailureAlert): string {
  const lines = [
    "<b>The Reach upload failed</b>",
    `File: ${tgEscape(alert.fileName || "unknown")}`,
    `User: ${tgEscape([alert.userName, alert.userEmail].filter(Boolean).join(" / ") || "unknown")}`,
    `Phase: ${tgEscape(alert.phase)} (${tgEscape(alert.uploadPath || "unknown")})`,
    `Size: ${tgEscape(formatBytes(alert.fileSize))}`,
    alert.batchTotal ? `Batch: ${tgEscape(`${alert.batchFailed || 1} failed of ${alert.batchTotal}`)}` : "",
    alert.postTitle ? `Post: ${tgEscape(alert.postTitle)}` : "",
    `Error: ${tgEscape(redact(alert.errorMessage).slice(0, 900))}`,
  ];
  return lines.filter(Boolean).join("\n");
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), ms); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function notifyUploadFailure(alert: UploadFailureAlert): Promise<{ emailSent: boolean; telegramSent: boolean; persisted: boolean }> {
  const normalized: UploadFailureAlert = {
    ...alert,
    occurredAt: alert.occurredAt || new Date().toISOString(),
    errorMessage: redact(alert.errorMessage || "Upload failed"),
    errorDetail: alert.errorDetail ? redact(alert.errorDetail) : null,
  };

  let emailSent = false;
  const to = ownerEmail();
  if (to && smtpReady()) {
    try {
      const result = await withTimeout(
        getTransporter().sendMail({
          from: getFromAddress(),
          to,
          subject: safeSubject(`The Reach upload failed: ${normalized.fileName || normalized.phase}`),
          html: buildEmailHtml(normalized),
        }),
        10000,
      );
      emailSent = Boolean(result);
    } catch (err) {
      console.error("[upload-alerts] email failed:", err instanceof Error ? err.message : err);
    }
  }

  const telegramSent = await pingTelegram({
    text: buildTelegramText(normalized),
    threadUrl: getSiteUrl(),
    buttonLabel: "Open The Reach",
    chatId: process.env.UPLOAD_ALERT_TELEGRAM_CHAT_ID,
  });

  // Persist server-side failures to audit_log_v2 with the REAL status/reason detail so
  // the cause is queryable later (email/Telegram are ephemeral). Client-reported
  // failures are already audited by /api/drive/upload-failure, so skip those here to
  // avoid double-logging. Best-effort: never let telemetry fail an alert.
  let persisted = false;
  if (alert.source === "server") {
    persisted = await recordServerUploadFailure({
      workspaceId: alert.workspaceId,
      phase: alert.phase,
      route: alert.route,
      uploadPath: alert.uploadPath,
      fileName: alert.fileName,
      mimeType: alert.mimeType,
      fileSize: alert.fileSize,
      errorStatus: alert.errorStatus,
      // Persist the REDACTED values (parity with email/Telegram). The detail strings are
      // already structured/sanitized today, but routing the audit write through the same
      // redact() keeps secrets out of audit_log_v2 even if a future caller passes raw text.
      errorDetail: normalized.errorDetail,
      errorMessage: normalized.errorMessage,
      userId: alert.userId,
    });
  }

  return { emailSent, telegramSent, persisted };
}
