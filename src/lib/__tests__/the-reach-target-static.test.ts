import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("The Reach production target guard", () => {
  it("keeps active app and automation targets on THE REACH project/domain", () => {
    expect(() => {
      execFileSync("node", ["scripts/verify-the-reach-target.mjs"], {
        cwd: process.cwd(),
        stdio: "pipe",
      });
    }).not.toThrow();
  });
});
