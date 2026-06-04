"use client";

import { memo, useMemo } from "react";
import { RawImage } from "@/components/raw-image";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ContentCard as ContentCardType, Platform, isPlatform } from "@/lib/types";
import { usePipeline } from "@/lib/pipeline-context";
import { PlatformIcon } from "./platform-icons";
import { Calendar, AlertCircle, Bot, Sparkles, GripVertical } from "lucide-react";
import { isUrgent, isOverdue, formatDateShort } from "@/lib/utils";

interface Props {
  card: ContentCardType;
  isDragOverlay?: boolean;
  stageColor?: string;
}

function ContentCardInner({ card, isDragOverlay, stageColor }: Props) {
  const { selectCard, selectCardForEditing } = usePipeline();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    data: { card },
    transition: {
      duration: 200,
      easing: "cubic-bezier(0.25, 1, 0.5, 1)",
    },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  // PERF-006: single useMemo collapses six per-render derivations into one pass.
  const derived = useMemo(() => {
    const checkedCount = card.checklist.filter((c) => c.checked).length;
    const totalChecklist = card.checklist.length;
    const urgent = isUrgent(card.scheduledDate);
    const overdue = card.stage !== "posted" && card.stage !== "ideas" && isOverdue(card.scheduledDate);
    const publishState = card.publishJob?.state;
    const verifiedPlatforms = Array.from(new Set(
      (card.publishJob?.platformAttempts || [])
        .filter((attempt) => attempt.externalPostId !== null && isPlatform(attempt.platform))
        .map((attempt) => attempt.platform as Platform),
    ));
    const showAutoPostedBadge =
      card.stage === "posted" &&
      !!card.publishJob &&
      (publishState === "succeeded" || publishState === "partial") &&
      verifiedPlatforms.length > 0;
    return { checkedCount, totalChecklist, urgent, overdue, publishState, verifiedPlatforms, showAutoPostedBadge };
  }, [card]);
  const { checkedCount, totalChecklist, urgent, overdue, publishState, verifiedPlatforms, showAutoPostedBadge } = derived;

  const cardContent = (
    <>
      {/* Colored top accent bar */}
      <div className="h-[3px] w-full" style={{ backgroundColor: overdue ? "#dc2626" : (stageColor || "#3b82f6") }} />
      <div className="relative h-[76px] w-full overflow-hidden bg-gray-50 dark:bg-white/[0.03]">
        <RawImage src={card.thumbnailUrl} alt={card.title} className="w-full h-full object-cover" draggable={false} />
        <div className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/50 backdrop-blur-sm text-white text-[9px] font-medium capitalize flex items-center gap-1">
          {card.contentType}
          {card.contentType === "carousel" && (card.sourceVault?.rawFiles?.length || 0) > 1 && (
            <span className="bg-white/20 px-1 rounded text-[8px]">{card.sourceVault!.rawFiles!.length}</span>
          )}
        </div>
        {overdue && <div className="absolute bottom-1.5 left-1.5 px-2 py-[3px] rounded-full bg-red-600 text-[8px] font-bold text-white uppercase tracking-wider shadow-md shadow-red-500/30 flex items-center gap-1 animate-pulse"><span className="w-1.5 h-1.5 rounded-full bg-white" />Action Needed</div>}
        {card.revised && !overdue && <div className="absolute bottom-1.5 left-1.5 px-2 py-[3px] rounded-full bg-violet-600 text-[8px] font-bold text-white uppercase tracking-wider shadow-md shadow-violet-500/30 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-white/80 animate-pulse" />Revised</div>}
        {showAutoPostedBadge && (
          <div
            title={card.postedAt ? `Live since ${new Date(card.postedAt).toLocaleString()}` : undefined}
            className={`absolute bottom-1.5 left-1.5 px-2 py-[3px] rounded-full text-[8px] font-bold text-white uppercase tracking-wider shadow-md flex items-center gap-1 ${
              publishState === "partial"
                ? "bg-amber-500 shadow-amber-500/30"
                : "bg-emerald-600 shadow-emerald-500/30"
            }`}
          >
            <Bot className="w-2.5 h-2.5" />
            <span>{publishState === "partial" ? "Partial" : "Live"}</span>
            <span className="flex items-center gap-0.5 pl-0.5">
              {verifiedPlatforms.map((platform) => {
                const liveUrl = card.postedUrls?.[platform];
                const icon = <PlatformIcon platform={platform} className="w-2.5 h-2.5" />;
                return liveUrl ? (
                  <a
                    key={platform}
                    href={liveUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                    title={`Open live post on ${platform}`}
                    className="hover:opacity-75 transition-opacity"
                  >
                    {icon}
                  </a>
                ) : (
                  <span key={platform}>{icon}</span>
                );
              })}
            </span>
          </div>
        )}
        {card.notes && !card.revised && <div className="absolute top-1.5 left-1.5 w-4 h-4 rounded-full bg-amber-500 flex items-center justify-center" title="Has revision notes"><AlertCircle className="w-2.5 h-2.5 text-white" /></div>}
        {card.generatedByModel && (
          <div className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded bg-violet-600/85 backdrop-blur-sm text-white text-[8.5px] font-bold uppercase tracking-wider flex items-center gap-0.5 shadow-md shadow-violet-500/30" title={`AI generated · ${card.generatedByModel}${card.revisionCount ? ` · v${card.revisionCount + 1}` : ""}`}>
            <Sparkles className="w-2.5 h-2.5" />
            AI
            {card.aspectRatio && <span className="ml-1 font-mono font-medium opacity-90 normal-case tracking-normal">{card.aspectRatio}</span>}
          </div>
        )}
      </div>
      <div className="px-2.5 pt-2 pb-1.5 space-y-1">
        <h3 className="text-[11px] font-semibold text-gray-800 dark:text-gray-200 leading-tight line-clamp-2">{card.title}</h3>
        <div className="flex items-center gap-1.5 flex-wrap">
          {card.platforms.map((p) => (
            <span key={p} className="text-gray-400 dark:text-gray-500"><PlatformIcon platform={p} className="w-3 h-3" /></span>
          ))}
        </div>
        <div className="flex items-center justify-between">
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); selectCardForEditing(card); }}
            className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md cursor-pointer hover:ring-1 hover:ring-orange-300 transition-all ${
              card.scheduledDate
                ? overdue ? "text-red-600 font-bold bg-red-50 dark:bg-red-500/10 ring-1 ring-red-200 dark:ring-red-500/20" : urgent ? "text-red-500 font-semibold bg-red-50 dark:bg-red-500/10" : "text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-white/[0.04]"
                : "text-orange-400 bg-orange-50 dark:bg-orange-500/10 border border-dashed border-orange-200 dark:border-orange-500/20"
            }`}
          >
            <Calendar className="w-2.5 h-2.5" />
            {card.scheduledDate ? (
              <>
                {formatDateShort(card.scheduledDate)}
                {card.scheduledTime && <span className="text-gray-400 dark:text-gray-500">{card.scheduledTime}</span>}
                {overdue && <span className="text-[8px] bg-red-200 dark:bg-red-500/20 text-red-600 dark:text-red-400 px-1 rounded font-bold">OVERDUE</span>}
                {urgent && !overdue && <span className="text-[8px] bg-red-200 dark:bg-red-500/20 text-red-600 dark:text-red-400 px-1 rounded font-bold">SOON</span>}
              </>
            ) : (
              <span>Set date</span>
            )}
          </button>
          <div className="flex items-center gap-1 ml-auto">
            <div className="w-10 h-[3px] rounded-full bg-gray-100 dark:bg-white/[0.06] overflow-hidden">
              <div className="h-full rounded-full bg-gradient-to-r from-orange-500 to-yellow-500" style={{ width: `${(checkedCount / totalChecklist) * 100}%` }} />
            </div>
            <span className="text-[8px] text-gray-300 dark:text-gray-600 tabular-nums">{checkedCount}/{totalChecklist}</span>
          </div>
        </div>
      </div>
    </>
  );

  if (isDragOverlay) {
    return (
      <div className="rounded-xl overflow-hidden bg-white dark:bg-[#1a1a1a] border-2 border-orange-400 dark:border-orange-500 shadow-[0_20px_60px_rgba(234,88,12,0.2)] w-[220px] rotate-0 scale-100 md:rotate-[2deg] md:scale-105 pointer-events-none">
        {cardContent}
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-testid={`content-card-${card.id}`}
      data-stage={card.stage}
      onClick={() => !isDragging && selectCard(card)}
      className={`group relative rounded-xl overflow-hidden cursor-pointer bg-white dark:bg-[#151518] border hover:shadow-md transition-all duration-200 shadow-[0_1px_3px_rgba(0,0,0,0.04)] ${isDragging ? "opacity-20 scale-[0.97]" : "hover:-translate-y-0.5"} ${overdue ? "border-red-300 dark:border-red-500/30 shadow-red-100 dark:shadow-red-500/5" : "border-gray-200/80 dark:border-white/[0.06] hover:border-gray-300 dark:hover:border-white/[0.12]"}`}
    >
      {/* UX-012: Ten80Ten drag contract — drag starts from a real handle. */}
      <button
        type="button"
        {...attributes}
        {...listeners}
        onClick={(e) => e.stopPropagation()}
        aria-label="Drag card"
        data-testid={`content-card-drag-handle-${card.id}`}
        className="absolute top-1 left-1 z-10 flex h-11 w-11 items-center justify-center rounded-md text-[#E1DFD5] opacity-100 cursor-grab active:cursor-grabbing transition-opacity duration-200 touch-none"
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[#6C655A]/80 backdrop-blur-sm ring-1 ring-[#E1DFD5]/35 hover:bg-[#6C655A] transition-colors duration-200">
          <GripVertical className="w-3 h-3" />
        </span>
      </button>
      {cardContent}
    </div>
  );
}

// PERF-006: memoize with a custom comparator so a card only re-renders when
// the object identity or its stage color / drag state actually changes.
export const ContentCard = memo(ContentCardInner, (a, b) =>
  a.card === b.card && a.stageColor === b.stageColor && a.isDragOverlay === b.isDragOverlay,
);
