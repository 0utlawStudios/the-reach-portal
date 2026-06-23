const POSTER_MAX_EDGE = 1280;
const POSTER_QUALITY = 0.84;
// Overall budget for poster generation. A video the browser cannot decode would
// otherwise wait out two sequential ~10s per-event timeouts (~20s) before
// failing. Cap the whole attempt so a bad codec falls back to no-poster fast —
// callers treat a thrown poster as best-effort and upload the video without a
// custom thumbnail.
const POSTER_OVERALL_BUDGET_MS = 8000;

function withOverallTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => { window.clearTimeout(timer); resolve(value); },
      (err) => { window.clearTimeout(timer); reject(err); },
    );
  });
}

function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, "") || "video";
}

function waitForEvent(target: EventTarget, event: string, timeoutMs = 10000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for video ${event}`));
    }, timeoutMs);
    const cleanup = () => {
      window.clearTimeout(timer);
      target.removeEventListener(event, onEvent);
      target.removeEventListener("error", onError);
    };
    const onEvent = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("Could not read video for thumbnail generation"));
    };
    target.addEventListener(event, onEvent, { once: true });
    target.addEventListener("error", onError, { once: true });
  });
}

function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Could not create video thumbnail"));
        return;
      }
      resolve(blob);
    }, "image/jpeg", POSTER_QUALITY);
  });
}

export async function createVideoPosterFile(file: File): Promise<File> {
  if (!file.type.startsWith("video/")) {
    throw new Error("Poster generation requires a video file");
  }

  const objectUrl = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "metadata";
  video.src = objectUrl;

  try {
    return await withOverallTimeout((async () => {
    await waitForEvent(video, "loadedmetadata");
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const targetTime = duration > 0.5 ? 0.25 : 0;
    if (targetTime > 0) {
      video.currentTime = targetTime;
      await waitForEvent(video, "seeked");
    } else {
      await waitForEvent(video, "loadeddata");
    }

    const sourceWidth = video.videoWidth;
    const sourceHeight = video.videoHeight;
    if (!sourceWidth || !sourceHeight) {
      throw new Error("Video has no readable dimensions");
    }

    const scale = Math.min(1, POSTER_MAX_EDGE / Math.max(sourceWidth, sourceHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(sourceWidth * scale));
    canvas.height = Math.max(1, Math.round(sourceHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not create video thumbnail canvas");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const blob = await canvasToJpeg(canvas);
    return new File([blob], `${baseName(file.name)}-poster.jpg`, { type: "image/jpeg" });
    })(), POSTER_OVERALL_BUDGET_MS, "Timed out generating video thumbnail");
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(objectUrl);
  }
}
