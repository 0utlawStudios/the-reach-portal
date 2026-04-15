"use client";

import { RawImage } from "@/components/raw-image";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ContentCard as ContentCardType } from "@/lib/types";
import { usePipeline } from "@/lib/pipeline-context";
import { PlatformIcon } from "./platform-icons";
import { Calendar, AlertCircle } from "lucide-react";

interface Props {
  card: ContentCardType;
  isDragOverlay?: boolean;
  stageColor?: string;
}

function isUrgent(dateStr?: string): boolean {
  if (!dateStr) return false;
  const diff = (new Date(dateStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  return diff <= 2 && diff >= 0;
}

function isOverdue(dateStr?: string): boolean {
  if (!dateStr) return false;
  const now = new Date();
  const scheduled = new Date(dateStr);
  return scheduled < now;
}

export function ContentCard({ card, isDragOverlay, stageColor }: Props) {
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

  const checkedCount = card.checklist.filter((c) => c.checked).length;
  const totalChecklist = card.checklist.length;
  const urgent = isUrgent(card.scheduledDate);
  const overdue = card.stage !== "posted" && card.stage !== "ideas" && isOverdue(card.scheduledDate);

  const cardContent = (
    <>
      {/* Colored top accent bar */}
      <div className="h-[3px] w-full" style={{ backgroundColor: overdue ? "#dc2626" : (stageColor || "#3b82f6") }} />
      <div className="relative h-[76px] w-full overflow-hidden bg-gray-50 dark:bg-white/[0.03]">
        <RawImage src={card.thumbnailUrl} alt={card.title} className="w-full h-full object-cover" />
        <div className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/50 backdrop-blur-sm text-white text-[9px] font-medium capitalize">{card.contentType}</div>
        {overdue && <div className="absolute bottom-1.5 left-1.5 px-2 py-[3px] rounded-full bg-red-600 text-[8px] font-bold text-white uppercase tracking-wider shadow-md shadow-red-500/30 flex items-center gap-1 animate-pulse"><span className="w-1.5 h-1.5 rounded-full bg-white" />Action Needed</div>}
        {card.revised && !overdue && <div className="absolute bottom-1.5 left-1.5 px-2 py-[3px] rounded-full bg-violet-600 text-[8px] font-bold text-white uppercase tracking-wider shadow-md shadow-violet-500/30 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-white/80 animate-pulse" />Revised</div>}
        {card.notes && !card.revised && <div className="absolute top-1.5 left-1.5 w-4 h-4 rounded-full bg-amber-500 flex items-center justify-center" title="Has revision notes"><AlertCircle className="w-2.5 h-2.5 text-white" /></div>}
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
                {new Date(card.scheduledDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
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
      <div className="rounded-xl overflow-hidden bg-white dark:bg-[#1a1a1a] border-2 border-orange-400 dark:border-orange-500 shadow-[0_20px_60px_rgba(234,88,12,0.2)] w-[220px] rotate-[2deg] scale-105 pointer-events-none">
        {cardContent}
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => !isDragging && selectCard(card)}
      className={`group rounded-xl overflow-hidden cursor-pointer bg-white dark:bg-[#151518] border hover:shadow-md transition-all duration-200 shadow-[0_1px_3px_rgba(0,0,0,0.04)] ${isDragging ? "opacity-20 scale-[0.97]" : "hover:-translate-y-0.5"} ${overdue ? "border-red-300 dark:border-red-500/30 shadow-red-100 dark:shadow-red-500/5" : "border-gray-200/80 dark:border-white/[0.06] hover:border-gray-300 dark:hover:border-white/[0.12]"}`}
    >
      {cardContent}
    </div>
  );
}
