import { beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({ result: null as unknown }));
const knownState = vi.hoisted(() => ({ drive: new Set<string>(), playback: new Set<string>() }));

vi.mock("@/lib/auth/require", () => ({
  requireBearerTeamRole: vi.fn(async () => authState.result),
  requireRole: vi.fn(async () => authState.result),
}));
vi.mock("@/lib/google-drive", () => ({
  signDriveStreamToken: vi.fn(() => "drive-token"),
  signStableThumbToken: vi.fn(() => "thumb-token"),
}));
vi.mock("@/lib/media-playback-token", () => ({
  signPlaybackViewToken: vi.fn(() => "playback-token"),
}));
vi.mock("@/lib/media-access", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/media-access")>();
  return {
    ...actual,
    filterKnownAppDriveFiles: vi.fn(async () => knownState.drive),
    filterKnownPlaybackObjects: vi.fn(async () => knownState.playback),
  };
});

import { NextRequest, NextResponse } from "next/server";
import { POST } from "../route";

const WS = "00000000-0000-0000-0000-000000000001";
const ID_A = "aaaaaaaaaaaaaaaaaaaa";

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("https://thereach.ten80ten.com/api/media/view-url/batch", {
    method: "POST",
    headers: { Authorization: "Bearer token", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  authState.result = { workspaceId: WS };
  knownState.drive = new Set<string>();
  knownState.playback = new Set<string>();
});

describe("POST /api/media/view-url/batch", () => {
  it("returns the authorization response when the caller is not allowed", async () => {
    authState.result = NextResponse.json({ error: "no" }, { status: 401 });
    const res = await POST(makeRequest({ urls: [`/api/media/image-preview?id=${ID_A}&size=thumb`] }));
    expect(res.status).toBe(401);
  });

  it("signs a token only for urls the workspace is known to own", async () => {
    knownState.drive = new Set([ID_A]);
    const res = await POST(makeRequest({
      urls: [
        `/api/media/image-preview?id=${ID_A}&size=thumb`,
        "/api/media/image-preview?id=bbbbbbbbbbbbbbbbbbbb&size=thumb",
      ],
    }));
    const body = await res.json() as { results: Array<{ input: string; url: string | null }> };
    // A thumbnail target gets the STABLE workspace-bound token (edge-cacheable URL).
    expect(body.results[0].url).toContain("token=thumb-token");
    expect(body.results[0].url).toContain(`id=${ID_A}`);
    expect(body.results[1].url).toBeNull();
  });

  it("uses the per-request private token for non-thumbnail targets (full-res + stream)", async () => {
    knownState.drive = new Set([ID_A]);
    const res = await POST(makeRequest({
      urls: [
        `/api/media/image-preview?id=${ID_A}&size=full`,
        `/api/drive/stream?id=${ID_A}`,
      ],
    }));
    const body = await res.json() as { results: Array<{ url: string | null }> };
    // Full-res image and video stream keep per-user gating — NOT the stable thumb capability.
    expect(body.results[0].url).toContain("token=drive-token");
    expect(body.results[1].url).toContain("token=drive-token");
    expect(body.results.every((r) => !r.url?.includes("thumb-token"))).toBe(true);
  });

  it("returns null for urls outside the allowed media routes", async () => {
    knownState.drive = new Set([ID_A]);
    const res = await POST(makeRequest({ urls: ["/api/secret?id=" + ID_A, "https://evil.example/x"] }));
    const body = await res.json() as { results: Array<{ url: string | null }> };
    expect(body.results.every((r) => r.url === null)).toBe(true);
  });

  it("rejects an empty array", async () => {
    const res = await POST(makeRequest({ urls: [] }));
    expect(res.status).toBe(400);
  });

  it("rejects a batch over the cap", async () => {
    const urls = Array.from({ length: 201 }, (_v, i) => `/api/media/image-preview?id=${"a".repeat(20)}${i}&size=thumb`);
    const res = await POST(makeRequest({ urls }));
    expect(res.status).toBe(400);
  });
});
