// Thin fetch wrapper around the OpenAI Chat Completions API for text
// generation. We use Chat Completions + JSON schema mode because it's the
// stable GA path; the Responses API is still moving and the schema shape
// keeps changing. Either way, we never import the OpenAI SDK — one fewer
// dependency to audit and zero client-bundle impact.

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRIES = 3;

export interface CallTextArgs {
  model: string;
  system: string;
  user: string;
  schema: object;
  schemaName: string;
  maxTokens?: number;
  temperature?: number;
}

export interface CallTextResult<T> {
  parsed: T;
  raw: string;
  tokensIn: number;
  tokensOut: number;
  model: string;
}

class OpenAiError extends Error {
  constructor(
    public status: number,
    message: string,
    public bodyExcerpt: string,
  ) {
    super(message);
    this.name = "OpenAiError";
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function callTextJson<T>(args: CallTextArgs): Promise<CallTextResult<T>> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

  const url = "https://api.openai.com/v1/chat/completions";

  const body = {
    model: args.model,
    temperature: args.temperature ?? 0.7,
    max_tokens: args.maxTokens ?? 2400,
    messages: [
      { role: "system", content: args.system },
      { role: "user", content: args.user },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: args.schemaName,
        strict: true,
        schema: args.schema,
      },
    },
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
        const err = new OpenAiError(res.status, `OpenAI text error ${res.status}`, text.slice(0, 500));
        if (!retryable || attempt === DEFAULT_RETRIES) throw err;
        lastErr = err;
        await sleep(500 * Math.pow(2, attempt - 1));
        continue;
      }
      const json = JSON.parse(text);
      const content = json.choices?.[0]?.message?.content;
      if (typeof content !== "string") {
        throw new OpenAiError(500, "OpenAI response missing message.content", text.slice(0, 500));
      }
      let parsed: T;
      try {
        parsed = JSON.parse(content) as T;
      } catch {
        throw new OpenAiError(500, "OpenAI returned non-JSON content", content.slice(0, 500));
      }
      const usage = json.usage || {};
      return {
        parsed,
        raw: content,
        tokensIn: Number(usage.prompt_tokens) || 0,
        tokensOut: Number(usage.completion_tokens) || 0,
        model: json.model || args.model,
      };
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (attempt === DEFAULT_RETRIES) throw err;
      await sleep(500 * Math.pow(2, attempt - 1));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("OpenAI text: unknown error");
}
