import { afterEach, describe, expect, it, vi } from "vitest";
import { streamWithInactivityTimeout } from "@/lib/stream-inactivity-timeout";

describe("streamWithInactivityTimeout", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("passes through available chunks without buffering the whole stream", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.close();
      },
    });

    const wrapped = streamWithInactivityTimeout(stream, 100, "test stream");
    const reader = wrapped?.getReader();
    expect(reader).toBeTruthy();

    await expect(reader?.read()).resolves.toEqual({
      done: false,
      value: new Uint8Array([1, 2, 3]),
    });
    await expect(reader?.read()).resolves.toEqual({ done: true, value: undefined });
  });

  it("errors the response stream when the upstream body stalls", async () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const cancel = vi.fn();
    const stalled = new ReadableStream<Uint8Array>({
      pull() {
        return new Promise<void>(() => undefined);
      },
      cancel,
    });

    const wrapped = streamWithInactivityTimeout(stalled, 100, "Drive media", onTimeout);
    const read = wrapped?.getReader().read();
    const readRejects = expect(read).rejects.toThrow("Drive media stalled for 100ms");

    await vi.advanceTimersByTimeAsync(99);
    expect(onTimeout).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await readRejects;
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
