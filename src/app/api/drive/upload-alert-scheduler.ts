import { after } from "next/server";
import { notifyUploadFailure, type UploadFailureAlert } from "@/lib/upload-alerts";

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
