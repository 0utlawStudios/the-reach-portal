import { afterEach, describe, expect, it, vi } from "vitest";
import { aiAssetPublishUrl, signAiAssetToken, verifyAiAssetToken } from "../asset-publish-url";
import { buildPostInsertRow } from "../persist";
import type { GeneratedCaption, PlanRow, ResolvedAspect } from "../types";

const OLD_ENV = { ...process.env };

function setNodeEnv(value: "production" | "development" | "test") {
  Object.defineProperty(process.env, "NODE_ENV", { value, configurable: true, enumerable: true, writable: true });
}

afterEach(() => {
  vi.useRealTimers();
  process.env = { ...OLD_ENV };
});

describe("AI asset publish URLs", () => {
  it("fails closed in production without a dedicated AI asset signing secret", () => {
    setNodeEnv("production");
    delete process.env.AI_ASSET_SIGNING_SECRET;
    process.env.DRIVE_STREAM_SIGNING_SECRET = "drive-secret";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-secret";

    expect(() => signAiAssetToken("workspace/post/image.jpg")).toThrow("AI asset signing secret is not configured");
  });

  it("signs storage keys without exposing the bucket as a public file", () => {
    vi.setSystemTime(new Date("2026-06-25T00:00:00.000Z"));
    process.env.AI_ASSET_SIGNING_SECRET = "test-secret";
    process.env.NEXT_PUBLIC_SITE_URL = "https://thereach.ten80ten.com/";

    const key = "00000000-0000-0000-0000-000000000001/post-1/slide-1.jpg";
    const token = signAiAssetToken(key, Date.now() + 60_000);
    expect(verifyAiAssetToken(key, token)).toEqual({ expiresAt: Date.now() + 60_000 });
    expect(verifyAiAssetToken(`${key}.tampered`, token)).toBeNull();

    vi.setSystemTime(new Date("2026-06-25T00:02:00.000Z"));
    expect(verifyAiAssetToken(key, token)).toBeNull();

    vi.setSystemTime(new Date("2026-06-25T00:00:00.000Z"));
    const url = aiAssetPublishUrl(key);
    expect(url).toMatch(/^https:\/\/thereach\.ten80ten\.com\/api\/ai\/asset\?/);
    expect(url).toContain(`key=${encodeURIComponent(key)}`);
    expect(url).toContain("token=v1.");
  });

  it("stores publisher-fetchable asset_urls while keeping UI thumbnail and storage keys", () => {
    vi.setSystemTime(new Date("2026-06-25T00:00:00.000Z"));
    process.env.AI_ASSET_SIGNING_SECRET = "test-secret";
    process.env.NEXT_PUBLIC_SITE_URL = "https://thereach.ten80ten.com";

    const row = buildPostInsertRow({
      workspaceId: "00000000-0000-0000-0000-000000000001",
      actorEmail: "editor@example.com",
      plan: {
        id: "plan-1",
        workspace_id: "00000000-0000-0000-0000-000000000001",
        created_by: "editor@example.com",
        row_index: 1,
        scheduled_date: "2026-06-26",
        scheduled_time: "09:00",
        platforms: ["instagram"],
        media_type: "image",
        format: "carousel",
        slides_count: 1,
        resolved_aspect: "1:1",
        feel: "editorial",
        visual_style: "clean",
        style_prompt: "bright resort photo",
        topic: "Summer offer",
        notes: null,
        status: "ready",
        generated_post_id: null,
        last_error: null,
        cost_usd: null,
        created_at: "2026-06-25T00:00:00.000Z",
        updated_at: "2026-06-25T00:00:00.000Z",
      } satisfies PlanRow,
      caption: {
        title: "Summer offer",
        hook: "Open the door to summer",
        caption: "A polished caption.",
        cta: "Book now",
        hashtags: ["#travel"],
        approval_notes: "Ready",
        quality_score: 95,
        visual_brief: "Hero image",
        scene_outline: [{ index: 1, shot: "Resort pool", on_screen_text: "" }],
        source_notes: [],
      } satisfies GeneratedCaption,
      resolved: {
        ratio: "1:1",
        width: 1024,
        height: 1024,
        openaiSize: "1024x1024",
        postProcess: "none",
      } satisfies ResolvedAspect,
      assets: [
        {
          storageKey: "00000000-0000-0000-0000-000000000001/post-1/slide-1.jpg",
          signedUrl: "https://supabase.example/signed/temporary",
        },
      ],
      textModel: "gpt-test",
      imageModel: "image-test",
      promptVersion: "test",
    });

    expect(row.thumbnail_url).toBe("/api/ai/asset?key=00000000-0000-0000-0000-000000000001%2Fpost-1%2Fslide-1.jpg");
    expect(row.asset_storage_keys).toEqual(["00000000-0000-0000-0000-000000000001/post-1/slide-1.jpg"]);
    expect(row.asset_urls?.[0]).toMatch(/^https:\/\/thereach\.ten80ten\.com\/api\/ai\/asset\?/);
    expect(row.asset_urls?.[0]).toContain("token=v1.");
    expect(row.asset_urls?.[0]).not.toBe("https://supabase.example/signed/temporary");
  });
});
