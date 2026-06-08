import type { ContentCard } from "@/lib/types";

export function resolvePostedArchiveDate(card: ContentCard): string | null {
  return card.postedAt?.slice(0, 10) || card.scheduledDate || card.updatedAt || card.createdAt || null;
}

export function isArchivedPostedCard(card: ContentCard, weekStart: Date): boolean {
  if (card.stage !== "posted") return false;
  const date = resolvePostedArchiveDate(card);
  return Boolean(date && new Date(date) < weekStart);
}

export function isCurrentPostedCard(card: ContentCard, weekStart: Date): boolean {
  if (card.stage !== "posted") return false;
  const date = resolvePostedArchiveDate(card);
  return !date || new Date(date) >= weekStart;
}
