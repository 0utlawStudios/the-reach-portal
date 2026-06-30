import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function source(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf8");
}

describe("The Reach brand kit static contracts", () => {
  it("keeps the client intake distilled into an operator-facing Client Intel tab", () => {
    const brandKit = source("src/components/pages/brand-kit-page.tsx");

    expect(brandKit).toContain('type Tab = "copy" | "source" | "strategy" | "visual" | "guardrails"');
    expect(brandKit).toContain("Client Intel");
    expect(brandKit).toContain("CLIENT_BRIEF_SECTIONS");
    expect(brandKit).toContain("Full-service luxury travel planning and booking");
    expect(brandKit).toContain("AI cannot VIP a client or unlock advisor perks");
    expect(brandKit).toContain("Bhutan scouting trip, June 10-20");
    expect(brandKit).toContain("Target volume is 15-25 leads or bookings per month");
    expect(brandKit).toContain("Where do you want to go, and how do you want to feel");
  });

  it("keeps the PDF brand guidelines represented as lightweight app data", () => {
    const brandKit = source("src/components/pages/brand-kit-page.tsx");

    for (const color of ["#E1DFD5", "#6C655A", "#5A656C", "#975428"]) {
      expect(brandKit).toContain(color);
    }

    expect(brandKit).toContain("Bradford from Lineto");
    expect(brandKit).toContain("Everett from Weltkern");
    expect(brandKit).toContain("VOICE_TERRITORIES");
    expect(brandKit).toContain("PHOTO_CATEGORIES");
    expect(brandKit).toContain("INSTAGRAM_TEMPLATES");
    expect(brandKit).toContain("LOGO_RULES");
    expect(brandKit).toContain("Pure black and pure white are not part of the brand system.");
    expect(brandKit).not.toContain("The_Reach_Brand_Guidelines_May_2026_compressed.pdf");
    expect(brandKit).not.toContain("<iframe");
    expect(brandKit).not.toContain("<embed");
  });
});
