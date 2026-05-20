import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const SETUP_SRC = readFileSync(join(process.cwd(), "src/app/auth/setup/page.tsx"), "utf8");
const STUDIO_SRC = readFileSync(join(process.cwd(), "src/components/pages/studio-page.tsx"), "utf8");

describe("invite setup flow hardening", () => {
  it("activates invitations through the server route, not a client-side team_members update", () => {
    expect(SETUP_SRC).toContain("/api/auth/complete-setup");
    expect(SETUP_SRC).not.toMatch(/from\(\s*["']team_members["']\s*\)\s*\.\s*update\(/);
  });

  it("keeps the user session after setup so workspace provisioning can refresh immediately", () => {
    expect(SETUP_SRC).not.toMatch(/auth\.signOut\s*\(/);
    expect(SETUP_SRC).toMatch(/window\.location\.replace\(\s*["']\/["']\s*\)/);
  });
});

describe("Creator Studio default row count", () => {
  it("does not pad the planner with a long placeholder sheet", () => {
    expect(STUDIO_SRC).not.toMatch(/14\s*-\s*have/);
    expect(STUDIO_SRC).toMatch(/fetched\.length\s*>\s*0\s*\?\s*fetched\s*:\s*\[makeBlankRow\(0\)\]/);
  });
});
