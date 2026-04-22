"use client";

export function SkeletonCard() {
  return (
    <div className="rounded-xl overflow-hidden bg-white dark:bg-[#1a1a1a] border border-gray-100 dark:border-white/[0.04] shadow-sm animate-pulse">
      {/* Image area */}
      <div className="w-full h-[76px] bg-gray-100 dark:bg-white/[0.06]" />
      <div className="p-2.5 space-y-2">
        {/* Title bar */}
        <div className="h-2.5 rounded bg-gray-100 dark:bg-white/[0.06] w-3/4" />
        <div className="h-2 rounded bg-gray-100 dark:bg-white/[0.06] w-1/2" />
        {/* Platform icons row */}
        <div className="flex gap-1.5 pt-0.5">
          <div className="w-3.5 h-3.5 rounded-full bg-gray-100 dark:bg-white/[0.06]" />
          <div className="w-3.5 h-3.5 rounded-full bg-gray-100 dark:bg-white/[0.06]" />
        </div>
        {/* Date / checklist row */}
        <div className="flex items-center justify-between pt-0.5">
          <div className="h-2 rounded bg-gray-100 dark:bg-white/[0.06] w-16" />
          <div className="h-2 rounded bg-gray-100 dark:bg-white/[0.06] w-8" />
        </div>
      </div>
    </div>
  );
}
