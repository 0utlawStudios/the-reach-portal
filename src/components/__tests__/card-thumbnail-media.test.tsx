import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CardThumbnailMedia } from "../card-thumbnail-media";
import type { ContentCard } from "@/lib/types";

vi.mock("@/lib/media-view-url", () => ({
  isPrivateMediaRouteUrl: () => false,
  signedMediaViewUrl: vi.fn(),
}));

function card(overrides: Partial<ContentCard>): Pick<ContentCard, "title" | "contentType" | "thumbnailUrl" | "mediaIds" | "sourceVault"> {
  return {
    title: "Greece, quietly.",
    contentType: "video",
    thumbnailUrl: "",
    ...overrides,
  };
}

describe("CardThumbnailMedia", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders video cards from the raw video stream instead of treating the thumbnail as an image", () => {
    render(
      <CardThumbnailMedia
        card={card({
          thumbnailUrl: "/api/drive/stream?id=raw-video",
          sourceVault: {
            thumbnailFileId: "raw-video",
            rawFiles: [{
              name: "greece.mp4",
              url: "/api/drive/stream?id=raw-video",
              fileId: "raw-video",
              usageType: "master",
              mimeType: "video/mp4",
              uploadedAt: "2026-06-11T00:00:00.000Z",
            }],
          },
        })}
        className="thumb"
      />,
    );

    expect(screen.getByLabelText("Greece, quietly. video preview")).toHaveAttribute("src", "/api/drive/stream?id=raw-video#t=0.1");
  });

  it("renders distinct Drive poster files as images instead of loading the video", () => {
    render(
      <CardThumbnailMedia
        card={card({
          title: "Poster",
          thumbnailUrl: "/api/drive/stream?id=poster",
          sourceVault: {
            thumbnailFileId: "poster",
            thumbnailMimeType: "image/jpeg",
            rawFiles: [{
              name: "greece.mp4",
              url: "/api/drive/stream?id=raw-video",
              fileId: "raw-video",
              usageType: "master",
              mimeType: "video/mp4",
              uploadedAt: "2026-06-11T00:00:00.000Z",
            }],
          },
        })}
        className="thumb"
      />,
    );

    expect(screen.getByAltText("Poster").tagName).toBe("IMG");
  });

  it("keeps reliable image posters as images", () => {
    render(
      <CardThumbnailMedia
        card={card({
          title: "Poster",
          thumbnailUrl: "/api/drive/stream?id=poster",
          sourceVault: { thumbnailMimeType: "image/jpeg" },
        })}
        className="thumb"
      />,
    );

    expect(screen.getByAltText("Poster").tagName).toBe("IMG");
  });

  it("falls back to the video stream when a poster image never loads", async () => {
    vi.useFakeTimers();
    render(
      <CardThumbnailMedia
        card={card({
          title: "Slow poster",
          thumbnailUrl: "/api/drive/stream?id=poster",
          sourceVault: {
            thumbnailFileId: "poster",
            thumbnailMimeType: "image/jpeg",
            rawFiles: [{
              name: "slow.mp4",
              url: "/api/drive/stream?id=raw-video",
              fileId: "raw-video",
              usageType: "master",
              mimeType: "video/mp4",
              uploadedAt: "2026-06-11T00:00:00.000Z",
            }],
          },
        })}
        className="thumb"
      />,
    );

    expect(screen.getByAltText("Slow poster").tagName).toBe("IMG");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_001);
    });
    expect(screen.getByLabelText("Slow poster video preview")).toHaveAttribute("src", "/api/drive/stream?id=raw-video#t=0.1");
  });
});
