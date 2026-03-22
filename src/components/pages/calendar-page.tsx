"use client";

import { useState, useMemo } from "react";
import { usePipeline } from "@/lib/pipeline-context";
import { PIPELINE_COLUMNS } from "@/lib/types";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { PlatformIcon } from "@/components/platform-icons";
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function CalendarPage() {
  const { cards, selectCard } = usePipeline();
  const [currentDate, setCurrentDate] = useState(() => new Date());
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

  const getCardsForDay = (day: number) => {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return cards.filter((c) => c.scheduledDate === dateStr);
  };

  const today = new Date();
  const isToday = (day: number) => today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;

  return (
    <div className="p-4 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div>
          <h1 className="text-[17px] font-semibold text-gray-900 dark:text-white tracking-[-0.02em]">Content Calendar</h1>
          <p className="text-[13px] text-gray-400 mt-0.5">Scheduled content overview</p>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => setCurrentDate(new Date(year, month - 1, 1))} className="p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-white/[0.06] text-gray-400 cursor-pointer"><ChevronLeft className="w-4 h-4" /></button>
          <span className="text-[13px] font-medium text-gray-700 dark:text-gray-300 w-36 text-center">{currentDate.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</span>
          <button onClick={() => setCurrentDate(new Date(year, month + 1, 1))} className="p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-white/[0.06] text-gray-400 cursor-pointer"><ChevronRight className="w-4 h-4" /></button>
        </div>
      </div>
      <div className="flex-1 bg-white dark:bg-[#151518] rounded-xl border border-gray-200/80 dark:border-white/[0.06] overflow-hidden shadow-sm flex flex-col">
        <div className="grid grid-cols-7 border-b border-gray-100 dark:border-white/[0.06] shrink-0">
          {DAYS.map((day) => <div key={day} className="px-2 py-2 text-center"><span className="text-[10px] font-semibold text-gray-400 uppercase tracking-[0.06em]">{day}</span></div>)}
        </div>
        <div className="grid grid-cols-7 flex-1 auto-rows-fr">
          {calendarDays.map((day, i) => {
            const dayCards = day ? getCardsForDay(day) : [];
            return (
              <div key={i} className={`min-h-[80px] p-1.5 border-b border-r border-gray-50 dark:border-white/[0.03] ${!day ? "bg-gray-50/50 dark:bg-white/[0.01]" : "hover:bg-blue-50/30 dark:hover:bg-blue-500/[0.03]"} transition-colors`}>
                {day && (
                  <>
                    <span className={`inline-flex items-center justify-center w-5 h-5 text-[10px] rounded-full mb-1 font-medium ${isToday(day) ? "bg-blue-500 text-white" : "text-gray-500 dark:text-gray-400"}`}>{day}</span>
                    <div className="space-y-0.5">
                      {dayCards.map((card) => {
                        const col = PIPELINE_COLUMNS.find((c) => c.id === card.stage);
                        return (
                          <button key={card.id} onClick={() => selectCard(card)} className="w-full flex items-center gap-1 px-1.5 py-0.5 rounded text-left cursor-pointer hover:brightness-95 transition-all" style={{ backgroundColor: `${col?.color}18` }}>
                            <span className="shrink-0 text-gray-500 dark:text-gray-400"><PlatformIcon platform={card.platforms[0]} className="w-2.5 h-2.5" /></span>
                            <span className="text-[9px] text-gray-600 dark:text-gray-400 truncate flex-1 font-medium">{card.title}</span>
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
