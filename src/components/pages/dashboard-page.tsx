"use client";

import { useMemo, useState, useEffect } from "react";
import { usePipeline } from "@/lib/pipeline-context";
import { useNavigation } from "@/lib/navigation-context";
import { PIPELINE_COLUMNS, Platform } from "@/lib/types";
import { PlatformIcon } from "@/components/platform-icons";
import { AnimatedCounter, AnimatedBar } from "@/components/animated";
import { Lightbulb, Clock, RotateCcw, CalendarCheck, Rocket, ArrowRight, Zap, Eye, TrendingUp, BarChart3, Target, AlertCircle, Calendar, CheckCircle, ChevronLeft, ChevronRight, Plus, Palette, Users, Kanban } from "lucide-react";
import { useAuth } from "@/lib/auth-context";

const stageIcons = [Lightbulb, Clock, RotateCcw, CalendarCheck, Rocket];

export function DashboardPage() {
  const { cards } = usePipeline();
  const { navigate } = useNavigation();
  const { currentUser } = useAuth();
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  const totalCards = cards.length;
  const pendingApproval = cards.filter((c) => c.stage === "awaiting_approval").length;
  const needsRevision = cards.filter((c) => c.stage === "revision_needed").length;
  const postedCount = cards.filter((c) => c.stage === "posted").length;
  const scheduledCount = cards.filter((c) => c.stage === "approved_scheduled").length;
  const approvedCount = scheduledCount + postedCount;
  const completionPct = totalCards > 0 ? Math.round((approvedCount / totalCards) * 100) : 0;
  const isOwner = true;

  const upcomingPosts = useMemo(() =>
    cards.filter((c) => c.scheduledDate && (c.stage === "approved_scheduled" || c.stage === "awaiting_approval"))
      .sort((a, b) => (a.scheduledDate || "").localeCompare(b.scheduledDate || "")).slice(0, 5)
  , [cards]);

  const recentPosted = useMemo(() =>
    cards.filter((c) => c.stage === "posted").sort((a, b) => (b.scheduledDate || b.updatedAt).localeCompare(a.scheduledDate || a.updatedAt)).slice(0, 5)
  , [cards]);

  const platformCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    cards.forEach((c) => c.platforms.forEach((p) => { counts[p] = (counts[p] || 0) + 1; }));
    return Object.entries(counts).sort(([, a], [, b]) => b - a);
  }, [cards]);

  const stageCounts = PIPELINE_COLUMNS.map((col) => ({
    ...col,
    count: cards.filter((c) => c.stage === col.id).length,
    pct: totalCards > 0 ? (cards.filter((c) => c.stage === col.id).length / totalCards) * 100 : 0,
  }));

  return (
    <div className="p-3 sm:p-4 space-y-2.5 w-full h-full overflow-y-auto overflow-x-hidden flex flex-col">
      {/* Welcome Banner */}
      <div className="relative bg-white dark:bg-[#151518] rounded-2xl border border-gray-100 dark:border-white/[0.06] p-4 sm:p-5 shadow-sm overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-orange-50 via-orange-50/30 to-transparent dark:from-orange-500/[0.04] dark:via-transparent pointer-events-none" />
        <div className="relative flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3.5">
            {currentUser.avatar ? (
              <img src={currentUser.avatar} alt={currentUser.name} className="w-11 h-11 rounded-xl object-cover shadow-md ring-2 ring-orange-100 dark:ring-orange-500/20" />
            ) : (
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-orange-500 to-yellow-600 flex items-center justify-center text-white text-[14px] font-bold shadow-md shadow-orange-500/20">{currentUser.initials}</div>
            )}
            <div>
              <h1 className="text-[18px] font-extrabold text-slate-900 dark:text-white tracking-tight">Welcome back, {currentUser.name.split(" ")[0]}</h1>
              {pendingApproval > 0 ? (
                <p className="text-[13px] text-gray-500 dark:text-gray-400 mt-0.5 flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 text-orange-500" />
                  You have <span className="font-semibold text-orange-600 dark:text-orange-400">{pendingApproval} post{pendingApproval !== 1 ? "s" : ""} awaiting approval.</span>
                </p>
              ) : (
                <p className="text-[13px] text-gray-400 mt-0.5 flex items-center gap-1.5"><CheckCircle className="w-3.5 h-3.5 text-emerald-500" />All caught up — no posts pending.</p>
              )}
            </div>
          </div>
          {pendingApproval > 0 && (
            <button onClick={() => navigate("pipeline")} className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white text-[12px] font-semibold shadow-md shadow-orange-500/20 cursor-pointer transition-all duration-200 shrink-0">
              Review Posts <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Row 1: Funnel + Scorecard + Platforms */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-2.5 flex-1 min-h-0">
        {/* Pipeline funnel */}
        <div className="md:col-span-1 lg:col-span-5 bg-white dark:bg-[#151518] rounded-2xl border border-gray-100 dark:border-white/[0.06] p-4 shadow-sm h-full">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[12px] font-bold text-gray-700 dark:text-gray-300 flex items-center gap-2"><BarChart3 className="w-4 h-4 text-orange-500" />Pipeline Funnel</h2>
            <span className="text-[9px] text-gray-400 bg-gray-50 dark:bg-white/[0.04] px-2 py-0.5 rounded-full font-medium uppercase tracking-wider">This week</span>
          </div>
          <div className="space-y-3">
            {stageCounts.map((col, i) => {
              const Icon = stageIcons[i];
              return (
                <button key={col.id} onClick={() => navigate("pipeline")} className="w-full flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-white/[0.02] -mx-2 px-2 py-0.5 rounded-lg transition-all duration-200 cursor-pointer">
                  <span style={{ color: col.color }} className="shrink-0"><Icon className="w-4 h-4" /></span>
                  <span className="text-[11px] text-gray-600 dark:text-gray-400 w-24 shrink-0 font-medium text-left">{col.title.split("/")[0].trim()}</span>
                  <div className="flex-1 h-2.5 rounded-full bg-gray-100 dark:bg-white/[0.04] overflow-hidden">
                    {mounted && <AnimatedBar width={Math.max(col.pct, 3)} color={`linear-gradient(90deg, ${col.color}, ${col.color}aa)`} delay={i * 100} duration={2000} />}
                  </div>
                  <span className="text-[13px] text-gray-800 dark:text-gray-200 tabular-nums w-5 text-right font-bold">
                    {mounted ? <AnimatedCounter value={col.count} duration={2000} /> : "0"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Weekly Scorecard */}
        <div className="lg:col-span-3 bg-white dark:bg-[#151518] rounded-2xl border border-gray-100 dark:border-white/[0.06] p-4 shadow-sm h-full">
          <h2 className="text-[12px] font-bold text-gray-700 dark:text-gray-300 flex items-center gap-2 mb-4"><Target className="w-4 h-4 text-orange-500" />Weekly Scorecard</h2>
          <div className="space-y-3">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] text-gray-500 dark:text-gray-400 font-medium">Approval Rate</span>
                <span className="text-[15px] font-black text-gray-900 dark:text-white tabular-nums">
                  {mounted ? <AnimatedCounter value={completionPct} duration={2000} suffix="%" /> : "0%"}
                </span>
              </div>
              <div className="w-full h-2.5 rounded-full bg-gray-100 dark:bg-white/[0.04] overflow-hidden">
                {mounted && <AnimatedBar width={completionPct} color="linear-gradient(90deg, #ea580c, #ca8a04)" delay={200} duration={2000} />}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 pt-1">
              {[
                { label: "Published", value: postedCount, color: "text-slate-800 dark:text-gray-200" },
                { label: "In Review", value: pendingApproval + needsRevision, color: "text-orange-600 dark:text-orange-400" },
                { label: "Scheduled", value: scheduledCount, color: "text-yellow-700 dark:text-yellow-400" },
                { label: "Platforms", value: platformCounts.length, color: "text-slate-600 dark:text-gray-300" },
              ].map((s) => (
                <div key={s.label} className="bg-gray-50 dark:bg-white/[0.03] rounded-xl p-2.5 text-center border border-gray-100 dark:border-white/[0.04]">
                  <p className={`text-[18px] font-black tabular-nums ${s.color}`}>
                    {mounted ? <AnimatedCounter value={s.value} duration={2000} /> : "0"}
                  </p>
                  <p className="text-[8px] text-gray-400 font-semibold uppercase tracking-wider">{s.label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Platform distribution */}
        <div className="lg:col-span-4 bg-white dark:bg-[#151518] rounded-2xl border border-gray-100 dark:border-white/[0.06] p-4 shadow-sm h-full">
          <h2 className="text-[12px] font-bold text-gray-700 dark:text-gray-300 flex items-center gap-2 mb-4"><TrendingUp className="w-4 h-4 text-yellow-600" />Platform Split</h2>
          <div className="space-y-3">
            {platformCounts.map(([platform, count], i) => {
              const brandColors: Record<string, string> = {
                instagram: "#E4405F",
                facebook: "#1877F2",
                tiktok: "#000000",
                youtube: "#FF0000",
                linkedin: "#0A66C2",
                x: "#000000",
              };
              const brandColor = brandColors[platform] || "#3b82f6";
              return (
              <div key={platform} className="flex items-center gap-3">
                <span style={{ color: brandColor }} className="shrink-0"><PlatformIcon platform={platform as Platform} className="w-4.5 h-4.5" /></span>
                <span className="text-[11px] text-gray-800 dark:text-gray-300 w-16 capitalize font-medium">{platform}</span>
                <div className="flex-1 h-2.5 rounded-full bg-gray-100 dark:bg-white/[0.04] overflow-hidden">
                  {mounted && <AnimatedBar width={(count / totalCards) * 100} color={brandColor} delay={300 + i * 80} duration={2000} />}
                </div>
                <span className="text-[12px] text-gray-800 dark:text-gray-200 tabular-nums w-5 text-right font-bold">
                  {mounted ? <AnimatedCounter value={count} duration={2000} /> : "0"}
                </span>
              </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Row 2: Upcoming + Calendar + Recently Published + Quick Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-2.5 flex-1 min-h-0">
        {/* Upcoming */}
        <div className="lg:col-span-5 bg-white dark:bg-[#151518] rounded-2xl border border-gray-100 dark:border-white/[0.06] p-4 shadow-sm h-full">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[12px] font-bold text-gray-700 dark:text-gray-300 flex items-center gap-2"><Zap className="w-4 h-4 text-orange-500" />Upcoming Posts</h2>
            <button onClick={() => navigate("calendar")} className="text-[10px] text-orange-500 hover:text-orange-600 cursor-pointer font-semibold transition-colors">Calendar →</button>
          </div>
          {upcomingPosts.length > 0 ? (
            <div className="space-y-1">
              {upcomingPosts.map((card) => {
                const col = PIPELINE_COLUMNS.find((c) => c.id === card.stage);
                const daysUntil = card.scheduledDate ? Math.ceil((new Date(card.scheduledDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : null;
                return (
                  <div key={card.id} className="flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-gray-50 dark:hover:bg-white/[0.02] transition-all duration-200 cursor-pointer" onClick={() => navigate("pipeline")}>
                    <img src={card.thumbnailUrl} alt="" className="w-9 h-9 rounded-lg object-cover shrink-0 shadow-sm" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] text-gray-800 dark:text-gray-200 font-medium truncate">{card.title}</p>
                      <div className="flex items-center gap-1 mt-0.5">{card.platforms.slice(0, 3).map((p) => <span key={p} className="text-gray-400"><PlatformIcon platform={p} className="w-2.5 h-2.5" /></span>)}</div>
                    </div>
                    <div className="text-right shrink-0">
                      {daysUntil !== null && daysUntil <= 3 && daysUntil >= 0 ? <span className="text-[10px] text-red-500 font-bold">{daysUntil === 0 ? "TODAY" : `${daysUntil}d`}</span> : <span className="text-[10px] text-gray-400 tabular-nums">{card.scheduledDate?.slice(5)}</span>}
                    </div>
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: col?.color }} />
                  </div>
                );
              })}
            </div>
          ) : <p className="text-[11px] text-gray-400 text-center py-8">No upcoming posts</p>}
        </div>

        {/* Mini Calendar */}
        <MiniCalendar cards={cards} navigate={navigate} />

        {/* Recently Published */}
        <div className="lg:col-span-4 bg-white dark:bg-[#151518] rounded-2xl border border-gray-100 dark:border-white/[0.06] p-4 shadow-sm h-full">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[12px] font-bold text-gray-700 dark:text-gray-300 flex items-center gap-2"><Eye className="w-4 h-4 text-yellow-600" />Recently Published</h2>
            <button onClick={() => { sessionStorage.setItem("t10_open_archive", "true"); navigate("pipeline"); }} className="text-[10px] text-orange-500 hover:text-orange-600 cursor-pointer font-semibold transition-colors">Archive →</button>
          </div>
          <div className="space-y-1">
            {recentPosted.map((card) => (
              <div key={card.id} className="flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-gray-50 dark:hover:bg-white/[0.02] transition-all duration-200">
                <img src={card.thumbnailUrl} alt="" className="w-9 h-9 rounded-lg object-cover shrink-0 shadow-sm" />
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] text-gray-800 dark:text-gray-200 font-medium truncate">{card.title}</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    {card.platforms.slice(0, 3).map((p) => <span key={p} className="text-gray-400"><PlatformIcon platform={p} className="w-2.5 h-2.5" /></span>)}
                    <span className="text-[9px] text-gray-400 ml-1">{card.scheduledDate}</span>
                  </div>
                </div>
                <div className="w-2 h-2 rounded-full bg-sky-500 shrink-0" />
              </div>
            ))}
          </div>
        </div>
      </div>

    </div>
  );
}

// ─── Mini Calendar Component ───

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const stageColors: Record<string, string> = {
  ideas: "#8b5cf6",
  awaiting_approval: "#f59e0b",
  revision_needed: "#ef4444",
  approved_scheduled: "#22c55e",
  posted: "#0ea5e9",
};

function MiniCalendar({ cards, navigate }: { cards: any[]; navigate: (page: any) => void }) {
  const [calDate, setCalDate] = useState(() => new Date());
  const year = calDate.getFullYear();
  const month = calDate.getMonth();

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
    <div onClick={() => navigate("calendar")} className="lg:col-span-3 bg-white dark:bg-[#151518] rounded-2xl border border-gray-100 dark:border-white/[0.06] p-4 shadow-sm h-full cursor-pointer hover:shadow-md hover:border-gray-200 dark:hover:border-white/[0.1] transition-all duration-200 group">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[12px] font-bold text-gray-700 dark:text-gray-300 flex items-center gap-2"><Calendar className="w-4 h-4 text-blue-500" />Calendar</h2>
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <button onClick={(e) => { e.stopPropagation(); setCalDate(new Date(year, month - 1, 1)); }} className="p-0.5 rounded hover:bg-gray-100 dark:hover:bg-white/[0.06] text-gray-400 cursor-pointer"><ChevronLeft className="w-3.5 h-3.5" /></button>
          <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400 w-16 text-center">{calDate.toLocaleDateString("en-US", { month: "short", year: "numeric" })}</span>
          <button onClick={(e) => { e.stopPropagation(); setCalDate(new Date(year, month + 1, 1)); }} className="p-0.5 rounded hover:bg-gray-100 dark:hover:bg-white/[0.06] text-gray-400 cursor-pointer"><ChevronRight className="w-3.5 h-3.5" /></button>
        </div>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 gap-0.5 mb-1">
        {DAYS.map((d) => <div key={d} className="text-center text-[8px] font-bold text-gray-400 dark:text-gray-500 uppercase">{d.slice(0, 1)}</div>)}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7 gap-0.5">
        {calendarDays.map((day, i) => {
          if (!day) return <div key={`e-${i}`} className="aspect-square" />;
          const dayCards = getCardsForDay(day);
          const hasCards = dayCards.length > 0;
          const isTodayDate = isToday(day);

          return (
            <div key={day} className={`aspect-square rounded-md flex flex-col items-center justify-center relative transition-colors ${
              isTodayDate ? "bg-blue-600 text-white" :
              hasCards ? "bg-gray-50 dark:bg-white/[0.03]" : ""
            }`}>
              <span className={`text-[9px] font-medium ${isTodayDate ? "text-white" : hasCards ? "text-gray-800 dark:text-gray-200" : "text-gray-400 dark:text-gray-600"}`}>{day}</span>
              {/* Dots for scheduled posts */}
              {hasCards && !isTodayDate && (
                <div className="flex gap-[2px] mt-[1px]">
                  {dayCards.slice(0, 3).map((c, j) => (
                    <div key={j} className="w-[4px] h-[4px] rounded-full" style={{ backgroundColor: stageColors[c.stage] || "#3b82f6" }} />
                  ))}
                  {dayCards.length > 3 && <div className="w-[4px] h-[4px] rounded-full bg-gray-400" />}
                </div>
              )}
              {hasCards && isTodayDate && (
                <div className="flex gap-[2px] mt-[1px]">
                  {dayCards.slice(0, 3).map((_, j) => (
                    <div key={j} className="w-[4px] h-[4px] rounded-full bg-white/70" />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-3 mt-2 pt-2 border-t border-gray-100 dark:border-white/[0.04]">
        {[
          { label: "Scheduled", color: "#22c55e" },
          { label: "Awaiting", color: "#f59e0b" },
          { label: "Posted", color: "#0ea5e9" },
        ].map((l) => (
          <div key={l.label} className="flex items-center gap-1">
            <div className="w-[6px] h-[6px] rounded-full" style={{ backgroundColor: l.color }} />
            <span className="text-[8px] text-gray-400">{l.label}</span>
          </div>
        ))}
      </div>

      <p className="text-[9px] text-gray-300 dark:text-gray-600 text-center mt-1.5 group-hover:text-blue-400 transition-colors">Click to open full calendar →</p>
    </div>
  );
}
