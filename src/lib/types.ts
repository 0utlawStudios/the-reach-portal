export type PipelineStage =
  | "ideas"
  | "awaiting_approval"
  | "revision_needed"
  | "approved_scheduled"
  | "posted";

export type Platform = "instagram" | "tiktok" | "facebook" | "youtube" | "linkedin" | "x";

export type ContentType = "video" | "image" | "carousel" | "reel" | "story";

export interface ChecklistItem {
  id: string;
  label: string;
  checked: boolean;
}

export interface SourceVault {
  designLink?: string;
  driveFolder?: string;
  rawFiles?: { name: string; url: string; uploadedAt: string }[];
}

export interface ContentCard {
  id: string;
  title: string;
  stage: PipelineStage;
  platforms: Platform[];
  contentType: ContentType;
  thumbnailUrl: string;
  scheduledDate?: string;
  scheduledTime?: string;
  caption?: string;
  hook?: string;
  createdAt: string;
  updatedAt: string;
  checklist: ChecklistItem[];
  notes?: string;
  mediaIds?: string[];
  revised?: boolean;
  revisionHistory?: { note: string; by: string; at: string }[];
  sourceVault?: SourceVault;
}

export interface MediaAsset {
  id: string;
  name: string;
  url: string;
  type: "image" | "video";
  folder: string;
  uploadedAt: string;
  uploadedTime?: string;
  addedBy?: string;
  usedIn?: string[];
  scheduledFor?: string;
  platform?: Platform[];
}

export interface PipelineColumn {
  id: PipelineStage;
  title: string;
  color: string;
}

export const PIPELINE_COLUMNS: PipelineColumn[] = [
  { id: "ideas", title: "Ideas", color: "#8b5cf6" },
  { id: "awaiting_approval", title: "Awaiting Approval", color: "#f59e0b" },
  { id: "revision_needed", title: "Revision Needed", color: "#ef4444" },
  { id: "approved_scheduled", title: "Approved / Scheduled", color: "#22c55e" },
  { id: "posted", title: "Posted", color: "#0ea5e9" },
];

export const DEFAULT_CHECKLIST: ChecklistItem[] = [
  { id: "1", label: "Thumbnail/cover image approved", checked: false },
  { id: "2", label: "Caption proofread & hashtags added", checked: false },
  { id: "3", label: "Hook verified (first 3 seconds)", checked: false },
  { id: "4", label: "Call-to-action included", checked: false },
  { id: "5", label: "Brand guidelines followed", checked: false },
  { id: "6", label: "Scheduled date confirmed", checked: false },
];

export const ALL_PLATFORMS: { id: Platform; label: string }[] = [
  { id: "facebook", label: "Facebook" },
  { id: "instagram", label: "Instagram" },
  { id: "x", label: "X" },
  { id: "linkedin", label: "LinkedIn" },
  { id: "youtube", label: "YouTube" },
  { id: "tiktok", label: "TikTok" },
];
