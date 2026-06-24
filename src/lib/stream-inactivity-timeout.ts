export const STREAM_INACTIVITY_TIMEOUT_MS = 45_000;

export function streamWithInactivityTimeout(
  body: ReadableStream<Uint8Array> | null,
  timeoutMs = STREAM_INACTIVITY_TIMEOUT_MS,
  label = "media stream",
  onTimeout?: () => void,
): ReadableStream<Uint8Array> | null {
  if (!body) return null;

  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let settled = false;

  function clearInactivityTimer() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function fail(controller: ReadableStreamDefaultController<Uint8Array>, error: Error) {
    if (settled) return;
    settled = true;
    clearInactivityTimer();
    try {
      onTimeout?.();
    } catch (timeoutError) {
      console.error("[stream-inactivity-timeout] timeout callback failed", timeoutError);
    }
    if (reader) {
      void reader.cancel(error).catch(() => undefined);
    }
    controller.error(error);
  }

  function scheduleInactivityTimer(controller: ReadableStreamDefaultController<Uint8Array>) {
    clearInactivityTimer();
    timer = setTimeout(() => {
      fail(controller, new Error(`${label} stalled for ${timeoutMs}ms`));
    }, timeoutMs);
  }

  return new ReadableStream<Uint8Array>({
    start() {
      reader = body.getReader();
    },
    async pull(controller) {
      if (!reader || settled) return;
      scheduleInactivityTimer(controller);
      try {
        const { done, value } = await reader.read();
        clearInactivityTimer();
        if (settled) return;
        if (done) {
          settled = true;
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        clearInactivityTimer();
        if (settled) return;
        settled = true;
        controller.error(error);
      }
    },
    cancel(reason) {
      settled = true;
      clearInactivityTimer();
      return reader?.cancel(reason);
    },
  });
}
