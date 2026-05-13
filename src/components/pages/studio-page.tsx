"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Sparkles, Plus, Loader2, X, ExternalLink, ChevronDown } from "lucide-react";
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
  { id: "reel", label: "Reel / Short" },
  { id: "storyboard", label: "Storyboard" },
];

const STATUS_LABEL: Record<PlanRowStatus, string> = {
  empty: "Empty",
  ready: "Ready",
  generating: "Generating…",
  generated: "Generated",
  failed: "Failed",
  revising: "Revising…",
};

const STATUS_COLOR: Record<PlanRowStatus, string> = {
  empty: "bg-gray-100 text-gray-500 dark:bg-white/[0.06] dark:text-gray-400",
  ready: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  generating: "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300",
  generated: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  failed: "bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300",
  revising: "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300",
};

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
  const [dailyCap, setDailyCap] = useState<number>(25);
  const debounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const isAllowedRole = useMemo(() => {
    const role = (currentUser.role || "").toLowerCase();
    return ["superadmin", "admin", "owner", "creative_director", "social_media_specialist"].includes(role);
  }, [currentUser.role]);

  // ─── Initial load ───
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await authedFetch(`/api/ai/studio/rows?from=${todayIso(-3)}&to=${todayIso(28)}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
        if (cancelled) return;
        const fetched = (json.data?.rows || []) as PlanRow[];
        // If fewer than 14, top up with blank rows (in-memory only — they save on edit).
        const have = fetched.length;
        const placeholders: PlanRow[] = [];
        for (let i = 0; i < Math.max(0, 14 - have); i++) {
          placeholders.push(makeBlankRow(have + i));
        }
        setRows([...fetched, ...placeholders]);
      } catch (err) {
        if (!cancelled) {
          addToast(`Failed to load Studio rows: ${err instanceof Error ? err.message : String(err)}`, "error");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    if (isAllowedRole) load();
    else setLoading(false);
    return () => { cancelled = true; };
  }, [addToast, isAllowedRole]);

  // ─── Subscribe to realtime updates on plan rows + ai jobs ───
  useEffect(() => {
    if (!isAllowedRole) return;
    const ch = supabase
      .channel("studio-plan-rows")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "content_plan_rows" },
        (payload) => {
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
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [isAllowedRole]);

  // ─── Poll job status for rows that are generating ───
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
              setJobIdByRow((m) => {
                const out = { ...m };
                delete out[row.id];
                return out;
              });
              // Realtime will update the row itself; just toast on terminal state.
              if (j.status === "completed") addToast("AI draft ready — check Awaiting Approval.", "success");
              else if (j.status === "failed") addToast(`AI generation failed: ${j.error || "unknown error"}`, "error");
            }
          }
        } catch { /* keep polling */ }
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [rows, jobIdByRow, addToast]);

  // ─── Today's spend (refreshed after each completed generation) ───
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

  // ─── Helpers ───

  function makeBlankRow(rowIndex: number): PlanRow {
    return {
      id: `tmp-${rowIndex}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      workspace_id: "",
      created_by: currentUser.email || "",
      row_index: rowIndex,
      scheduled_date: todayIso(rowIndex - 3 < 0 ? 0 : rowIndex - 3),
      scheduled_time: null,
      platforms: [],
      media_type: null,
      format: null,
      slides_count: null,
      resolved_aspect: null,
      feel: null,
      visual_style: null,
      style_prompt: null,
      topic: null,
      notes: null,
      status: "empty",
      generated_post_id: null,
      last_error: null,
      cost_usd: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  const persistRowChange = useCallback(async (row: PlanRow, patch: Partial<PlanRow>) => {
    const isTmp = row.id.startsWith("tmp-");
    if (isTmp) {
      // First save creates the row.
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
      const res = await authedFetch(`/api/ai/studio/rows/${row.id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
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
    // Optimistic local update + debounced PATCH.
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, ...patch } : r)));
    if (debounceTimers.current[row.id]) clearTimeout(debounceTimers.current[row.id]);
    debounceTimers.current[row.id] = setTimeout(() => {
      const current = rowsRef.current.find((r) => r.id === row.id);
      if (current) void persistRowChange(current, patch);
    }, 600);
  }, [persistRowChange]);

  const rowsRef = useRef<PlanRow[]>(rows);
  useEffect(() => { rowsRef.current = rows; }, [rows]);

  // ─── Per-row Generate ───
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
      const res = await authedFetch(`/api/ai/studio/generate-batch`, {
        method: "POST",
        body: JSON.stringify({ row_ids: ready }),
      });
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

  // ─── Render ───

  if (!isAllowedRole) {
    return (
      <div className="p-8 max-w-3xl mx-auto">
        <h1 className="text-xl font-semibold mb-3">Studio is restricted</h1>
        <p className="text-sm text-gray-500">Your role doesn&apos;t have access to AI generation. Ask an admin if you need it.</p>
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-[1600px] mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Sparkles className="w-4.5 h-4.5 text-violet-500" />
            Creator Studio
          </h1>
          <p className="text-[12px] text-gray-500 mt-0.5">Plan a row, click Generate. Drafts land in Awaiting Approval for review — AI never auto-approves or publishes.</p>
        </div>
        <div className="flex items-center gap-2.5">
          <SpendChip spent={spendUsd} cap={dailyCap} />
          <Button variant="outline" size="sm" onClick={addRow}><Plus className="w-3.5 h-3.5 mr-1" />Add Row</Button>
          <Button size="sm" onClick={generateBatch} disabled={rows.every((r) => r.status !== "ready")} >
            Bulk Generate Ready
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="py-16 text-center text-gray-400 text-sm flex items-center justify-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading rows…
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl ring-1 ring-gray-100 dark:ring-white/[0.05] bg-white dark:bg-[#0f1015]">
          <table className="min-w-full text-[12px]">
            <thead className="bg-gray-50/70 dark:bg-white/[0.02] text-[10px] uppercase tracking-wider text-gray-400">
              <tr>
                <Th>#</Th>
                <Th>Date</Th>
                <Th>Time</Th>
                <Th>Platforms</Th>
                <Th>Media</Th>
                <Th>Format</Th>
                <Th>Slides</Th>
                <Th>Aspect</Th>
                <Th>Feel</Th>
                <Th>Visual Style</Th>
                <Th>Style Prompt</Th>
                <Th>Topic</Th>
                <Th>Notes</Th>
                <Th>Status</Th>
                <Th>Card</Th>
                <Th>Action</Th>
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
      )}
    </div>
  );
}

// ─── Helpers / cells ───

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 text-left font-semibold whitespace-nowrap">{children}</th>;
}

function SpendChip({ spent, cap }: { spent: number; cap: number }) {
  const pct = Math.min(100, Math.round((spent / cap) * 100));
  const tone = pct >= 90 ? "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"
    : pct >= 60 ? "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
    : "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300";
  return (
    <div className={`text-[10.5px] px-2.5 py-1 rounded-full font-medium tabular-nums ${tone}`}>
      ${spent.toFixed(2)} / ${cap.toFixed(2)} today
    </div>
  );
}

function StatusChip({ status }: { status: PlanRowStatus }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-semibold ${STATUS_COLOR[status]}`}>
      {(status === "generating" || status === "revising") && <Loader2 className="w-3 h-3 animate-spin" />}
      {STATUS_LABEL[status]}
    </span>
  );
}

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

function StudioRow(props: RowProps) {
  const { row, index, busy, onChange, onGenerate, onCancel, onOpenCard, hasCard } = props;
  const platforms = row.platforms || [];
  const mediaType: MediaType = (row.media_type as MediaType) || "image";
  const format = (row.format as StudioFormat) || (mediaType === "video" ? "reel" : "single");
  const slides = row.slides_count ?? (format === "carousel" ? 5 : null);

  const resolved = useMemo(() => {
    if (!row.media_type || !row.format || platforms.length === 0) return null;
    return resolveAspect({
      mediaType: row.media_type as MediaType,
      format: row.format as StudioFormat,
      platforms,
    });
  }, [row.media_type, row.format, platforms]);

  const formatOptions = mediaType === "video" ? FORMATS_FOR_VIDEO : FORMATS_FOR_IMAGE;
  const isLocked = row.status === "generating" || row.status === "revising" || row.status === "generated";
  const canGenerate = !isLocked && Boolean(row.scheduled_date) && platforms.length > 0 && Boolean(row.media_type) && Boolean(row.format) && Boolean(row.feel) && Boolean(row.visual_style);

  const expectedImageCount = useMemo(() => imageCountForPlan(format, mediaType, slides), [format, mediaType, slides]);

  const togglePlatform = (id: string) => {
    if (isLocked) return;
    const next = platforms.includes(id) ? platforms.filter((p) => p !== id) : [...platforms, id];
    onChange({ platforms: next });
  };

  return (
    <tr className="hover:bg-gray-50/60 dark:hover:bg-white/[0.02] transition-colors align-top">
      <Td>{index}</Td>
      <Td>
        <Input type="date" value={row.scheduled_date || ""}
          onChange={(e) => onChange({ scheduled_date: e.target.value || null })}
          disabled={isLocked}
          className="h-7 text-[11.5px] w-[125px]" />
      </Td>
      <Td>
        <Input type="time" value={(row.scheduled_time || "").slice(0, 5)}
          onChange={(e) => onChange({ scheduled_time: e.target.value || null })}
          disabled={isLocked}
          className="h-7 text-[11.5px] w-[95px]" />
      </Td>
      <Td>
        <div className="flex flex-wrap gap-1 max-w-[170px]">
          {PLATFORM_OPTIONS.map((p) => {
            const on = platforms.includes(p.id);
            return (
              <button key={p.id} type="button" disabled={isLocked}
                onClick={() => togglePlatform(p.id)}
                className={`px-1.5 py-0.5 rounded text-[10px] font-medium border transition-colors ${on ? "bg-violet-500/15 text-violet-700 border-violet-300 dark:text-violet-300 dark:border-violet-500/40" : "bg-white dark:bg-transparent border-gray-200 dark:border-white/[0.08] text-gray-500 dark:text-gray-400"}`}>
                {p.label}
              </button>
            );
          })}
        </div>
      </Td>
      <Td>
        <Select value={mediaType} disabled={isLocked}
          onChange={(v) => onChange({ media_type: v as MediaType, format: v === "video" ? "reel" : "single" })}
          options={[{ value: "image", label: "Image" }, { value: "video", label: "Video (Portrait)" }]} />
      </Td>
      <Td>
        <Select value={format} disabled={isLocked}
          onChange={(v) => onChange({ format: v as StudioFormat })}
          options={formatOptions.map((f) => ({ value: f.id, label: f.label }))} />
      </Td>
      <Td>
        {format === "carousel" ? (
          <Input type="number" min={2} max={10} value={slides ?? 5}
            onChange={(e) => onChange({ slides_count: Number(e.target.value) || 5 })}
            disabled={isLocked}
            className="h-7 w-[60px] text-[11.5px]" />
        ) : (
          <span className="text-gray-400 text-[11px]">{expectedImageCount}</span>
        )}
      </Td>
      <Td>
        {resolved ? (
          <span className="inline-flex px-1.5 py-0.5 bg-gray-100 dark:bg-white/[0.04] rounded text-[10.5px] font-mono text-gray-600 dark:text-gray-300" title="Resolved automatically from platform + format">
            {formatAspectChip(resolved)}
          </span>
        ) : (
          <span className="text-gray-400 text-[11px]">—</span>
        )}
      </Td>
      <Td>
        <Select value={row.feel || ""} disabled={isLocked}
          onChange={(v) => onChange({ feel: v || null })}
          options={[{ value: "", label: "—" }, ...FEEL_OPTIONS.map((f) => ({ value: f, label: f }))]} />
      </Td>
      <Td>
        <Select value={row.visual_style || ""} disabled={isLocked}
          onChange={(v) => onChange({ visual_style: v || null })}
          options={[{ value: "", label: "—" }, ...VISUAL_STYLE_OPTIONS.map((f) => ({ value: f, label: f }))]} />
      </Td>
      <Td>
        <Textarea rows={2} maxLength={500} value={row.style_prompt || ""} disabled={isLocked}
          onChange={(e) => onChange({ style_prompt: e.target.value || null })}
          placeholder="e.g. clean white bg, single orange accent"
          className="text-[11.5px] min-h-[44px] w-[220px]" />
      </Td>
      <Td>
        <Textarea rows={2} maxLength={280} value={row.topic || ""} disabled={isLocked}
          onChange={(e) => onChange({ topic: e.target.value || null })}
          placeholder="What is this post about?"
          className="text-[11.5px] min-h-[44px] w-[200px]" />
      </Td>
      <Td>
        <Textarea rows={2} maxLength={500} value={row.notes || ""} disabled={isLocked}
          onChange={(e) => onChange({ notes: e.target.value || null })}
          placeholder="Constraints, CTA hint, etc."
          className="text-[11.5px] min-h-[44px] w-[200px]" />
      </Td>
      <Td>
        <div className="flex flex-col gap-1">
          <StatusChip status={row.status} />
          {row.last_error && <span className="text-[10px] text-rose-500 max-w-[160px] line-clamp-3">{row.last_error}</span>}
          {row.cost_usd != null && <span className="text-[10px] text-gray-400 tabular-nums">${Number(row.cost_usd).toFixed(3)}</span>}
        </div>
      </Td>
      <Td>
        {hasCard ? (
          <button onClick={onOpenCard} className="text-violet-600 hover:underline inline-flex items-center gap-1 text-[11px] font-medium">
            Open <ExternalLink className="w-3 h-3" />
          </button>
        ) : (
          <span className="text-gray-300 text-[11px]">—</span>
        )}
      </Td>
      <Td>
        {row.status === "generating" || row.status === "revising" ? (
          <Button size="sm" variant="outline" onClick={onCancel} className="h-7 text-[11px]"><X className="w-3 h-3 mr-1" />Cancel</Button>
        ) : (
          <Button size="sm" onClick={onGenerate} disabled={!canGenerate || busy} className="h-7 text-[11px]">
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3 mr-1" />}
            Generate
          </Button>
        )}
      </Td>
    </tr>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-3 py-2 align-top">{children}</td>;
}

function Select({ value, onChange, options, disabled }: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  return (
    <div className="relative inline-block">
      <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}
        className="appearance-none h-7 pl-2 pr-6 text-[11.5px] rounded-md border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-transparent text-gray-700 dark:text-gray-200 disabled:opacity-50">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" />
    </div>
  );
}
