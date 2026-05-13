// Wrapper around the OpenAI Images API (gpt-image-1 GA). Returns base64
// bytes for further post-processing. We make N calls (one per slide) instead
// of asking for n=N in a single call because gpt-image-1 enforces n=1 in
// many regions and parallel calls give us better partial-failure recovery.

import type { OpenAISize } from "./types";

const DEFAULT_TIMEOUT_MS = 90_000;
const DEFAULT_RETRIES = 2;

export interface CallImageArgs {
  model: string;
  prompt: string;
  size: OpenAISize;
  quality?: "low" | "medium" | "high";
}

export interface CallImageResult {
  base64: string;
  model: string;
}

class OpenAiImageError extends Error {
  constructor(public status: number, message: string, public bodyExcerpt: string) {
    super(message);
    this.name = "OpenAiImageError";
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function callImage(args: CallImageArgs): Promise<CallImageResult> {
  const apiKey = process.env.OPENAI_IMAGE_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

  const url = "https://api.openai.com/v1/images/generations";
  const body = {
    model: args.model,
    prompt: args.prompt,
    size: args.size,
    quality: args.quality ?? "high",
    n: 1,
  };

  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= DEFAULT_RETRIES; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), DEFAULT_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "POST",
        signal: ctrl.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });
      clearTimeout(timer);
      const text = await res.text();
      if (!res.ok) {
        const retryable = res.status === 429 || res.status >= 500;
        const err = new OpenAiImageError(res.status, `OpenAI image error ${res.status}`, text.slice(0, 500));
        if (!retryable || attempt === DEFAULT_RETRIES) throw err;
        lastErr = err;
        await sleep(1000 * Math.pow(2, attempt - 1));
        continue;
      }
      const json = JSON.parse(text);
      const b64 = json.data?.[0]?.b64_json;
      if (typeof b64 !== "string" || !b64) {
        throw new OpenAiImageError(500, "OpenAI image response missing b64_json", text.slice(0, 500));
      }
      return { base64: b64, model: args.model };
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (attempt === DEFAULT_RETRIES) throw err;
      await sleep(1000 * Math.pow(2, attempt - 1));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("OpenAI image: unknown error");
}
