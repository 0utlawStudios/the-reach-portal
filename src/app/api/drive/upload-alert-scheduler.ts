import { after } from "next/server";
import { notifyUploadFailure, notifyUploadSuccess, type UploadFailureAlert } from "@/lib/upload-alerts";
import { recordUploadSuccess, type UploadSuccessAudit } from "@/lib/upload-audit";

export function scheduleUploadFailureAlert(label: string, alert: UploadFailureAlert): void {
  const run = async () => {
    try {
      await notifyUploadFailure(alert);
    } catch (err) {
      console.error(`[${label}] upload alert failed:`, err);
    }
  };

  try {
    after(run);
  } catch {
    // Unit tests call route handlers outside a Next request scope. Production
    // route handlers use after(); tests fall back to a non-blocking promise.
    void run();
  }
}

// Records a completed upload to audit_log_v2 (parity counter for the failure events) AND
// pings the owner's email + Telegram so every upload in the app is visible, not just
// failures (notifyUploadSuccess is opt-out via UPLOAD_SUCCESS_NOTIFY=false). Both run off
// the request's critical path so they never add latency to the upload response.
export function scheduleUploadSuccess(success: UploadSuccessAudit): void {
  const run = async () => {
    await Promise.allSettled([
      recordUploadSuccess(success).catch((err) => console.error("[upload-success] audit failed:", err)),
      notifyUploadSuccess(success).catch((err) => console.error("[upload-success] notify failed:", err)),
    ]);
  };

  try {
    after(run);
  } catch {
    void run();
  }
}
