export const DEFAULT_CLIENT_FETCH_TIMEOUT_MS = 10_000;

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = DEFAULT_CLIENT_FETCH_TIMEOUT_MS,
  label = "Request",
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: init.signal || controller.signal,
    });
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(`${label} timed out. Check your connection and try again.`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
