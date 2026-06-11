"use client";

import { useState, useMemo } from "react";
import { usePipeline } from "@/lib/pipeline-context";
import { PIPELINE_COLUMNS, ContentCard } from "@/lib/types";
import { ChevronLeft, ChevronRight, ChevronDown } from "lucide-react";
import { PlatformIcon } from "@/components/platform-icons";
import { CardThumbnailMedia } from "@/components/card-thumbnail-media";
import { formatDate, isOverdue } from "@/lib/utils";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MAX_VISIBLE = 3;
const EMPTY_CARDS: ContentCard[] = [];

function CalendarChip({ card, onClick }: { card: ContentCard; onClick: () => void }) {
  const col = PIPELINE_COLUMNS.find((c) => c.id === card.stage);
  const stageColor = col?.color ?? "#8b5cf6";
  const overdue = isOverdue(card.scheduledDate);
  const borderColor = overdue ? "#ef4444" : stageColor;
  const bgColor = `${stageColor}26`;

  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-1 py-1.5 px-2 rounded text-left cursor-pointer hover:brightness-95 transition-all overflow-hidden"
      style={{ backgroundColor: bgColor, borderLeft: `3px solid ${borderColor}` }}
    >
      <CardThumbnailMedia card={card} className="w-5 h-5 rounded object-cover shrink-0" />
      <div className="flex items-center gap-0.5 shrink-0">
        {card.platforms.map((p) => (
          <span key={p} className="text-gray-400 dark:text-gray-500">
            <PlatformIcon platform={p} className="w-3 h-3" />
          </span>
        ))}
      </div>
      {card.scheduledTime && (
        <span className="text-[10px] tabular-nums text-gray-400 shrink-0">{card.scheduledTime}</span>
      )}
      <span className="text-[11px] font-medium text-gray-700 dark:text-gray-300 truncate flex-1">
        {card.title}
      </span>
    </button>
  );
}

export function CalendarPage() {
  const { cards, selectCard } = usePipeline();
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [expandedCells, setExpandedCells] = useState<Set<number>>(new Set());

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const calendarDays = useMemo(() => {
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const days: (number | null)[] = [];
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let i = 1; i <= daysInMonth; i++) days.push(i);
    return days;
  }, [year, month]);

  // PERF-003: one-pass index keyed on scheduledDate string. Empty cards array
  // produces an empty Map — getCardsForDay falls back to EMPTY_CARDS safely.
  const cardsByDate = useMemo(() => {
    const map = new Map<string, ContentCard[]>();
    for (const c of cards) {
      if (!c.scheduledDate) continue;
      const arr = map.get(c.scheduledDate);
      if (arr) arr.push(c);
      else map.set(c.scheduledDate, [c]);
    }
    return map;
  }, [cards]);

  const getCardsForDay = (day: number) => {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return cardsByDate.get(dateStr) ?? EMPTY_CARDS;
  };

  // UX-016: mobile agenda — flat chronological list of scheduled cards.
  const scheduledAgenda = useMemo(() =>
    cards
      .filter((c) => !!c.scheduledDate)
      .slice()
      .sort((a, b) => (a.scheduledDate || "").localeCompare(b.scheduledDate || ""))
  , [cards]);

  const today = new Date();
  const isToday = (day: number) =>
    today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;

  const toggleCell = (i: number) => {
    setExpandedCells((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  return (
    <div className="p-4 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div>
          <h1 className="text-[17px] font-semibold text-gray-900 dark:text-white tracking-[-0.02em]">Content Calendar</h1>
          <p className="text-[13px] text-gray-400 mt-0.5">Scheduled content overview</p>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => setCurrentDate(new Date(year, month - 1, 1))} className="p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-white/[0.06] text-gray-400 cursor-pointer">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-[13px] font-medium text-gray-700 dark:text-gray-300 w-36 text-center">
            {formatDate(currentDate, { month: "long", year: "numeric" })}
          </span>
          <button onClick={() => setCurrentDate(new Date(year, month + 1, 1))} className="p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-white/[0.06] text-gray-400 cursor-pointer">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div className="flex-1 bg-white dark:bg-[#151518] rounded-xl border border-gray-200/80 dark:border-white/[0.06] overflow-hidden shadow-sm flex flex-col">
        {/* UX-016: desktop calendar grid */}
        <div className="hidden md:flex md:flex-col md:flex-1 md:overflow-hidden">
          <div className="grid grid-cols-7 border-b border-gray-100 dark:border-white/[0.06] shrink-0">
            {DAYS.map((day) => (
              <div key={day} className="px-2 py-2 text-center">
                <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-[0.06em]">{day}</span>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 flex-1 auto-rows-fr">
            {calendarDays.map((day, i) => {
              const dayCards = day ? getCardsForDay(day) : EMPTY_CARDS;
              const isExpanded = expandedCells.has(i);
              const hiddenCount = dayCards.length - MAX_VISIBLE;
              const visibleCards = isExpanded ? dayCards : dayCards.slice(0, MAX_VISIBLE);

              return (
                <div
                  key={i}
                  className={`min-h-[100px] p-2 border-b border-r border-gray-50 dark:border-white/[0.03] ${
                    !day ? "bg-gray-50/50 dark:bg-white/[0.01]" : "hover:bg-blue-50/30 dark:hover:bg-blue-500/[0.03]"
                  } transition-colors`}
                >
                  {day && (
                    <>
                      <span
                        className={`inline-flex items-center justify-center w-5 h-5 text-[10px] rounded-full mb-1 font-medium ${
                          isToday(day) ? "bg-blue-500 text-white" : "text-gray-500 dark:text-gray-400"
                        }`}
                      >
                        {day}
                      </span>
                      <div className="space-y-1">
                        {visibleCards.map((card) => (
                          <CalendarChip key={card.id} card={card} onClick={() => selectCard(card)} />
                        ))}
                        {!isExpanded && hiddenCount > 0 && (
                          <button
                            onClick={() => toggleCell(i)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-blue-50 hover:bg-blue-100 dark:bg-blue-500/10 text-[10px] text-blue-700 dark:text-blue-400 font-bold cursor-pointer"
                          >
                            +{hiddenCount} more
                            <ChevronDown className="w-2.5 h-2.5" />
                          </button>
                        )}
                        {isExpanded && dayCards.length > MAX_VISIBLE && (
                          <button
                            onClick={() => toggleCell(i)}
                            className="text-[10px] text-blue-500 hover:text-blue-600 font-medium px-2 cursor-pointer"
                          >
                            Show less
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        {/* UX-016: mobile agenda — flat chronological list */}
        <div className="md:hidden flex-1 overflow-y-auto p-3 space-y-2">
          {scheduledAgenda.length > 0 ? (
            scheduledAgenda.map((card) => (
              <div key={card.id} className="space-y-1">
                <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-[0.06em] px-1">
                  {card.scheduledDate}
                </div>
                <CalendarChip card={card} onClick={() => selectCard(card)} />
              </div>
            ))
          ) : (
            <div className="text-center py-12 text-[12px] text-gray-400">No scheduled posts yet</div>
          )}
        </div>
      </div>
    </div>
  );
}
