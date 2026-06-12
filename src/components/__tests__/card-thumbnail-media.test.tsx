import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CardThumbnailMedia } from "../card-thumbnail-media";
import type { ContentCard } from "@/lib/types";

function card(overrides: Partial<ContentCard>): Pick<ContentCard, "title" | "contentType" | "thumbnailUrl" | "mediaIds" | "sourceVault"> {
  return {
    title: "Greece, quietly.",
    contentType: "video",
    thumbnailUrl: "",
    ...overrides,
  };
}

describe("CardThumbnailMedia", () => {
  it("renders video cards from the raw video stream instead of treating the thumbnail as an image", () => {
    render(
      <CardThumbnailMedia
        card={card({
          thumbnailUrl: "/api/drive/stream?id=poster",
          sourceVault: {
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
});
