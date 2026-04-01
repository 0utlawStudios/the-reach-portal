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
