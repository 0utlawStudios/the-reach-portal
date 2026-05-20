"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { ContentCard as ContentCardType, PipelineColumn as PipelineColumnType } from "@/lib/types";
import { ContentCard } from "./content-card";
import { SkeletonCard } from "./skeleton-card";

interface Props {
  column: PipelineColumnType;
  cards: ContentCardType[];
  isLoading: boolean;
  /** UX-007: callback ref on the column root so KanbanBoard can scrollIntoView. */
  columnRef?: (el: HTMLDivElement | null) => void;
}

// PERF-006: isLoading arrives as a prop instead of via usePipeline(). The
// context subscription previously re-rendered every column on any card
// mutation; KanbanBoard now reads isLoading once and passes it down.
export function PipelineColumn({ column, cards, isLoading, columnRef }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });

  return (
    <div ref={columnRef} className="flex flex-col flex-1 min-w-[240px] sm:min-w-[190px] snap-start">
      {/* Column header */}
      <div className="flex items-center gap-2.5 px-3 py-2.5 mb-2">
        <div className="w-2.5 h-2.5 rounded-full shrink-0 shadow-sm" style={{ backgroundColor: column.color, boxShadow: `0 0 6px ${column.color}40` }} />
        <h2 className="text-[11px] font-bold text-gray-600 dark:text-gray-400 uppercase tracking-[0.06em]">{column.title}</h2>
        <span className="ml-auto text-[10px] text-gray-400 dark:text-gray-500 font-semibold tabular-nums bg-white dark:bg-white/[0.06] px-2 py-0.5 rounded-md border border-gray-100 dark:border-white/[0.06] shadow-sm">{cards.length}</span>
      </div>
      {/* Drop zone lane */}
      <div
        ref={setNodeRef}
        style={!isOver ? { borderColor: `${column.color}18` } : undefined}
        className={`flex-1 rounded-xl p-2 transition-all duration-150 overflow-y-auto border ${
          isOver
            ? "bg-orange-50/50 dark:bg-orange-500/[0.04] border-orange-300/60 dark:border-orange-500/20 ring-2 ring-orange-200/50 dark:ring-orange-500/10"
            : "bg-slate-50/50 dark:bg-white/[0.015]"
        }`}
      >
        <SortableContext items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-2.5 p-0.5">
            {cards.map((card) => <ContentCard key={card.id} card={card} stageColor={column.color} />)}
            {isLoading && cards.length === 0 && (
              <div className="space-y-2.5">
                {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
              </div>
            )}
            {!isLoading && cards.length === 0 && (
              <div className="py-10 text-center">
                <div className="w-8 h-8 rounded-full mx-auto mb-2 flex items-center justify-center" style={{ backgroundColor: `${column.color}10` }}>
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: `${column.color}40` }} />
                </div>
                <p className="text-[11px] text-gray-300 dark:text-gray-600 font-medium">Drop content here</p>
              </div>
            )}
          </div>
        </SortableContext>
      </div>
    </div>
  );
}
