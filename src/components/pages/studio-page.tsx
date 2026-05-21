"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Sparkles, Plus, Loader2, X, ExternalLink, ChevronDown, Check, Calendar, Clock, Lock as LockIcon } from "lucide-react";
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
  const [accessState, setAccessState] = useState<"unknown" | "ok" | "disabled" | "denied">("unknown");
  const debounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const isAllowedRole = useMemo(() => {
    const role = (currentUser.role || "").toLowerCase();
    return ["superadmin", "admin", "owner", "creative_director", "social_media_specialist"].includes(role);
  }, [currentUser.role]);

  const makeBlankRow = useCallback((rowIndex: number): PlanRow => ({
    id: `tmp-${rowIndex}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    workspace_id: "", created_by: currentUser.email || "", row_index: rowIndex,
    scheduled_date: todayIso(rowIndex - 3 < 0 ? 0 : rowIndex - 3),
    scheduled_time: null, platforms: [], media_type: null, format: null, slides_count: null, resolved_aspect: null,
    feel: null, visual_style: null, style_prompt: null, topic: null, notes: null, status: "empty",
    generated_post_id: null, last_error: null, cost_usd: null,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }), [currentUser.email]);

  // Feature flag + allowlist check. Runs before fetching rows so we render
  // a clean disabled state if the kill switch is flipped (rather than a
  // sea of error toasts from the rows endpoint 503-ing).
  useEffect(() => {
    if (!isAllowedRole) {
      setAccessState("denied");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await authedFetch("/api/ai/studio/access");
        const json = await res.json();
        if (cancelled) return;
        const data = json.data || {};
        if (data.reason === "feature_disabled") setAccessState("disabled");
        else if (data.allowed) setAccessState("ok");
        else setAccessState("denied");
      } catch {
        if (!cancelled) setAccessState("denied");
      }
    })();
    return () => { cancelled = true; };
  }, [isAllowedRole]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await authedFetch(`/api/ai/studio/rows?from=${todayIso(-3)}&to=${todayIso(28)}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
        if (cancelled) return;
        const fetched = (json.data?.rows || []) as PlanRow[];
        setRows(fetched.length > 0 ? fetched : [makeBlankRow(0)]);
      } catch (err) {
        if (!cancelled) addToast(`Failed to load Studio rows: ${err instanceof Error ? err.message : String(err)}`, "error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    if (accessState === "ok") load();
    else setLoading(false);
    return () => { cancelled = true; };
  }, [addToast, accessState, makeBlankRow]);

  // Track tmp→real id swaps so the realtime echo doesn't duplicate the row.
  // When a POST /rows succeeds, the new server row may also arrive via
  // realtime. Without dedup we'd end up with both the tmp row (locally
  // optimistic) and the freshly inserted server row.
  const recentlyCreatedRef = useRef<Set<string>>(new Set());
  const markRecentlyCreated = (id: string) => {
    recentlyCreatedRef.current.add(id);
    setTimeout(() => recentlyCreatedRef.current.delete(id), 4000);
  };

  useEffect(() => {
    if (!isAllowedRole) return;
    const ch = supabase
      .channel("studio-plan-rows")
      .on("postgres_changes", { event: "*", schema: "public", table: "content_plan_rows" }, (payload) => {
        if (payload.eventType === "INSERT") {
          const next = payload.new as PlanRow;
          // Skip if our local POST already added this row (dedup).
          if (recentlyCreatedRef.current.has(next.id)) return;
          setRows((prev) => {
            if (prev.some((r) => r.id === next.id)) return prev;
            // Replace a matching tmp row (same row_index + same created_by) if it exists.
            const tmpIdx = prev.findIndex((r) => r.id.startsWith("tmp-") && r.row_index === next.row_index && r.created_by === next.created_by);
            if (tmpIdx >= 0) {
              const out = [...prev];
              out[tmpIdx] = next;
              return out;
            }
            return [...prev, next];
          });
        } else if (payload.eventType === "UPDATE") {
          const next = payload.new as PlanRow;
          setRows((prev) => {
            const idx = prev.findIndex((r) => r.id === next.id);
            if (idx >= 0) {
              const out = [...prev];
              out[idx] = { ...prev[idx], ...next };
              return out;
            }
            return prev; // ignore updates for rows we don't know about
          });
        } else if (payload.eventType === "DELETE") {
          const oldId = (payload.old as { id?: string }).id;
          if (oldId) setRows((prev) => prev.filter((r) => r.id !== oldId));
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [isAllowedRole]);

  // PERF-005: a single boolean gate for the job-status poll. The poll effect
  // depends ONLY on this flag, so it keeps one steady 3s timer running across
  // unrelated rows edits instead of tearing down/recreating on every change.
  const hasActiveJobs = rows.some((r) => r.status === "generating" || r.status === "revising");

  useEffect(() => {
    if (!hasActiveJobs) return;
    const interval = setInterval(async () => {
      // Read the current rows + jobId map from refs each tick so the timer
      // never needs to be rebuilt when those change.
      const generating = rowsRef.current.filter((r) => r.status === "generating" || r.status === "revising");
      for (const row of generating) {
        const jobId = jobIdByRowRef.current[row.id];
        if (!jobId) continue;
        try {
          const res = await authedFetch(`/api/ai/jobs/${jobId}`);
          const json = await res.json();
          if (res.ok && json.data?.job) {
            const j = json.data.job;
            if (j.status === "completed" || j.status === "failed" || j.status === "cancelled") {
              setJobIdByRow((m) => { const out = { ...m }; delete out[row.id]; return out; });
              if (j.status === "completed") addToast("AI draft ready. Check Awaiting Approval.", "success");
              else if (j.status === "failed") addToast(`AI generation failed: ${j.error || "unknown error"}`, "error");
            }
          }
        } catch { /* keep polling */ }
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [hasActiveJobs, addToast]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    async function loadSpend() {
      try {
        const cap = Number(process.env.NEXT_PUBLIC_OPENAI_DAILY_CAP_USD);
        if (Number.isFinite(cap) && cap > 0) setDailyCap(cap);
      } catch { /* ignore */ }
      if (accessState !== "ok") return;
      try {
        const res = await authedFetch("/api/ai/studio/spend");
        const json = await res.json().catch(() => ({}));
        if (!cancelled && res.ok && json.data) {
          const spent = Number(json.data.spend_today_usd);
          const cap = Number(json.data.daily_cap_usd);
          if (Number.isFinite(spent)) setSpendUsd(Math.round(spent * 100) / 100);
          if (Number.isFinite(cap) && cap > 0) setDailyCap(cap);
        }
      } catch { /* fall through */ }
    }
    void loadSpend();
    if (accessState === "ok") timer = setInterval(loadSpend, 5 * 60 * 1000);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [accessState]);

  // Tracks tmp rows that failed to save so we don't spam the user with the
  // same toast on every keystroke; we retry on the next debounce instead.
  const failedTmpRows = useRef<Set<string>>(new Set());

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
        markRecentlyCreated(saved.id);
        setRows((prev) => prev.map((r) => (r.id === row.id ? saved : r)));
        failedTmpRows.current.delete(row.id);
      } catch (err) {
        // Only toast once per tmp row failure to avoid noise — the next
        // keystroke will retry automatically via the debounce.
        if (!failedTmpRows.current.has(row.id)) {
          failedTmpRows.current.add(row.id);
          addToast(`Couldn't save the row: ${err instanceof Error ? err.message : String(err)}. We'll retry as you keep typing.`, "error");
        }
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

  // PERF-005: keep the latest jobId map in a ref so the job-status poll can
  // read it without listing jobIdByRow as an effect dependency.
  const jobIdByRowRef = useRef<Record<string, string>>(jobIdByRow);
  useEffect(() => { jobIdByRowRef.current = jobIdByRow; }, [jobIdByRow]);

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
      addToast("AI generation started. Back in about 20 seconds.", "info");
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
    setRows((prev) => {
      const nextIndex = prev.reduce((max, row) => Math.max(max, row.row_index ?? -1), -1) + 1;
      return [...prev, makeBlankRow(nextIndex)];
    });
  }, [makeBlankRow]);

  const openGeneratedPost = useCallback((row: PlanRow) => {
    if (!row.generated_post_id) return;
    navigateToPost(row.generated_post_id);
  }, [navigateToPost]);

  if (accessState === "unknown") {
    return (
      <div className="p-8 flex items-center justify-center gap-2 text-[12px] text-gray-400">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking access…
      </div>
    );
  }

  if (accessState === "disabled") {
    return (
      <div className="p-6 sm:p-8 max-w-2xl mx-auto">
        <div className="rounded-xl border border-amber-200 dark:border-amber-500/20 bg-amber-50/60 dark:bg-amber-500/[0.06] p-5">
          <h1 className="text-base font-semibold text-amber-900 dark:text-amber-300 mb-1.5 flex items-center gap-2">
            <Sparkles className="w-4 h-4" />Creator Studio is paused
          </h1>
          <p className="text-[12px] text-amber-800/80 dark:text-amber-300/80 leading-relaxed">
            Studio has been temporarily disabled by an admin. Drafts you already generated are unaffected. They stay in Awaiting Approval and can be reviewed and published normally. The Studio sheet itself will come back when the flag is flipped.
          </p>
        </div>
      </div>
    );
  }

  const readOnly = accessState === "denied";
  // For non-allowlisted users we still render the full page so they can see
  // what Studio looks like — but every control is disabled and a banner
  // tells them how to request access. Placeholder rows are seeded below so
  // the page isn't empty.
  const displayRows = readOnly && rows.length === 0
    ? [makeBlankRow(0)]
    : rows;

  const readyCount = rows.filter((r) => r.status === "ready").length;

  return (
    <div className="px-3 sm:px-5 lg:px-6 py-4 sm:py-5 max-w-[1100px] mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2 sm:gap-3 mb-4">
        <div>
          <h1 className="text-[15px] sm:text-base font-semibold flex items-center gap-1.5 text-gray-900 dark:text-gray-100">
            <Sparkles className="w-4 h-4 text-violet-500" />Creator Studio
          </h1>
          <p className="text-[11px] text-gray-500 mt-0.5 max-w-xl">Plan a row, click Generate. Drafts land in Awaiting Approval. AI never auto-approves or publishes.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <SpendChip spent={spendUsd} cap={dailyCap} />
          <Button variant="outline" size="sm" onClick={addRow} disabled={readOnly} className="h-7 text-[11px] px-2.5 cursor-pointer"><Plus className="w-3 h-3 mr-1" />Add Row</Button>
          <Button size="sm" onClick={generateBatch} disabled={readOnly || readyCount === 0} className="h-7 text-[11px] px-2.5 cursor-pointer">
            Bulk Generate {!readOnly && readyCount > 0 ? `(${readyCount})` : ""}
          </Button>
        </div>
      </div>

      {readOnly && (
        <div className="mb-4 rounded-xl border border-violet-200 dark:border-violet-500/20 bg-violet-50/60 dark:bg-violet-500/[0.06] p-4 flex items-start gap-3">
          <LockIcon className="w-4 h-4 mt-0.5 text-violet-600 dark:text-violet-300 shrink-0" />
          <div className="text-[12px] text-violet-900 dark:text-violet-200 leading-relaxed">
            <p className="font-semibold mb-0.5">Read-only preview</p>
            <p>You&apos;re seeing what Creator Studio looks like, but you can&apos;t edit or generate. Ask a developer in chat or create a support ticket to request Creator Studio access.</p>
          </div>
        </div>
      )}

      {spendUsd / dailyCap >= 0.9 && !readOnly && (
        <div className="mb-4 rounded-xl border border-rose-200 dark:border-rose-500/20 bg-rose-50/60 dark:bg-rose-500/[0.06] p-3 flex items-start gap-2.5">
          <Sparkles className="w-4 h-4 mt-0.5 text-rose-600 dark:text-rose-400 shrink-0" />
          <p className="text-[12px] text-rose-900 dark:text-rose-200 leading-relaxed">
            <span className="font-semibold">Daily AI cap almost reached.</span> Spent ${spendUsd.toFixed(2)} of ${dailyCap.toFixed(2)} today. New generations may be blocked until midnight.
          </p>
        </div>
      )}

      {loading && !readOnly ? (
        <div className="py-12 text-center text-gray-400 text-[12px] flex items-center justify-center gap-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading rows…
        </div>
      ) : (
        <fieldset
          disabled={readOnly}
          className={`space-y-3 border-0 p-0 m-0 min-w-0 ${readOnly ? "opacity-60 pointer-events-none select-none" : ""}`}
        >
          {displayRows.map((row, idx) => (
            <StudioCard
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
        </fieldset>
      )}
    </div>
  );
}

// ─── Shared chips / atoms ───

function SpendChip({ spent, cap }: { spent: number; cap: number }) {
  const pct = Math.min(100, Math.round((spent / cap) * 100));
  const tone = pct >= 90 ? "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"
    : pct >= 60 ? "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
    : "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300";
  return (
    <div className={`text-[11px] px-2 py-0.5 rounded-full font-medium tabular-nums ${tone}`}>
      Daily AI cap: ${spent.toFixed(2)} / ${cap.toFixed(2)}
    </div>
  );
}

function StatusChip({ status }: { status: PlanRowStatus }) {
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${STATUS_COLOR[status]}`}>
      {(status === "generating" || status === "revising") && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
      {STATUS_LABEL[status]}
    </span>
  );
}

function FieldLabel({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between mb-1">
      <p className="text-[10px] uppercase tracking-wider font-bold text-gray-400 dark:text-gray-500">{children}</p>
      {hint && <p className="text-[9px] text-gray-300 dark:text-gray-600">{hint}</p>}
    </div>
  );
}

function CompactSelect({ value, onChange, options, disabled, placeholder, className = "" }: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={`relative inline-block w-full ${className}`}>
      <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}
        className="appearance-none h-8 w-full pl-2.5 pr-7 text-[12px] rounded-md border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-[#0c0d11] text-gray-700 dark:text-gray-200 disabled:opacity-50 cursor-pointer focus:outline-none focus:ring-1 focus:ring-violet-400">
        {placeholder ? <option value="">{placeholder}</option> : null}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" />
    </div>
  );
}

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

  const summary = value.length === 0
    ? "Select platforms…"
    : value.length === 1
      ? labelFor(value[0])
      : `${value.length} platforms selected`;

  return (
    <div ref={wrapperRef} className="relative w-full">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((p) => !p)}
        className={`h-8 w-full px-2.5 pr-7 text-[12px] rounded-md border text-left flex items-center disabled:opacity-50 cursor-pointer focus:outline-none focus:ring-1 focus:ring-violet-400 ${value.length > 0 ? "border-violet-300 bg-violet-50/40 dark:border-violet-500/40 dark:bg-violet-500/[0.06] text-violet-700 dark:text-violet-300 font-medium" : "border-gray-200 dark:border-white/[0.08] bg-white dark:bg-[#0c0d11] text-gray-500 dark:text-gray-400"}`}
      >
        <span className="truncate">{summary}</span>
        <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 left-0 right-0 sm:right-auto sm:min-w-[200px] bg-white dark:bg-[#15161b] border border-gray-200 dark:border-white/[0.08] rounded-md shadow-xl overflow-hidden">
          {PLATFORM_OPTIONS.map((p) => {
            const on = value.includes(p.id);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => toggle(p.id)}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-[12px] hover:bg-gray-50 dark:hover:bg-white/[0.04] text-left ${on ? "text-violet-700 dark:text-violet-300 font-medium" : "text-gray-700 dark:text-gray-300"}`}
              >
                <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${on ? "bg-violet-600 border-violet-600 text-white" : "border-gray-300 dark:border-white/[0.15] bg-transparent"}`}>
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

// ─── Card row (works on every screen size) ───

interface CardProps {
  row: PlanRow;
  index: number;
  busy: boolean;
  onChange: (patch: Partial<PlanRow>) => void;
  onGenerate: () => void;
  onCancel: () => void;
  onOpenCard: () => void;
  hasCard: boolean;
}

function StudioCard(props: CardProps) {
  const { row, index, busy, onChange, onGenerate, onCancel, onOpenCard, hasCard } = props;
  const platforms = useMemo(() => row.platforms || [], [row.platforms]);
  const mediaType: MediaType = (row.media_type as MediaType) || "image";
  const format = (row.format as StudioFormat) || (mediaType === "video" ? "reel" : "single");
  const slides = row.slides_count ?? (format === "carousel" ? 5 : null);

  const resolved = useMemo(() => {
    if (!row.media_type || !row.format || platforms.length === 0) return null;
    return resolveAspect({ mediaType: row.media_type as MediaType, format: row.format as StudioFormat, platforms });
  }, [row.media_type, row.format, platforms]);

  const formatOptions = mediaType === "video" ? FORMATS_FOR_VIDEO : FORMATS_FOR_IMAGE;
  const isLocked = row.status === "generating" || row.status === "revising" || row.status === "generated";
  const canGenerate = !isLocked
    && Boolean(row.scheduled_date)
    && platforms.length > 0
    && Boolean(row.media_type)
    && Boolean(row.format)
    && Boolean(row.feel)
    && Boolean(row.visual_style);
  const expectedImageCount = imageCountForPlan(format, mediaType, slides);

  return (
    <div className={`rounded-xl ring-1 transition-colors ${isLocked ? "ring-gray-100 dark:ring-white/[0.04] bg-gray-50/40 dark:bg-white/[0.015]" : "ring-gray-200/70 dark:ring-white/[0.06] bg-white dark:bg-[#0f1015] hover:ring-violet-200 dark:hover:ring-violet-500/30"}`}>
      {/* Header strip */}
      <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-gray-100 dark:border-white/[0.04]">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <span className="font-mono text-[10px] text-gray-300 dark:text-gray-600 tabular-nums shrink-0">#{String(index).padStart(2, "0")}</span>
          <StatusChip status={row.status} />
          {resolved && (
            <span className="hidden sm:inline-flex px-1.5 py-0.5 bg-gray-100 dark:bg-white/[0.04] rounded text-[10px] font-mono text-gray-600 dark:text-gray-300">
              {formatAspectChip(resolved)}
            </span>
          )}
          {expectedImageCount > 1 && (
            <span className="text-[10px] text-gray-400 dark:text-gray-500">· {expectedImageCount} images</span>
          )}
          {row.cost_usd != null && (
            <span className="text-[10px] text-gray-400 dark:text-gray-500 tabular-nums">· ${Number(row.cost_usd).toFixed(3)}</span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {hasCard && (
            <button onClick={onOpenCard} className="text-violet-600 hover:text-violet-700 dark:text-violet-400 inline-flex items-center gap-1 text-[11px] font-medium cursor-pointer">
              Open card <ExternalLink className="w-3 h-3" />
            </button>
          )}
          {row.status === "generating" || row.status === "revising" || busy ? (
            <Button size="sm" variant="outline" onClick={onCancel} className="h-7 text-[11px] px-2 cursor-pointer"><X className="w-3 h-3 mr-1" />Cancel</Button>
          ) : (
            <Button size="sm" onClick={onGenerate} disabled={!canGenerate} className="h-7 text-[11px] px-2.5 cursor-pointer">
              <Sparkles className="w-3 h-3 mr-1" />Generate
            </Button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="p-4 space-y-3">
        {/* Row 1: schedule */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="col-span-1">
            <FieldLabel>Date</FieldLabel>
            <div className="relative">
              <Calendar className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" />
              <Input type="date" value={row.scheduled_date || ""} onChange={(e) => onChange({ scheduled_date: e.target.value || null })} disabled={isLocked} min={new Date().toISOString().slice(0, 10)} className="h-8 text-[13px] sm:text-[12px] pl-7 pr-2 cursor-pointer" />
            </div>
          </div>
          <div className="col-span-1">
            <FieldLabel>Time</FieldLabel>
            <div className="relative">
              <Clock className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" />
              <Input type="time" value={(row.scheduled_time || "").slice(0, 5)} onChange={(e) => onChange({ scheduled_time: e.target.value || null })} disabled={isLocked} className="h-8 text-[13px] sm:text-[12px] pl-7 pr-2 cursor-pointer" />
            </div>
          </div>
          <div className="col-span-2 sm:col-span-2">
            <FieldLabel hint={platforms.length > 0 ? platforms.map(labelFor).join(" · ") : undefined}>Platforms</FieldLabel>
            <PlatformDropdown value={platforms} onChange={(next) => onChange({ platforms: next })} disabled={isLocked} />
          </div>
        </div>

        {/* Row 2: media + format + slides + aspect */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div>
            <FieldLabel>Media</FieldLabel>
            <CompactSelect value={mediaType} disabled={isLocked}
              onChange={(v) => onChange({ media_type: v as MediaType, format: v === "video" ? "reel" : "single" })}
              options={[{ value: "image", label: "Image" }, { value: "video", label: "Video (Portrait)" }]} />
          </div>
          <div>
            <FieldLabel>Format</FieldLabel>
            <CompactSelect value={format} disabled={isLocked}
              onChange={(v) => onChange({ format: v as StudioFormat })}
              options={formatOptions.map((f) => ({ value: f.id, label: f.label }))} />
          </div>
          <div>
            <FieldLabel>{format === "carousel" ? "Slides" : "Images"}</FieldLabel>
            {format === "carousel" ? (
              <Input type="number" min={2} max={10} value={slides ?? 5} onChange={(e) => onChange({ slides_count: Number(e.target.value) || 5 })} disabled={isLocked} className="h-8 text-[12px] px-2" />
            ) : (
              <div className="h-8 flex items-center px-2 text-[12px] text-gray-500 bg-gray-50 dark:bg-white/[0.02] rounded-md border border-gray-100 dark:border-white/[0.05]">
                {expectedImageCount}
              </div>
            )}
          </div>
          <div>
            <FieldLabel>Aspect</FieldLabel>
            <div className="h-8 flex items-center px-2 text-[11px] font-mono text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-white/[0.02] rounded-md border border-gray-100 dark:border-white/[0.05]">
              {resolved ? formatAspectChip(resolved) : "Not set"}
            </div>
          </div>
        </div>

        {/* Row 3: feel + visual style */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <FieldLabel>Feel</FieldLabel>
            <CompactSelect value={row.feel || ""} disabled={isLocked} placeholder="Select feel…"
              onChange={(v) => onChange({ feel: v || null })}
              options={FEEL_OPTIONS.map((f) => ({ value: f, label: f }))} />
          </div>
          <div>
            <FieldLabel>Visual style</FieldLabel>
            <CompactSelect value={row.visual_style || ""} disabled={isLocked} placeholder="Select visual…"
              onChange={(v) => onChange({ visual_style: v || null })}
              options={VISUAL_STYLE_OPTIONS.map((f) => ({ value: f, label: f }))} />
          </div>
        </div>

        {/* Row 4: free text */}
        <div className="space-y-3">
          <div>
            <FieldLabel hint={`${(row.style_prompt || "").length}/500`}>Style prompt</FieldLabel>
            <Textarea rows={2} maxLength={500} value={row.style_prompt || ""} disabled={isLocked}
              onChange={(e) => onChange({ style_prompt: e.target.value || null })}
              placeholder="e.g. clean white background, single orange accent #FF6A00, bold sans-serif, no people"
              className="text-[12px] min-h-[52px] resize-y leading-snug" />
          </div>
          <div>
            <FieldLabel hint={`${(row.topic || "").length}/280`}>Topic</FieldLabel>
            <Textarea rows={2} maxLength={280} value={row.topic || ""} disabled={isLocked}
              onChange={(e) => onChange({ topic: e.target.value || null })}
              placeholder="What is this post about?"
              className="text-[12px] min-h-[52px] resize-y leading-snug" />
          </div>
          <div>
            <FieldLabel hint={`${(row.notes || "").length}/500`}>Notes &amp; constraints</FieldLabel>
            <Textarea rows={2} maxLength={500} value={row.notes || ""} disabled={isLocked}
              onChange={(e) => onChange({ notes: e.target.value || null })}
              placeholder="Audience, CTA hint, specific facts you want included, etc."
              className="text-[12px] min-h-[52px] resize-y leading-snug" />
          </div>
        </div>

        {/* Inline error / last-error */}
        {row.last_error && (
          <div className="text-[11px] text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-500/[0.08] border border-rose-100 dark:border-rose-500/20 rounded-md px-2.5 py-1.5">
            {row.last_error}
          </div>
        )}
      </div>
    </div>
  );
}
