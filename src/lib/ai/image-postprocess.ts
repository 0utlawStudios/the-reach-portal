// Crop + resize generated images to the resolved aspect's exact pixel
// dimensions. Uses sharp (already a Next.js transitive dep). Fails fast if
// the final dimensions are off by more than ±2 px, surfacing as a job error
// rather than letting a misshapen asset slip into the post.

import sharp from "sharp";
import type { ResolvedAspect } from "./types";

export interface ProcessedImage {
  bytes: Buffer;
  width: number;
  height: number;
  mime: "image/png";
}

export async function processImage(b64: string, resolved: ResolvedAspect): Promise<ProcessedImage> {
  const input = Buffer.from(b64, "base64");
  let pipeline = sharp(input);
  const meta = await pipeline.metadata();
  if (!meta.width || !meta.height) {
    throw new Error("Image post-process: missing dimensions on input");
  }

  const targetW = resolved.width;
  const targetH = resolved.height;
  const targetAspect = targetW / targetH;
  const srcAspect = meta.width / meta.height;

  // Compute crop rectangle so the output ends up at targetAspect.
  let cropW = meta.width;
  let cropH = meta.height;
  if (srcAspect > targetAspect) {
    // Source is wider — trim sides.
    cropW = Math.round(meta.height * targetAspect);
  } else if (srcAspect < targetAspect) {
    // Source is taller — trim top/bottom.
    cropH = Math.round(meta.width / targetAspect);
  }

  const left = Math.max(0, Math.round((meta.width - cropW) / 2));
  let top: number;
  if (resolved.postProcess === "crop_top") {
    top = 0;
  } else {
    top = Math.max(0, Math.round((meta.height - cropH) / 2));
  }

  pipeline = pipeline.extract({ left, top, width: cropW, height: cropH }).resize(targetW, targetH, {
    fit: "fill",
    withoutEnlargement: false,
  });

  const out = await pipeline.png({ compressionLevel: 9, quality: 92 }).toBuffer({ resolveWithObject: true });
  const w = out.info.width;
  const h = out.info.height;
  if (Math.abs(w - targetW) > 2 || Math.abs(h - targetH) > 2) {
    throw new Error(`Image post-process: final ${w}×${h} does not match target ${targetW}×${targetH}`);
  }
  return { bytes: out.data, width: w, height: h, mime: "image/png" };
}
