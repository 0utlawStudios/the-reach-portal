import type { ContentCard, PipelineStage } from "@/lib/types";
import { hasPublishingMedia } from "@/lib/publishing-media";

export type PostReadinessIssueId =
  | "title"
  | "platforms"
  | "postDateTime"
  | "thumbnail"
  | "contentForPublishing"
  | "caption"
  | "assetSource"
  | "checklist";

export type PostReadinessIssue = {
  id: PostReadinessIssueId;
  label: string;
  guidance: string;
};

const ISSUE_COPY: Record<PostReadinessIssueId, Omit<PostReadinessIssue, "id">> = {
  title: {
    label: "Title",
    guidance: "Enter a descriptive title at the top of the post form.",
  },
  platforms: {
    label: "Platforms",
    guidance: "Select at least one platform before moving this post to Awaiting Approval.",
  },
  postDateTime: {
    label: "Post date and time",
    guidance: "Set both the date and time in the schedule area before this post moves forward.",
  },
  thumbnail: {
    label: "Thumbnail",
    guidance: "Upload or select a cover image so the card has a visible preview.",
  },
  contentForPublishing: {
    label: "Content for publishing",
    guidance: "Add the final image or video in Source Vault, Raw Project Files, or choose it from the Media Library.",
  },
  caption: {
    label: "Caption",
    guidance: "Write the full caption on the Content tab before this post moves forward.",
  },
  assetSource: {
    label: "Asset source",
    guidance: "Choose where the media came from on the Content tab, Asset Source.",
  },
  checklist: {
    label: "Checklist",
    guidance: "Complete the checklist before submitting for approval. In Create New Post, it is on the Checklist tab.",
  },
};

function issue(id: PostReadinessIssueId): PostReadinessIssue {
  return { id, ...ISSUE_COPY[id] };
}

export function stageRequiresPostReadiness(targetStage: PipelineStage | null | undefined): boolean {
  return targetStage === "awaiting_approval" || targetStage === "approved_scheduled";
}

export function getPostReadinessIssues(card: Pick<
  ContentCard,
  "title" | "platforms" | "scheduledDate" | "scheduledTime" | "thumbnailUrl" | "caption" | "assetSource" | "checklist" | "sourceVault" | "assetUrls"
>): PostReadinessIssue[] {
  const issues: PostReadinessIssue[] = [];
  if (!card.title?.trim()) issues.push(issue("title"));
  if (!Array.isArray(card.platforms) || card.platforms.length === 0) issues.push(issue("platforms"));
  if (!card.scheduledDate || !card.scheduledTime) issues.push(issue("postDateTime"));
  if (!card.thumbnailUrl) issues.push(issue("thumbnail"));
  if (!hasPublishingMedia(card)) issues.push(issue("contentForPublishing"));
  if (!card.caption?.trim()) issues.push(issue("caption"));
  if (!card.assetSource?.trim()) issues.push(issue("assetSource"));
  const checklist = card.checklist || [];
  if (checklist.length === 0 || checklist.some((item) => !item.checked)) issues.push(issue("checklist"));
  return issues;
}
