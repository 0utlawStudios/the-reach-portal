"use client";

import { RawImage } from "@/components/raw-image";
import { useMemo, useState, useEffect, useRef } from "react";
import { usePipeline } from "@/lib/pipeline-context";
import { Page, useNavigation } from "@/lib/navigation-context";
import { ContentCard, PIPELINE_COLUMNS, Platform } from "@/lib/types";
import { PlatformIcon } from "@/components/platform-icons";
import { AnimatedCounter, AnimatedBar } from "@/components/animated";
import { Lightbulb, Clock, RotateCcw, CalendarCheck, Rocket, ArrowRight, Zap, Eye, TrendingUp, BarChart3, Target, AlertCircle, Calendar, CheckCircle, ChevronLeft, ChevronRight } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { formatDate } from "@/lib/utils";

const stageIcons = [Lightbulb, Clock, RotateCcw, CalendarCheck, Rocket];

// Premium dark-mode gradient palette
const darkCardGradients = [
  'linear-gradient(135deg, #131316 0%, #1a1422 100%)',
  'linear-gradient(225deg, #131316 0%, #121924 100%)',
  'linear-gradient(160deg, #131316 0%, #1b1711 100%)',
  'linear-gradient(320deg, #131316 0%, #111c1b 100%)',
  'linear-gradient(200deg, #131316 0%, #1d1317 100%)',
  'linear-gradient(45deg, #131316 0%, #151822 100%)',
  'linear-gradient(280deg, #131316 0%, #191420 100%)',
];

// Luxury card wrapper
const Card = ({ children, className = "", onClick, idx = 0 }: { children: React.ReactNode; className?: string; onClick?: () => void; idx?: number }) => (
  <div onClick={onClick} className={`card-premium bg-white dark:bg-[#131316] rounded-xl sm:rounded-2xl border border-gray-100/80 dark:border-white/[0.06] p-3 sm:p-4 xl:p-5 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_6px_24px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.2),0_6px_24px_rgba(0,0,0,0.15)] transition-all duration-300 ${onClick ? "cursor-pointer hover:shadow-[0_2px_8px_rgba(0,0,0,0.06),0_12px_40px_rgba(0,0,0,0.05)] dark:hover:shadow-[0_2px_8px_rgba(0,0,0,0.3),0_12px_40px_rgba(0,0,0,0.2)] hover:border-gray-200 dark:hover:border-white/[0.1]" : ""} ${className}`} style={{ '--card-gradient': darkCardGradients[idx % darkCardGradients.length] } as React.CSSProperties}>
    {children}
  </div>
);

// Section label
const SectionLabel = ({ icon, children, badge }: { icon: React.ReactNode; children: React.ReactNode; badge?: React.ReactNode }) => (
  <div className="flex items-center justify-between mb-2 sm:mb-3">
    <h2 className="text-[11px] font-bold text-gray-500 dark:text-gray-400 flex items-center gap-2 uppercase tracking-[0.08em]">{icon}{children}</h2>
    {badge}
  </div>
);

export function DashboardPage() {
  const { cards } = usePipeline();
  const { navigate } = useNavigation();
  const { currentUser } = useAuth();
  const [renderTime] = useState(() => Date.now());
  const mounted = true;

  // Auto-fit: scale dashboard to fill viewport without scrolling
  const containerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = containerRef.current;
    const inner = innerRef.current;
    if (!el || !inner) return;
    const fit = () => {
      // Disable auto-scaling on mobile — let users scroll naturally
      if (window.innerWidth < 640) {
        setScale(1);
        return;
      }
      const s = Math.min(el.clientHeight / inner.scrollHeight, 1);
      setScale(prev => Math.abs(prev - s) > 0.003 ? s : prev);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const totalCards = cards.length;
  const pendingApproval = cards.filter((c) => c.stage === "awaiting_approval").length;
  const needsRevision = cards.filter((c) => c.stage === "revision_needed").length;
  const postedCount = cards.filter((c) => c.stage === "posted").length;
  const scheduledCount = cards.filter((c) => c.stage === "approved_scheduled").length;
  const approvedCount = scheduledCount + postedCount;
  const completionPct = totalCards > 0 ? Math.round((approvedCount / totalCards) * 100) : 0;

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
    <div ref={containerRef} className="h-full w-full overflow-y-auto sm:overflow-hidden bg-[#ecedf2] dark:bg-[#09090b]">
      <div ref={innerRef} className="p-2 sm:p-4 lg:p-5 space-y-2 sm:space-y-3" style={scale < 1 ? { transform: `scale(${scale})`, transformOrigin: 'top left', width: `${100 / scale}%` } : undefined}>

      {/* ═══ Welcome Banner ═══ */}
      <div className="card-premium relative bg-white dark:bg-[#131316] rounded-xl sm:rounded-2xl border border-gray-100/80 dark:border-white/[0.06] p-3 sm:p-5 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_6px_24px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.2),0_6px_24px_rgba(0,0,0,0.15)] overflow-hidden" style={{ '--card-gradient': darkCardGradients[6] } as React.CSSProperties}>
        <div className="absolute inset-0 bg-gradient-to-r from-orange-50/80 via-orange-50/20 to-transparent dark:from-orange-500/[0.03] dark:via-transparent pointer-events-none" />
        <div className="relative flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3 sm:gap-4">
            {currentUser.avatar ? (
              <RawImage src={currentUser.avatar} alt={currentUser.name} className="w-9 h-9 sm:w-12 sm:h-12 rounded-lg sm:rounded-xl object-cover shadow-lg ring-2 ring-white dark:ring-white/10" />
            ) : (
              <div className="w-9 h-9 sm:w-12 sm:h-12 rounded-lg sm:rounded-xl bg-gradient-to-br from-orange-500 to-amber-600 flex items-center justify-center text-white text-[13px] sm:text-[15px] font-bold shadow-lg shadow-orange-500/25">{currentUser.initials}</div>
            )}
            <div>
              <h1 className="text-[17px] sm:text-[22px] font-extrabold tracking-[-0.03em] bg-gradient-to-r from-gray-900 via-gray-800 to-gray-600 dark:from-white dark:via-gray-200 dark:to-gray-400 bg-clip-text text-transparent">
                Welcome back, {currentUser.name.split(" ")[0]}
              </h1>
              {pendingApproval > 0 ? (
                <p className="text-[13px] text-gray-500 dark:text-gray-400 mt-1 flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 text-orange-500" />
                  You have <span className="font-semibold text-orange-600 dark:text-orange-400">{pendingApproval} post{pendingApproval !== 1 ? "s" : ""} awaiting approval.</span>
                </p>
              ) : (
                <p className="text-[13px] text-gray-400 mt-1 flex items-center gap-1.5"><CheckCircle className="w-3.5 h-3.5 text-emerald-500" />All caught up — no posts pending.</p>
              )}
            </div>
          </div>
          {pendingApproval > 0 && (
            <button onClick={() => navigate("pipeline")} className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white text-[12px] font-semibold shadow-lg shadow-orange-500/20 cursor-pointer transition-all duration-300 shrink-0 hover:shadow-orange-500/30">
              Review Posts <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* ═══ Row 1: Funnel + Scorecard + Platforms ═══ */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-2 sm:gap-3">

        {/* Pipeline Funnel */}
        <Card idx={0} className="md:col-span-1 lg:col-span-5 flex flex-col">
          <SectionLabel icon={<BarChart3 className="w-4 h-4 text-orange-500" />} badge={<span className="text-[8px] text-gray-400 bg-gray-50 dark:bg-white/[0.04] px-2.5 py-1 rounded-full font-semibold uppercase tracking-[0.1em]">This week</span>}>Pipeline Funnel</SectionLabel>
          <div className="space-y-2 sm:space-y-3.5 flex-1">
            {stageCounts.map((col, i) => {
              const Icon = stageIcons[i];
              return (
                <button key={col.id} onClick={() => navigate("pipeline")} className="w-full flex items-center gap-3 hover:bg-gray-50/80 dark:hover:bg-white/[0.02] -mx-2 px-2 py-1 rounded-xl transition-all duration-300 cursor-pointer group">
                  <span style={{ color: col.color }} className="shrink-0 group-hover:scale-110 transition-transform duration-300"><Icon className="w-4 h-4" /></span>
                  <span className="text-[11px] text-gray-600 dark:text-gray-400 w-24 shrink-0 font-medium text-left">{col.title.split("/")[0].trim()}</span>
                  <div className="flex-1 h-2 rounded-full bg-gray-100 dark:bg-white/[0.04] overflow-hidden">
                    {mounted && <AnimatedBar width={Math.max(col.pct, 3)} color={`linear-gradient(90deg, ${col.color}, ${col.color}88)`} delay={i * 120} duration={2000} />}
                  </div>
                  <span className="text-[14px] text-gray-800 dark:text-gray-200 tabular-nums w-6 text-right font-bold font-mono tracking-tight">
                    {mounted ? <AnimatedCounter value={col.count} duration={2000} /> : "0"}
                  </span>
                </button>
              );
            })}
          </div>
        </Card>

        {/* Weekly Scorecard */}
        <Card idx={1} className="lg:col-span-3 flex flex-col">
          <SectionLabel icon={<Target className="w-4 h-4 text-orange-500" />}>Scorecard</SectionLabel>
          <div className="space-y-3 sm:space-y-4 flex-1 flex flex-col justify-center">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] text-gray-500 dark:text-gray-400 font-medium uppercase tracking-wider">Approval Rate</span>
                <span className="text-[20px] sm:text-[24px] font-black text-gray-900 dark:text-white tabular-nums font-mono tracking-tighter">
                  {mounted ? <AnimatedCounter value={completionPct} duration={2000} suffix="%" /> : "0%"}
                </span>
              </div>
              <div className="w-full h-2 rounded-full bg-gray-100 dark:bg-white/[0.04] overflow-hidden">
                {mounted && <AnimatedBar width={completionPct} color="linear-gradient(90deg, #ea580c, #d97706)" delay={200} duration={2000} />}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:gap-3 pt-1">
              {[
                { label: "Published", value: postedCount, color: "text-gray-900 dark:text-white", action: () => { sessionStorage.setItem("t10_open_archive", "true"); navigate("pipeline"); } },
                { label: "In Review", value: pendingApproval + needsRevision, color: "text-orange-600 dark:text-orange-400", action: () => navigate("pipeline") },
                { label: "Scheduled", value: scheduledCount, color: "text-amber-600 dark:text-amber-400", action: () => navigate("pipeline") },
                { label: "Platforms", value: platformCounts.length, color: "text-gray-600 dark:text-gray-300", action: undefined as (() => void) | undefined },
              ].map((s) => (
                <div key={s.label} onClick={s.action} className={`bg-gray-50/80 dark:bg-white/[0.02] rounded-lg sm:rounded-xl p-2 sm:p-3 text-center border border-gray-100/60 dark:border-white/[0.04] ${s.action ? "cursor-pointer hover:bg-gray-100/80 dark:hover:bg-white/[0.05] hover:border-gray-200 dark:hover:border-white/[0.08] transition-all duration-200 active:scale-[0.97]" : ""}`}>
                  <p className={`text-[20px] sm:text-[26px] font-black tabular-nums font-mono tracking-tighter ${s.color}`}>
                    {mounted ? <AnimatedCounter value={s.value} duration={2000} /> : "0"}
                  </p>
                  <p className="text-[8px] text-gray-400 font-bold uppercase tracking-[0.12em] mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>
          </div>
        </Card>

        {/* Platform Split */}
        <Card idx={2} className="lg:col-span-4 flex flex-col">
          <SectionLabel icon={<TrendingUp className="w-4 h-4 text-amber-500" />}>Platform Split</SectionLabel>
          <div className="space-y-2.5 sm:space-y-4 flex-1 flex flex-col justify-center">
            {platformCounts.map(([platform, count], i) => {
              const brandColors: Record<string, string> = { instagram: "#E4405F", facebook: "#1877F2", tiktok: "#000000", youtube: "#FF0000", linkedin: "#0A66C2" };
              const brandColor = brandColors[platform] || "#3b82f6";
              return (
                <div key={platform} className="flex items-center gap-3">
                  <span style={{ color: brandColor }} className="shrink-0"><PlatformIcon platform={platform as Platform} className="w-5 h-5" /></span>
                  <span className="text-[11px] text-gray-700 dark:text-gray-300 w-16 capitalize font-semibold">{platform}</span>
                  <div className="flex-1 h-2 rounded-full bg-gray-100 dark:bg-white/[0.04] overflow-hidden">
                    {mounted && <AnimatedBar width={(count / totalCards) * 100} color={brandColor} delay={300 + i * 100} duration={2000} />}
                  </div>
                  <span className="text-[13px] text-gray-800 dark:text-gray-200 tabular-nums w-6 text-right font-bold font-mono tracking-tight">
                    {mounted ? <AnimatedCounter value={count} duration={2000} /> : "0"}
                  </span>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {/* ═══ Row 2: Upcoming + Calendar + Published ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-2 sm:gap-3">

        {/* Upcoming */}
        <Card idx={3} className="lg:col-span-5 flex flex-col">
          <SectionLabel icon={<Zap className="w-4 h-4 text-orange-500" />}>Upcoming Posts</SectionLabel>
          {upcomingPosts.length > 0 ? (
            <div className="space-y-1">
              {upcomingPosts.map((card) => {
                const col = PIPELINE_COLUMNS.find((c) => c.id === card.stage);
                const daysUntil = card.scheduledDate ? Math.ceil((new Date(card.scheduledDate).getTime() - renderTime) / (1000 * 60 * 60 * 24)) : null;
                return (
                  <button key={card.id} onClick={() => navigate("pipeline")} className="w-full flex items-center gap-3 px-2 py-1.5 sm:py-2.5 rounded-xl hover:bg-gray-50/80 dark:hover:bg-white/[0.02] transition-all duration-300 cursor-pointer text-left group">
                    <RawImage src={card.thumbnailUrl} alt="" className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg object-cover shrink-0 shadow-sm group-hover:shadow-md transition-shadow duration-300" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] text-gray-800 dark:text-gray-200 font-medium truncate">{card.title}</p>
                      <div className="flex items-center gap-1 mt-0.5">{card.platforms.slice(0, 3).map((p) => <span key={p} className="text-gray-400"><PlatformIcon platform={p} className="w-2.5 h-2.5" /></span>)}</div>
                    </div>
                    <div className="text-right shrink-0">
                      {daysUntil !== null && daysUntil <= 3 && daysUntil >= 0 ? <span className="text-[10px] text-red-500 font-bold font-mono">{daysUntil === 0 ? "TODAY" : `${daysUntil}d`}</span> : <span className="text-[10px] text-gray-400 tabular-nums font-mono">{card.scheduledDate?.slice(5)}</span>}
                    </div>
                    <div className="w-2 h-2 rounded-full shrink-0 shadow-sm" style={{ backgroundColor: col?.color, boxShadow: `0 0 4px ${col?.color}40` }} />
                  </button>
                );
              })}
            </div>
          ) : <p className="text-[12px] text-gray-400 text-center py-10">No upcoming posts</p>}
          <div className="mt-auto pt-2 sm:pt-4 border-t border-gray-100/60 dark:border-white/[0.04] text-right">
            <button onClick={() => navigate("pipeline")} className="text-[10px] text-orange-500 hover:text-orange-600 cursor-pointer font-semibold transition-colors duration-300">View full pipeline →</button>
          </div>
        </Card>

        {/* Calendar */}
        <MiniCalendar cards={cards} navigate={navigate} />

        {/* Recently Published - hidden on mobile to reduce scroll length */}
        <Card idx={5} className="hidden sm:flex lg:col-span-4 flex-col">
          <SectionLabel icon={<Eye className="w-4 h-4 text-sky-500" />}>Recently Published</SectionLabel>
          <div className="space-y-1">
            {recentPosted.map((card) => (
              <div key={card.id} className="flex items-center gap-3 px-2 py-2.5 rounded-xl hover:bg-gray-50/80 dark:hover:bg-white/[0.02] transition-all duration-300">
                <RawImage src={card.thumbnailUrl} alt="" className="w-10 h-10 rounded-lg object-cover shrink-0 shadow-sm" />
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] text-gray-800 dark:text-gray-200 font-medium truncate">{card.title}</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    {card.platforms.slice(0, 3).map((p) => <span key={p} className="text-gray-400"><PlatformIcon platform={p} className="w-2.5 h-2.5" /></span>)}
                    <span className="text-[9px] text-gray-400 font-mono ml-1">{card.scheduledDate}</span>
                  </div>
                </div>
                <div className="w-2 h-2 rounded-full bg-sky-500 shrink-0 shadow-sm" style={{ boxShadow: "0 0 4px rgba(14,165,233,0.4)" }} />
              </div>
            ))}
          </div>
          <div className="mt-auto pt-4 border-t border-gray-100/60 dark:border-white/[0.04] text-right">
            <button onClick={() => { sessionStorage.setItem("t10_open_archive", "true"); navigate("pipeline"); }} className="text-[10px] text-orange-500 hover:text-orange-600 cursor-pointer font-semibold transition-colors duration-300">Go to archive →</button>
          </div>
        </Card>
      </div>
      </div>
    </div>
  );
}

// ─── Mini Calendar ───

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const stageColors: Record<string, string> = { ideas: "#8b5cf6", awaiting_approval: "#f59e0b", revision_needed: "#ef4444", approved_scheduled: "#22c55e", posted: "#0ea5e9" };

function MiniCalendar({ cards, navigate }: { cards: ContentCard[]; navigate: (page: Page) => void }) {
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
    <Card idx={4} onClick={() => navigate("calendar")} className="lg:col-span-3 flex flex-col group">
      <div className="flex items-center justify-between mb-2 sm:mb-4">
        <h2 className="text-[11px] font-bold text-gray-500 dark:text-gray-400 flex items-center gap-2 uppercase tracking-[0.08em]"><Calendar className="w-4 h-4 text-blue-500" />Calendar</h2>
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <button onClick={(e) => { e.stopPropagation(); setCalDate(new Date(year, month - 1, 1)); }} className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-white/[0.06] text-gray-400 cursor-pointer transition-colors"><ChevronLeft className="w-3.5 h-3.5" /></button>
          <span className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 w-16 text-center font-mono">{formatDate(calDate, { month: "short", year: "numeric" })}</span>
          <button onClick={(e) => { e.stopPropagation(); setCalDate(new Date(year, month + 1, 1)); }} className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-white/[0.06] text-gray-400 cursor-pointer transition-colors"><ChevronRight className="w-3.5 h-3.5" /></button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-0.5 mb-1">
        {DAYS.map((d) => <div key={d} className="text-center text-[8px] font-bold text-gray-400 dark:text-gray-500 uppercase">{d.slice(0, 1)}</div>)}
      </div>

      <div className="grid grid-cols-7 gap-0.5">
        {calendarDays.map((day, i) => {
          if (!day) return <div key={`e-${i}`} className="h-8 sm:aspect-square" />;
          const dayCards = getCardsForDay(day);
          const hasCards = dayCards.length > 0;
          const isTodayDate = isToday(day);
          return (
            <div key={day} className={`h-8 sm:aspect-square rounded-md sm:rounded-lg flex flex-col items-center justify-center relative transition-all duration-200 ${
              isTodayDate ? "bg-blue-600 text-white shadow-sm shadow-blue-500/30" :
              hasCards ? "bg-gray-50 dark:bg-white/[0.03]" : "hover:bg-gray-50/50 dark:hover:bg-white/[0.02]"
            }`}>
              <span className={`text-[9px] font-medium ${isTodayDate ? "text-white font-bold" : hasCards ? "text-gray-800 dark:text-gray-200" : "text-gray-400 dark:text-gray-600"}`}>{day}</span>
              {hasCards && !isTodayDate && (
                <div className="flex gap-[2px] mt-[1px]">
                  {dayCards.slice(0, 3).map((c, j) => (
                    <div key={j} className="w-[4px] h-[4px] rounded-full" style={{ backgroundColor: stageColors[c.stage] || "#3b82f6" }} />
                  ))}
                </div>
              )}
              {hasCards && isTodayDate && (
                <div className="flex gap-[2px] mt-[1px]">
                  {dayCards.slice(0, 3).map((_, j) => <div key={j} className="w-[4px] h-[4px] rounded-full bg-white/70" />)}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-center gap-3 mt-2 sm:mt-3 pt-2 sm:pt-3 border-t border-gray-100/60 dark:border-white/[0.04]">
        {[{ label: "Scheduled", color: "#22c55e" }, { label: "Awaiting", color: "#f59e0b" }, { label: "Posted", color: "#0ea5e9" }].map((l) => (
          <div key={l.label} className="flex items-center gap-1">
            <div className="w-[5px] h-[5px] rounded-full" style={{ backgroundColor: l.color }} />
            <span className="text-[8px] text-gray-400 font-medium">{l.label}</span>
          </div>
        ))}
      </div>

      <p className="text-[9px] text-gray-300 dark:text-gray-600 text-center mt-auto pt-1 sm:pt-2 group-hover:text-blue-400 transition-colors duration-300">Click to open full calendar →</p>
    </Card>
  );
}
