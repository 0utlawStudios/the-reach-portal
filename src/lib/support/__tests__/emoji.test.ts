import { describe, it, expect } from "vitest";
import { nextRecents, QUICK_EMOJIS } from "@/lib/support/emoji-data";

describe("nextRecents", () => {
  it("prepends a new emoji as most-recent", () => {
    expect(nextRecents(["😀", "🙏"], "🔥")).toEqual(["🔥", "😀", "🙏"]);
  });
  it("moves an already-present emoji to the front without duplicating it", () => {
    expect(nextRecents(["😀", "🙏", "🔥"], "🙏")).toEqual(["🙏", "😀", "🔥"]);
  });
  it("caps the list at the max length", () => {
    expect(nextRecents(["a", "b", "c", "d"], "e", 3)).toEqual(["e", "a", "b"]);
  });
  it("returns a single entry from an empty list", () => {
    expect(nextRecents([], "✅")).toEqual(["✅"]);
  });
});

describe("QUICK_EMOJIS", () => {
  it("contains no duplicate emojis", () => {
    expect(new Set(QUICK_EMOJIS).size).toBe(QUICK_EMOJIS.length);
  });
  it("ships a useful number of emojis", () => {
    expect(QUICK_EMOJIS.length).toBeGreaterThanOrEqual(64);
  });
});
