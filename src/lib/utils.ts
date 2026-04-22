import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** App-wide timezone — Central Standard Time (Nashville, TN) */
export const APP_TIMEZONE = "America/Chicago";

/** Format a date with CST timezone */
export function formatDate(date: Date | string, options?: Intl.DateTimeFormatOptions): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString("en-US", { timeZone: APP_TIMEZONE, ...options });
}

/** "Apr 20, 2026, 3:45 PM CT" — full date+time with timezone indicator */
export function formatDateTime(date: Date | string): string {
  return formatDate(date, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

/** "Apr 20" — compact date only */
export function formatDateShort(date: Date | string): string {
  return formatDate(date, { month: "short", day: "numeric" });
}

/** "Apr 20, 3:45 PM" — compact date+time, no TZ indicator */
export function formatDateTimeCompact(date: Date | string): string {
  return formatDate(date, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** True if scheduled date is within the next 2 days */
export function isUrgent(dateStr?: string): boolean {
  if (!dateStr) return false;
  const diff = (new Date(dateStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  return diff <= 2 && diff >= 0;
}

/** True if scheduled date is in the past */
export function isOverdue(dateStr?: string): boolean {
  if (!dateStr) return false;
  return new Date(dateStr) < new Date();
}
