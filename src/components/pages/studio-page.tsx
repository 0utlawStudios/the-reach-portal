"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Sparkles, Plus, Loader2, X, ExternalLink, ChevronDown, Check } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/lib/toast-context";
import { usePipeline } from "@/lib/pipeline-context";
import { useNavigation } from "@/lib/navigation-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  resolveAspect,
  formatAspectChip,
  imageCountForPlan,
} from "@/lib/ai/aspect-resolver";
import type {
  PlanRow,
  PlanRowStatus,
  StudioFormat,
  StudioFeel,
  StudioVisualStyle,
  MediaType,
} from "@/lib/ai/types";
import { supabase } from "@/lib/supabaseClient";

const FEEL_OPTIONS: StudioFeel[] = [
  "Educational", "Story", "Founder POV", "Before/After", "Contrarian",
  "Hype", "Behind-the-Scenes", "Testimonial-Style", "Announcement", "How-To",
];

const VISUAL_STYLE_OPTIONS: StudioVisualStyle[] = [
  "Photography (Realistic)", "Illustration (Flat)", "Infographic",
  "Screenshot Mockup", "3D Render", "Mixed Media",
  "Editorial Photo", "Studio Photo",
];

const PLATFORM_OPTIONS = [
  { id: "instagram", label: "Instagram" },
  { id: "linkedin", label: "LinkedIn" },
  { id: "facebook", label: "Facebook" },
  { id: "tiktok", label: "TikTok" },
  { id: "youtube", label: "YouTube Shorts" },
  { id: "multi-platform", label: "Multi-platform" },
];

const FORMATS_FOR_IMAGE: { id: StudioFormat; label: string }[] = [
  { id: "single", label: "Single" },
  { id: "carousel", label: "Carousel" },
  { id: "story", label: "Story" },
];
const FORMATS_FOR_VIDEO: { id: StudioFormat; label: string }[] = [
  { id: "reel", label: "Reel" },
  { id: "storyboard", label: "Storyboard" },
];

const STATUS_LABEL: Record<PlanRowStatus, string> = {
  empty: "Empty", ready: "Ready", generating: "Generating", generated: "Generated", failed: "Failed", revising: "Revising",
};
const STATUS_COLOR: Record<PlanRowStatus, string> = {
  empty: "bg-gray-100 text-gray-500 dark:bg-white/[0.06] dark:text-gray-400",
  ready: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  generating: "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300",
  generated: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  failed: "bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300",
  revising: "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300",
};

const DAILY_CAP_DEFAULT = 10;

function todayIso(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const headers = new Headers(init?.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return fetch(path, { ...init, headers });
}

export function StudioPage() {
  const { currentUser } = useAuth();
  const { addToast } = useToast();
  const { cards } = usePipeline();
  const { navigateToPost } = useNavigation();
  const [rows, setRows] = useState<PlanRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyRowId, setBusyRowId] = useState<string | null>(null);
  const [jobIdByRow, setJobIdByRow] = useState<Record<string, string>>({});
  const [spendUsd, setSpendUsd] = useState<number>(0);
  const [dailyCap, setDailyCap] = useState<number>(DAILY_CAP_DEFAULT);
  const debounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const isAllowedRole = useMemo(() => {
    const role = (currentUser.role || "").toLowerCase();
    return ["superadmin", "admin", "owner", "creative_director", "social_media_specialist"].includes(role);
  }, [currentUser.role]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await authedFetch(`/api/ai/studio/rows?from=${todayIso(-3)}&to=${todayIso(28)}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
        if (cancelled) return;
        const fetched = (json.data?.rows || []) as PlanRow[];
        const have = fetched.length;
        const placeholders: PlanRow[] = [];
        for (let i = 0; i < Math.max(0, 14 - have); i++) {
          placeholders.push(makeBlankRow(have + i));
        }
        setRows([...fetched, ...placeholders]);
      } catch (err) {
        if (!cancelled) addToast(`Failed to load Studio rows: ${err instanceof Error ? err.message : String(err)}`, "error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    if (isAllowedRole) load();
    else setLoading(false);
    return () => { cancelled = true; };
  }, [addToast, isAllowedRole]);

  useEffect(() => {
    if (!isAllowedRole) return;
    const ch = supabase
      .channel("studio-plan-rows")
      .on("postgres_changes", { event: "*", schema: "public", table: "content_plan_rows" }, (payload) => {
        if (payload.eventType === "INSERT" || payload.eventType === "UPDATE") {
          const next = payload.new as PlanRow;
          setRows((prev) => {
            const idx = prev.findIndex((r) => r.id === next.id);
            if (idx >= 0) {
              const out = [...prev];
              out[idx] = { ...prev[idx], ...next };
              return out;
            }
            return [...prev, next];
          });
        } else if (payload.eventType === "DELETE") {
          const oldId = (payload.old as { id?: string }).id;
          if (oldId) setRows((prev) => prev.filter((r) => r.id !== oldId));
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [isAllowedRole]);

  useEffect(() => {
    const generating = rows.filter((r) => r.status === "generating" || r.status === "revising");
    if (generating.length === 0) return;
    const interval = setInterval(async () => {
      for (const row of generating) {
        const jobId = jobIdByRow[row.id];
        if (!jobId) continue;
        try {
          const res = await authedFetch(`/api/ai/jobs/${jobId}`);
          const json = await res.json();
          if (res.ok && json.data?.job) {
            const j = json.data.job;
            if (j.status === "completed" || j.status === "failed" || j.status === "cancelled") {
              setJobIdByRow((m) => { const out = { ...m }; delete out[row.id]; return out; });
              if (j.status === "completed") addToast("AI draft ready — check Awaiting Approval.", "success");
              else if (j.status === "failed") addToast(`AI generation failed: ${j.error || "unknown error"}`, "error");
            }
          }
        } catch { /* keep polling */ }
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [rows, jobIdByRow, addToast]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const cap = Number(process.env.NEXT_PUBLIC_OPENAI_DAILY_CAP_USD);
        if (Number.isFinite(cap) && cap > 0) setDailyCap(cap);
      } catch { /* ignore */ }
      try {
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { data, error } = await supabase
          .from("ai_generation_jobs")
          .select("cost_usd")
          .gte("created_at", since);
        if (!cancelled && !error && data) {
          const sum = data.reduce((acc, row) => acc + Number(row.cost_usd || 0), 0);
          setSpendUsd(Math.round(sum * 100) / 100);
        }
      } catch { /* fall through */ }
    }
    load();
    return () => { cancelled = true; };
  }, [rows]);

  function makeBlankRow(rowIndex: number): PlanRow {
    return {
      id: `tmp-${rowIndex}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      workspace_id: "",
      created_by: currentUser.email || "",
      row_index: rowIndex,
      scheduled_date: todayIso(rowIndex - 3 < 0 ? 0 : rowIndex - 3),
      scheduled_time: null, platforms: [], media_type: null, format: null, slides_count: null, resolved_aspect: null,
      feel: null, visual_style: null, style_prompt: null, topic: null, notes: null, status: "empty",
      generated_post_id: null, last_error: null, cost_usd: null,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    };
  }

  const persistRowChange = useCallback(async (row: PlanRow, patch: Partial<PlanRow>) => {
    const isTmp = row.id.startsWith("tmp-");
    if (isTmp) {
      try {
        const res = await authedFetch(`/api/ai/studio/rows`, {
          method: "POST",
          body: JSON.stringify({ row_index: row.row_index, ...stripUuidFields({ ...row, ...patch }) }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
        const saved = json.data?.row as PlanRow;
        setRows((prev) => prev.map((r) => (r.id === row.id ? saved : r)));
      } catch (err) {
        addToast(`Failed to save row: ${err instanceof Error ? err.message : String(err)}`, "error");
      }
      return;
    }
    try {
      const res = await authedFetch(`/api/ai/studio/rows/${row.id}`, { method: "PATCH", body: JSON.stringify(patch) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      const saved = json.data?.row as PlanRow;
      setRows((prev) => prev.map((r) => (r.id === row.id ? saved : r)));
    } catch (err) {
      addToast(`Save failed: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  }, [addToast]);

  function stripUuidFields<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (["id", "workspace_id", "created_by", "status", "generated_post_id", "cost_usd", "last_error", "resolved_aspect", "created_at", "updated_at"].includes(k)) continue;
      out[k] = v;
    }
    return out;
  }

  const onFieldChange = useCallback((row: PlanRow, patch: Partial<PlanRow>) => {
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, ...patch } : r)));
    if (debounceTimers.current[row.id]) clearTimeout(debounceTimers.current[row.id]);
    debounceTimers.current[row.id] = setTimeout(() => {
      const current = rowsRef.current.find((r) => r.id === row.id);
      if (current) void persistRowChange(current, patch);
    }, 600);
  }, [persistRowChange]);

  const rowsRef = useRef<PlanRow[]>(rows);
  useEffect(() => { rowsRef.current = rows; }, [rows]);

  const generateRow = useCallback(async (row: PlanRow) => {
    if (row.id.startsWith("tmp-")) {
      addToast("Save the row first by filling fields, then generate.", "info");
      return;
    }
    setBusyRowId(row.id);
    try {
      const res = await authedFetch(`/api/ai/studio/generate-row/${row.id}`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      const jobId = json.data?.job?.id;
      if (jobId) setJobIdByRow((m) => ({ ...m, [row.id]: jobId }));
      addToast("AI generation started — back in about 20 seconds.", "info");
    } catch (err) {
      addToast(`Generation failed: ${err instanceof Error ? err.message : String(err)}`, "error");
    } finally {
      setBusyRowId(null);
    }
  }, [addToast]);

  const cancelRow = useCallback(async (row: PlanRow) => {
    const jobId = jobIdByRow[row.id];
    if (!jobId) return;
    try {
      const res = await authedFetch(`/api/ai/studio/cancel-job/${jobId}`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setJobIdByRow((m) => { const o = { ...m }; delete o[row.id]; return o; });
      addToast("Job cancelled.", "info");
    } catch (err) {
      addToast(`Cancel failed: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  }, [jobIdByRow, addToast]);

  const generateBatch = useCallback(async () => {
    const ready = rows.filter((r) => r.status === "ready" && !r.id.startsWith("tmp-")).map((r) => r.id);
    if (ready.length === 0) {
      addToast("No rows are marked Ready.", "info");
      return;
    }
    try {
      const res = await authedFetch(`/api/ai/studio/generate-batch`, { method: "POST", body: JSON.stringify({ row_ids: ready }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      addToast(`Generating ${json.data?.total || 0} rows…`, "info");
    } catch (err) {
      addToast(`Batch failed: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  }, [rows, addToast]);

  const addRow = useCallback(() => {
    setRows((prev) => [...prev, makeBlankRow(prev.length)]);
  }, []);

  const openGeneratedPost = useCallback((row: PlanRow) => {
    if (!row.generated_post_id) return;
    navigateToPost(row.generated_post_id);
  }, [navigateToPost]);

  if (!isAllowedRole) {
    return (
      <div className="p-6 sm:p-8 max-w-2xl mx-auto">
        <h1 className="text-base font-semibold mb-2">Studio is restricted</h1>
        <p className="text-[12px] text-gray-500">Your role doesn&apos;t have access to AI generation. Ask an admin if you need it.</p>
      </div>
    );
  }

  return (
    <div className="px-3 sm:px-5 lg:px-6 py-4 sm:py-5 max-w-[1400px] mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2 sm:gap-3 mb-4">
        <div>
          <h1 className="text-[15px] sm:text-base font-semibold flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-violet-500" />Creator Studio
          </h1>
          <p className="text-[11px] text-gray-500 mt-0.5 max-w-xl">Plan a row, click Generate. Drafts land in Awaiting Approval — AI never auto-approves or publishes.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <SpendChip spent={spendUsd} cap={dailyCap} />
          <Button variant="outline" size="sm" onClick={addRow} className="h-7 text-[11px] px-2"><Plus className="w-3 h-3 mr-1" />Add Row</Button>
          <Button size="sm" onClick={generateBatch} disabled={rows.every((r) => r.status !== "ready")} className="h-7 text-[11px] px-2">Bulk Generate</Button>
        </div>
      </div>

      {loading ? (
        <div className="py-12 text-center text-gray-400 text-[12px] flex items-center justify-center gap-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading rows…
        </div>
      ) : (
        <>
          {/* Desktop / tablet table — md and above */}
          <div className="hidden md:block rounded-lg ring-1 ring-gray-100 dark:ring-white/[0.05] bg-white dark:bg-[#0f1015] overflow-hidden">
            <table className="w-full text-[11px]">
              <thead className="bg-gray-50/70 dark:bg-white/[0.02] text-[9px] uppercase tracking-wider text-gray-400">
                <tr className="text-left">
                  <Th className="w-7">#</Th>
                  <Th className="w-[112px]">Date</Th>
                  <Th className="w-[80px]">Time</Th>
                  <Th className="w-[120px]">Platforms</Th>
                  <Th className="w-[80px]">Media</Th>
                  <Th className="w-[90px]">Format</Th>
                  <Th className="w-12">Slides</Th>
                  <Th className="w-[88px]">Aspect</Th>
                  <Th className="w-[112px]">Feel</Th>
                  <Th className="w-[124px]">Visual</Th>
                  <Th>Style</Th>
                  <Th>Topic</Th>
                  <Th>Notes</Th>
                  <Th className="w-[78px]">Status</Th>
                  <Th className="w-[44px]">Card</Th>
                  <Th className="w-[88px]">Action</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-white/[0.04]">
                {rows.map((row, idx) => (
                  <StudioRow
                    key={row.id}
                    row={row}
                    index={idx + 1}
                    busy={busyRowId === row.id}
                    onChange={(patch) => onFieldChange(row, patch)}
                    onGenerate={() => generateRow(row)}
                    onCancel={() => cancelRow(row)}
                    onOpenCard={() => openGeneratedPost(row)}
                    hasCard={Boolean(row.generated_post_id && cards.some((c) => c.id === row.generated_post_id))}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards — below md */}
          <div className="md:hidden space-y-2.5">
            {rows.map((row, idx) => (
              <StudioRowMobile
                key={row.id}
                row={row}
                index={idx + 1}
                busy={busyRowId === row.id}
                onChange={(patch) => onFieldChange(row, patch)}
                onGenerate={() => generateRow(row)}
                onCancel={() => cancelRow(row)}
                onOpenCard={() => openGeneratedPost(row)}
                hasCard={Boolean(row.generated_post_id && cards.some((c) => c.id === row.generated_post_id))}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Helpers / shared cells ───

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-2 py-1.5 font-semibold whitespace-nowrap ${className}`}>{children}</th>;
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-2 py-1.5 align-top ${className}`}>{children}</td>;
}

function SpendChip({ spent, cap }: { spent: number; cap: number }) {
  const pct = Math.min(100, Math.round((spent / cap) * 100));
  const tone = pct >= 90 ? "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"
    : pct >= 60 ? "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
    : "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300";
  return (
    <div className={`text-[10px] px-2 py-0.5 rounded-full font-medium tabular-nums ${tone}`}>
      ${spent.toFixed(2)} / ${cap.toFixed(2)} today
    </div>
  );
}

function StatusChip({ status, compact = false }: { status: PlanRowStatus; compact?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 ${compact ? "px-1.5 py-[1px] text-[9.5px]" : "px-1.5 py-0.5 text-[9.5px]"} rounded-full font-semibold ${STATUS_COLOR[status]}`}>
      {(status === "generating" || status === "revising") && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
      {STATUS_LABEL[status]}
    </span>
  );
}

// Reusable native-select that styles tightly.
function CompactSelect({ value, onChange, options, disabled, placeholder }: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <div className="relative inline-block w-full">
      <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}
        className="appearance-none h-6 w-full pl-1.5 pr-5 text-[10.5px] rounded-md border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-transparent text-gray-700 dark:text-gray-200 disabled:opacity-50">
        {placeholder ? <option value="">{placeholder}</option> : null}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <ChevronDown className="absolute right-1 top-1/2 -translate-y-1/2 w-2.5 h-2.5 text-gray-400 pointer-events-none" />
    </div>
  );
}

// Multi-select dropdown for platforms. Renders as a single chip showing
// "N selected" with the count, opens a popover with checkboxes.
function PlatformDropdown({ value, onChange, disabled }: {
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const toggle = (id: string) => {
    if (disabled) return;
    if (value.includes(id)) onChange(value.filter((v) => v !== id));
    else onChange([...value, id]);
  };

  const summary = value.length === 0 ? "Select…" : value.length === 1 ? labelFor(value[0]) : `${value.length} platforms`;

  return (
    <div ref={wrapperRef} className="relative inline-block w-full">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((p) => !p)}
        className={`h-6 w-full px-1.5 pr-5 text-[10.5px] rounded-md border ${value.length > 0 ? "border-violet-300 bg-violet-50/40 dark:border-violet-500/40 dark:bg-violet-500/[0.06]" : "border-gray-200 dark:border-white/[0.08] bg-white dark:bg-transparent"} text-gray-700 dark:text-gray-200 disabled:opacity-50 text-left flex items-center`}
      >
        <span className="truncate">{summary}</span>
        <ChevronDown className="absolute right-1 top-1/2 -translate-y-1/2 w-2.5 h-2.5 text-gray-400 pointer-events-none" />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 left-0 min-w-[140px] bg-white dark:bg-[#1a1b21] border border-gray-200 dark:border-white/[0.08] rounded-md shadow-lg overflow-hidden">
          {PLATFORM_OPTIONS.map((p) => {
            const on = value.includes(p.id);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => toggle(p.id)}
                className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-[10.5px] hover:bg-gray-50 dark:hover:bg-white/[0.04] text-left ${on ? "text-violet-700 dark:text-violet-300 font-medium" : "text-gray-700 dark:text-gray-300"}`}
              >
                <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${on ? "bg-violet-600 border-violet-600 text-white" : "border-gray-300 dark:border-white/[0.15]"}`}>
                  {on && <Check className="w-2.5 h-2.5" />}
                </span>
                {p.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function labelFor(id: string): string {
  return PLATFORM_OPTIONS.find((p) => p.id === id)?.label || id;
}

// ─── Desktop row ───

interface RowProps {
  row: PlanRow;
  index: number;
  busy: boolean;
  onChange: (patch: Partial<PlanRow>) => void;
  onGenerate: () => void;
  onCancel: () => void;
  onOpenCard: () => void;
  hasCard: boolean;
}

function useRowDerived(row: PlanRow) {
  const platforms = row.platforms || [];
  const mediaType: MediaType = (row.media_type as MediaType) || "image";
  const format = (row.format as StudioFormat) || (mediaType === "video" ? "reel" : "single");
  const slides = row.slides_count ?? (format === "carousel" ? 5 : null);
  const resolved = useMemo(() => {
    if (!row.media_type || !row.format || platforms.length === 0) return null;
    return resolveAspect({ mediaType: row.media_type as MediaType, format: row.format as StudioFormat, platforms });
  }, [row.media_type, row.format, platforms]);
  const formatOptions = mediaType === "video" ? FORMATS_FOR_VIDEO : FORMATS_FOR_IMAGE;
  const isLocked = row.status === "generating" || row.status === "revising" || row.status === "generated";
  const canGenerate = !isLocked && Boolean(row.scheduled_date) && platforms.length > 0 && Boolean(row.media_type) && Boolean(row.format) && Boolean(row.feel) && Boolean(row.visual_style);
  const expectedImageCount = imageCountForPlan(format, mediaType, slides);
  return { platforms, mediaType, format, slides, resolved, formatOptions, isLocked, canGenerate, expectedImageCount };
}

function StudioRow(props: RowProps) {
  const { row, index, busy, onChange, onGenerate, onCancel, onOpenCard, hasCard } = props;
  const { platforms, mediaType, format, slides, resolved, formatOptions, isLocked, canGenerate, expectedImageCount } = useRowDerived(row);

  return (
    <tr className="hover:bg-gray-50/60 dark:hover:bg-white/[0.02] transition-colors align-top">
      <Td className="text-gray-400 text-[10px]">{index}</Td>
      <Td>
        <Input type="date" value={row.scheduled_date || ""} onChange={(e) => onChange({ scheduled_date: e.target.value || null })} disabled={isLocked} className="h-6 text-[10.5px] px-1.5 py-0 w-full" />
      </Td>
      <Td>
        <Input type="time" value={(row.scheduled_time || "").slice(0, 5)} onChange={(e) => onChange({ scheduled_time: e.target.value || null })} disabled={isLocked} className="h-6 text-[10.5px] px-1.5 py-0 w-full" />
      </Td>
      <Td>
        <PlatformDropdown value={platforms} onChange={(next) => onChange({ platforms: next })} disabled={isLocked} />
      </Td>
      <Td>
        <CompactSelect value={mediaType} disabled={isLocked}
          onChange={(v) => onChange({ media_type: v as MediaType, format: v === "video" ? "reel" : "single" })}
          options={[{ value: "image", label: "Image" }, { value: "video", label: "Video" }]} />
      </Td>
      <Td>
        <CompactSelect value={format} disabled={isLocked}
          onChange={(v) => onChange({ format: v as StudioFormat })}
          options={formatOptions.map((f) => ({ value: f.id, label: f.label }))} />
      </Td>
      <Td>
        {format === "carousel" ? (
          <Input type="number" min={2} max={10} value={slides ?? 5} onChange={(e) => onChange({ slides_count: Number(e.target.value) || 5 })} disabled={isLocked} className="h-6 text-[10.5px] px-1.5 py-0 w-full" />
        ) : (
          <span className="text-gray-400 text-[10.5px]">{expectedImageCount}</span>
        )}
      </Td>
      <Td>
        {resolved ? (
          <span className="px-1.5 py-0.5 bg-gray-100 dark:bg-white/[0.04] rounded text-[9.5px] font-mono text-gray-600 dark:text-gray-300">{formatAspectChip(resolved)}</span>
        ) : (
          <span className="text-gray-400 text-[10.5px]">—</span>
        )}
      </Td>
      <Td>
        <CompactSelect value={row.feel || ""} disabled={isLocked} placeholder="—"
          onChange={(v) => onChange({ feel: v || null })}
          options={FEEL_OPTIONS.map((f) => ({ value: f, label: f }))} />
      </Td>
      <Td>
        <CompactSelect value={row.visual_style || ""} disabled={isLocked} placeholder="—"
          onChange={(v) => onChange({ visual_style: v || null })}
          options={VISUAL_STYLE_OPTIONS.map((f) => ({ value: f, label: f }))} />
      </Td>
      <Td>
        <Textarea rows={1} maxLength={500} value={row.style_prompt || ""} disabled={isLocked}
          onChange={(e) => onChange({ style_prompt: e.target.value || null })}
          placeholder="clean white bg, one accent"
          className="text-[10.5px] min-h-[24px] py-1 px-1.5 leading-snug" />
      </Td>
      <Td>
        <Textarea rows={1} maxLength={280} value={row.topic || ""} disabled={isLocked}
          onChange={(e) => onChange({ topic: e.target.value || null })}
          placeholder="What is this post about?"
          className="text-[10.5px] min-h-[24px] py-1 px-1.5 leading-snug" />
      </Td>
      <Td>
        <Textarea rows={1} maxLength={500} value={row.notes || ""} disabled={isLocked}
          onChange={(e) => onChange({ notes: e.target.value || null })}
          placeholder="CTA hint, constraints"
          className="text-[10.5px] min-h-[24px] py-1 px-1.5 leading-snug" />
      </Td>
      <Td>
        <div className="flex flex-col gap-1">
          <StatusChip status={row.status} compact />
          {row.last_error && <span className="text-[9px] text-rose-500 line-clamp-2">{row.last_error}</span>}
          {row.cost_usd != null && <span className="text-[9px] text-gray-400 tabular-nums">${Number(row.cost_usd).toFixed(3)}</span>}
        </div>
      </Td>
      <Td>
        {hasCard ? (
          <button onClick={onOpenCard} className="text-violet-600 hover:underline inline-flex items-center gap-1 text-[10.5px] font-medium">
            Open <ExternalLink className="w-2.5 h-2.5" />
          </button>
        ) : (
          <span className="text-gray-300 text-[10.5px]">—</span>
        )}
      </Td>
      <Td>
        {row.status === "generating" || row.status === "revising" ? (
          <Button size="sm" variant="outline" onClick={onCancel} className="h-6 text-[10.5px] px-2"><X className="w-2.5 h-2.5 mr-0.5" />Cancel</Button>
        ) : (
          <Button size="sm" onClick={onGenerate} disabled={!canGenerate || busy} className="h-6 text-[10.5px] px-2">
            {busy ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <><Sparkles className="w-2.5 h-2.5 mr-0.5" />Generate</>}
          </Button>
        )}
      </Td>
    </tr>
  );
}

// ─── Mobile card row ───

function StudioRowMobile(props: RowProps) {
  const { row, index, busy, onChange, onGenerate, onCancel, onOpenCard, hasCard } = props;
  const { platforms, mediaType, format, slides, resolved, formatOptions, isLocked, canGenerate, expectedImageCount } = useRowDerived(row);

  return (
    <div className="rounded-lg ring-1 ring-gray-100 dark:ring-white/[0.05] bg-white dark:bg-[#0f1015] p-3">
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-400 font-mono">#{index}</span>
          <StatusChip status={row.status} compact />
          {resolved && <span className="px-1.5 py-0.5 bg-gray-100 dark:bg-white/[0.04] rounded text-[9.5px] font-mono text-gray-600 dark:text-gray-300">{formatAspectChip(resolved)}</span>}
        </div>
        {hasCard && (
          <button onClick={onOpenCard} className="text-violet-600 inline-flex items-center gap-1 text-[10.5px] font-medium">Open <ExternalLink className="w-2.5 h-2.5" /></button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 mb-2">
        <MField label="Date">
          <Input type="date" value={row.scheduled_date || ""} onChange={(e) => onChange({ scheduled_date: e.target.value || null })} disabled={isLocked} className="h-8 text-[12px]" />
        </MField>
        <MField label="Time">
          <Input type="time" value={(row.scheduled_time || "").slice(0, 5)} onChange={(e) => onChange({ scheduled_time: e.target.value || null })} disabled={isLocked} className="h-8 text-[12px]" />
        </MField>
      </div>

      <MField label="Platforms">
        <PlatformDropdown value={platforms} onChange={(next) => onChange({ platforms: next })} disabled={isLocked} />
      </MField>

      <div className="grid grid-cols-2 gap-2 mt-2">
        <MField label="Media">
          <CompactSelect value={mediaType} disabled={isLocked}
            onChange={(v) => onChange({ media_type: v as MediaType, format: v === "video" ? "reel" : "single" })}
            options={[{ value: "image", label: "Image" }, { value: "video", label: "Video" }]} />
        </MField>
        <MField label="Format">
          <CompactSelect value={format} disabled={isLocked}
            onChange={(v) => onChange({ format: v as StudioFormat })}
            options={formatOptions.map((f) => ({ value: f.id, label: f.label }))} />
        </MField>
      </div>

      {format === "carousel" && (
        <MField label="Slides">
          <Input type="number" min={2} max={10} value={slides ?? 5} onChange={(e) => onChange({ slides_count: Number(e.target.value) || 5 })} disabled={isLocked} className="h-8 text-[12px]" />
        </MField>
      )}

      <div className="grid grid-cols-2 gap-2 mt-2">
        <MField label="Feel">
          <CompactSelect value={row.feel || ""} disabled={isLocked} placeholder="—"
            onChange={(v) => onChange({ feel: v || null })}
            options={FEEL_OPTIONS.map((f) => ({ value: f, label: f }))} />
        </MField>
        <MField label="Visual style">
          <CompactSelect value={row.visual_style || ""} disabled={isLocked} placeholder="—"
            onChange={(v) => onChange({ visual_style: v || null })}
            options={VISUAL_STYLE_OPTIONS.map((f) => ({ value: f, label: f }))} />
        </MField>
      </div>

      <MField label="Style prompt">
        <Textarea rows={2} maxLength={500} value={row.style_prompt || ""} disabled={isLocked}
          onChange={(e) => onChange({ style_prompt: e.target.value || null })}
          placeholder="clean white bg, one orange accent"
          className="text-[12px]" />
      </MField>

      <MField label="Topic">
        <Textarea rows={2} maxLength={280} value={row.topic || ""} disabled={isLocked}
          onChange={(e) => onChange({ topic: e.target.value || null })}
          placeholder="What is this post about?"
          className="text-[12px]" />
      </MField>

      <MField label="Notes">
        <Textarea rows={2} maxLength={500} value={row.notes || ""} disabled={isLocked}
          onChange={(e) => onChange({ notes: e.target.value || null })}
          placeholder="CTA hint, constraints"
          className="text-[12px]" />
      </MField>

      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex flex-col">
          {row.last_error && <span className="text-[10px] text-rose-500 line-clamp-2 max-w-[180px]">{row.last_error}</span>}
          {row.cost_usd != null && <span className="text-[10px] text-gray-400 tabular-nums">${Number(row.cost_usd).toFixed(3)} · {expectedImageCount} img</span>}
        </div>
        {row.status === "generating" || row.status === "revising" ? (
          <Button size="sm" variant="outline" onClick={onCancel} className="h-8 text-[12px]"><X className="w-3 h-3 mr-1" />Cancel</Button>
        ) : (
          <Button size="sm" onClick={onGenerate} disabled={!canGenerate || busy} className="h-8 text-[12px]">
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <><Sparkles className="w-3 h-3 mr-1" />Generate</>}
          </Button>
        )}
      </div>
    </div>
  );
}

function MField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-[9px] uppercase tracking-wider font-bold text-gray-400">{label}</p>
      {children}
    </div>
  );
}
