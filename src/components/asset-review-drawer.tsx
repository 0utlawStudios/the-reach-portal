"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { usePipeline } from "@/lib/pipeline-context";
import { PIPELINE_COLUMNS, PipelineStage } from "@/lib/types";
import { SOCIAL_PROFILES } from "@/lib/social-profiles";
import { logAudit, fetchAuditLogs, AuditEntry } from "@/lib/audit";
import { supabase } from "@/lib/supabaseClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import {
  X, Calendar, Clock, PlayCircle, ChevronRight, CheckCircle2, MessageSquare,
  ArrowRightLeft, Pencil, Save, ExternalLink, Hash, Type, Trash2, Send,
  Upload, FolderOpen, Link2, FileText, History, Image as ImageIcon,
  FileVideo, Paperclip, ExternalLink as ExtLink,
} from "lucide-react";
import { PlatformIcon } from "./platform-icons";
import { MentionTextarea } from "./mention-textarea";
import { InlineEdit } from "./inline-edit";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/lib/toast-context";

const useSupabase = !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

type DrawerTab = "content" | "vault" | "audit";

export function AssetReviewDrawer() {
  const { selectedCard, isDrawerOpen, isEditingOnOpen, closeDrawer, moveCard, requestReapproval, updateCard, deleteCard } = usePipeline();
  const { addToast } = useToast();
  const { currentUser } = useAuth();
  const [revisionMode, setRevisionMode] = useState(false);
  const [revisionFeedback, setRevisionFeedback] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editTime, setEditTime] = useState("");
  const [dateEditing, setDateEditing] = useState(false);
  const [newComment, setNewComment] = useState("");
  const [activeTab, setActiveTab] = useState<DrawerTab>("content");
  const prevCardRef = useRef<string | null>(null);
  const viewLoggedRef = useRef<string | null>(null);

  // Source Vault state
  const [designLink, setDesignLink] = useState("");
  const [driveFolder, setDriveFolder] = useState("");
  const [vaultSaving, setVaultSaving] = useState(false);

  // Audit Trail state
  const [auditLogs, setAuditLogs] = useState<AuditEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);

  // Asset replacement state
  const assetInputRef = useRef<HTMLInputElement>(null);
  const rawFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (selectedCard && isEditingOnOpen && prevCardRef.current !== selectedCard.id) {
      setDateEditing(true);
      setEditDate(selectedCard.scheduledDate || "");
      setEditTime(selectedCard.scheduledTime || "");
      prevCardRef.current = selectedCard.id;
    }
    if (selectedCard && prevCardRef.current !== selectedCard.id) {
      // Sync vault inputs from card
      setDesignLink(selectedCard.sourceVault?.designLink || "");
      setDriveFolder(selectedCard.sourceVault?.driveFolder || "");
      setActiveTab("content");
      prevCardRef.current = selectedCard.id;
    }
    if (!isDrawerOpen) {
      setRevisionMode(false);
      setRevisionFeedback("");
      setDateEditing(false);
      setNewComment("");
      setActiveTab("content");
      prevCardRef.current = null;
      viewLoggedRef.current = null;
    }
  }, [selectedCard, isEditingOnOpen, isDrawerOpen]);

  // ─── Debounced "Card Viewed" audit log ───
  useEffect(() => {
    if (!selectedCard || !isDrawerOpen) return;
    if (viewLoggedRef.current === selectedCard.id) return;
    const timer = setTimeout(() => {
      logAudit(selectedCard.id, currentUser.name, "card_viewed", `Viewed "${selectedCard.title}"`);
      viewLoggedRef.current = selectedCard.id;
    }, 800);
    return () => clearTimeout(timer);
  }, [selectedCard?.id, isDrawerOpen, currentUser.name]);

  // ─── Fetch audit logs when tab switches to "audit" ───
  useEffect(() => {
    if (activeTab !== "audit" || !selectedCard) return;
    setAuditLoading(true);
    fetchAuditLogs(selectedCard.id).then((logs) => {
      setAuditLogs(logs);
      setAuditLoading(false);
    });
  }, [activeTab, selectedCard?.id]);

  if (!selectedCard || !isDrawerOpen) return null;

  const currentColumn = PIPELINE_COLUMNS.find((c) => c.id === selectedCard.stage);
  const checkedCount = selectedCard.checklist.filter((c) => c.checked).length;
  const totalChecklist = selectedCard.checklist.length;
  const allChecked = checkedCount === totalChecklist;
  const isRepurposed = selectedCard.title.startsWith("[Repurposed]");

  const toggleChecklistItem = (itemId: string) => {
    updateCard(selectedCard.id, { checklist: selectedCard.checklist.map((c) => c.id === itemId ? { ...c, checked: !c.checked } : c) });
  };

  const stages: PipelineStage[] = ["ideas", "awaiting_approval", "revision_needed", "approved_scheduled", "posted"];
  const idx = stages.indexOf(selectedCard.stage);
  const nextStage = idx < stages.length - 1 ? stages[idx + 1] : null;
  const nextColumn = nextStage ? PIPELINE_COLUMNS.find((c) => c.id === nextStage) : null;

  const noteLines = selectedCard.notes ? selectedCard.notes.split("\n\n").filter(Boolean) : [];

  const addComment = () => {
    if (!newComment.trim()) return;
    const timestamp = new Date().toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    const comment = `${currentUser.name} (${timestamp}): ${newComment.trim()}`;
    const existing = selectedCard.notes ? selectedCard.notes + "\n\n" : "";
    updateCard(selectedCard.id, { notes: existing + comment });
    logAudit(selectedCard.id, currentUser.name, "comment_added", newComment.trim());
    setNewComment("");
  };

  const saveDate = () => {
    updateCard(selectedCard.id, { scheduledDate: editDate || undefined, scheduledTime: editTime || undefined });
    setDateEditing(false);
    addToast("Schedule updated", "info");
  };

  // ─── Replace primary asset ───
  const handleAssetReplace = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    let newUrl = URL.createObjectURL(file);
    if (useSupabase) {
      const ext = file.name.split(".").pop();
      const path = `assets/${selectedCard.id}-${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
      if (!error) {
        const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(path);
        newUrl = urlData.publicUrl;
      }
    }
    updateCard(selectedCard.id, { thumbnailUrl: newUrl });
    logAudit(selectedCard.id, currentUser.name, "asset_replaced", `Replaced primary asset with ${file.name}`);
    addToast("Primary asset replaced", "success");
    if (assetInputRef.current) assetInputRef.current.value = "";
  };

  // ─── Source Vault save ───
  const saveVault = async () => {
    setVaultSaving(true);
    const vault = { ...selectedCard.sourceVault, designLink: designLink || undefined, driveFolder: driveFolder || undefined };
    updateCard(selectedCard.id, { sourceVault: vault });
    logAudit(selectedCard.id, currentUser.name, "vault_updated", "Updated source vault links");
    addToast("Source vault saved", "success");
    setVaultSaving(false);
  };

  // ─── Raw file upload ───
  const handleRawFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    let fileUrl = URL.createObjectURL(file);
    if (useSupabase) {
      const ext = file.name.split(".").pop();
      const path = `raw-files/${selectedCard.id}-${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
      if (!error) {
        const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(path);
        fileUrl = urlData.publicUrl;
      }
    }
    const rawFiles = [...(selectedCard.sourceVault?.rawFiles || []), { name: file.name, url: fileUrl, uploadedAt: new Date().toISOString() }];
    const vault = { ...selectedCard.sourceVault, rawFiles };
    updateCard(selectedCard.id, { sourceVault: vault });
    logAudit(selectedCard.id, currentUser.name, "raw_file_uploaded", `Uploaded ${file.name}`);
    addToast(`${file.name} uploaded`, "success");
    if (rawFileInputRef.current) rawFileInputRef.current.value = "";
  };

  return (
    <>
      <div onClick={closeDrawer} className="fixed inset-0 bg-black/20 dark:bg-black/50 z-40 transition-opacity duration-200" />
      <div className="fixed right-0 top-0 bottom-0 w-full max-w-full md:max-w-[560px] z-50 flex flex-col bg-white dark:bg-[#0e0e11] border-l-0 md:border-l border-gray-200 dark:border-white/[0.08] shadow-2xl animate-in slide-in-from-right duration-200">

        {/* ─── Top Bar ─── */}
        <div className="flex items-center justify-between px-6 py-3.5 border-b border-gray-100 dark:border-white/[0.06] shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: currentColumn?.color }} />
            <span className="text-[13px] font-medium text-gray-500 dark:text-gray-400">{currentColumn?.title}</span>
            {isRepurposed && <Badge variant="outline" className="text-[9px] h-4 px-1.5 border-indigo-200 dark:border-indigo-500/20 text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-500/10">Repurposed</Badge>}
            {selectedCard.revised && <Badge variant="outline" className="text-[9px] h-4 px-1.5 border-violet-200 dark:border-violet-500/20 text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-500/10">Revised</Badge>}
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={() => { if (confirm("Delete this post?")) { deleteCard(selectedCard.id); closeDrawer(); } }} className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 text-gray-400 hover:text-red-500 transition-all duration-150" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
            <button onClick={closeDrawer} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-white/[0.06] text-gray-400 transition-all duration-150"><X className="w-4 h-4" /></button>
          </div>
        </div>

        {/* ─── Scrollable Body ─── */}
        <div className="flex-1 overflow-y-auto">

          {/* ══ SECTION 1: Post Identity ══ */}
          <div className="px-5 md:px-7 pt-5 md:pt-6 pb-4 md:pb-5 space-y-4">
            {/* Title */}
            <InlineEdit
              value={selectedCard.title}
              onSave={(v) => { updateCard(selectedCard.id, { title: v }); logAudit(selectedCard.id, currentUser.name, "title_edited", `Title changed to "${v}"`); }}
              placeholder="Add a title..."
              as="h2"
              className="text-[18px] font-bold text-slate-900 dark:text-white leading-snug tracking-tight"
              inputClassName="text-[18px] font-bold"
            />

            {/* Platforms */}
            <div className="flex flex-wrap gap-2">
              {selectedCard.platforms.map((p) => {
                const profile = SOCIAL_PROFILES[p];
                return (
                  <a key={p} href={profile?.url || "#"} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-50 dark:bg-white/[0.04] border border-gray-100 dark:border-white/[0.06] text-[11px] text-gray-600 dark:text-gray-300 hover:border-orange-200 dark:hover:border-orange-500/20 hover:bg-orange-50/50 dark:hover:bg-orange-500/5 transition-all duration-150">
                    <PlatformIcon platform={p} className="w-3.5 h-3.5" />
                    <span className="capitalize font-medium">{p}</span>
                    {profile?.url && <ExternalLink className="w-2.5 h-2.5 text-gray-400" />}
                  </a>
                );
              })}
            </div>

            {/* Schedule — premium inline element */}
            <div className="bg-slate-50 dark:bg-white/[0.03] rounded-xl border border-gray-100 dark:border-white/[0.06] px-4 py-3">
              {dateEditing ? (
                <div className="flex gap-2 items-center">
                  <Input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} className="h-9 flex-1 bg-white dark:bg-white/[0.04] border-orange-300 dark:border-orange-500/40 rounded-lg text-[12px] ring-2 ring-orange-100 dark:ring-orange-500/20" autoFocus />
                  <Input type="time" value={editTime} onChange={(e) => setEditTime(e.target.value)} className="h-9 w-28 bg-white dark:bg-white/[0.04] border-orange-300 dark:border-orange-500/40 rounded-lg text-[12px] ring-2 ring-orange-100 dark:ring-orange-500/20" />
                  <Button size="sm" onClick={saveDate} className="h-9 px-3 rounded-lg bg-orange-600 hover:bg-orange-700 text-white text-[11px]"><Save className="w-3 h-3" /></Button>
                  <button onClick={() => setDateEditing(false)} className="text-gray-400 hover:text-gray-600 cursor-pointer"><X className="w-4 h-4" /></button>
                </div>
              ) : (
                <button onClick={() => { setEditDate(selectedCard.scheduledDate || ""); setEditTime(selectedCard.scheduledTime || ""); setDateEditing(true); }}
                  className="w-full flex items-center gap-2 text-left cursor-pointer group">
                  <div className="w-8 h-8 rounded-lg bg-white dark:bg-white/[0.06] border border-gray-200 dark:border-white/[0.06] flex items-center justify-center shrink-0">
                    <Calendar className="w-4 h-4 text-orange-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    {selectedCard.scheduledDate ? (
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-medium text-slate-800 dark:text-gray-200">
                          {new Date(selectedCard.scheduledDate).toLocaleDateString("en-US", { weekday: "short", month: "long", day: "numeric", year: "numeric" })}
                        </span>
                        {selectedCard.scheduledTime && (
                          <span className="text-[12px] text-gray-500 dark:text-gray-400 flex items-center gap-1 border-l border-gray-200 dark:border-white/[0.08] pl-2">
                            <Clock className="w-3 h-3" />{selectedCard.scheduledTime}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-[13px] text-orange-500 font-medium">Set date & time</span>
                    )}
                    <p className="text-[10px] text-gray-400 mt-0.5">Click to edit schedule</p>
                  </div>
                  <Pencil className="w-3.5 h-3.5 text-gray-300 group-hover:text-gray-500 transition-colors shrink-0" />
                </button>
              )}
            </div>
          </div>

          {/* ══ SECTION 2: Media Hero ══ */}
          <div className="px-5 md:px-7 pb-4 md:pb-5 space-y-3">
            <div className="relative w-full rounded-2xl overflow-hidden bg-gray-50 dark:bg-white/[0.03] group shadow-sm">
              {(selectedCard.contentType === "video" || selectedCard.contentType === "reel") ? (
                <video src={selectedCard.thumbnailUrl} controls poster={selectedCard.thumbnailUrl} className="w-full aspect-video rounded-2xl bg-black object-contain" />
              ) : (
                <img src={selectedCard.thumbnailUrl} alt={selectedCard.title} className="w-full aspect-video object-cover transition-transform duration-300 group-hover:scale-[1.02]" />
              )}
              <div className="absolute top-3 left-3 px-2.5 py-1 rounded-lg bg-black/50 backdrop-blur-sm text-[10px] text-white font-semibold capitalize tracking-wide">{selectedCard.contentType}</div>
              <input ref={assetInputRef} type="file" accept="image/*,video/*" onChange={handleAssetReplace} className="hidden" />
              <button onClick={() => assetInputRef.current?.click()} className="absolute bottom-3 right-3 flex items-center gap-1.5 px-3 py-2 rounded-lg bg-black/60 backdrop-blur-sm text-white text-[10px] font-medium opacity-0 group-hover:opacity-100 transition-opacity duration-200 hover:bg-black/80 cursor-pointer">
                <Upload className="w-3 h-3" />Replace Asset
              </button>
            </div>

            {selectedCard.contentType === "carousel" && (
              <div className="flex gap-2 overflow-x-auto pb-1">
                <div className="w-16 h-16 rounded-lg overflow-hidden border-2 border-orange-500 shrink-0"><img src={selectedCard.thumbnailUrl} alt="Slide 1" className="w-full h-full object-cover" /></div>
                {[2, 3, 4].map((n) => (
                  <div key={n} className="w-16 h-16 rounded-lg border-2 border-dashed border-gray-200 dark:border-white/[0.08] flex items-center justify-center shrink-0 text-gray-300 dark:text-gray-600 hover:border-orange-300 dark:hover:border-orange-500/30 transition-colors cursor-pointer">
                    <span className="text-[9px] font-medium">Slide {n}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Dropzone */}
            <input ref={rawFileInputRef} type="file" accept="image/*,video/*" multiple onChange={handleRawFileUpload} className="hidden" />
            <button onClick={() => rawFileInputRef.current?.click()} className="w-full border-2 border-dashed border-gray-200/80 dark:border-white/[0.05] rounded-xl py-4 flex items-center justify-center gap-2.5 text-gray-350 dark:text-gray-500 hover:text-gray-500 hover:border-gray-300 dark:hover:border-white/[0.1] transition-all duration-200 cursor-pointer">
              <Upload className="w-3.5 h-3.5 text-gray-300 dark:text-gray-600" />
              <span className="text-[11px] text-gray-400 dark:text-gray-500">Upload additional files or carousel slides</span>
            </button>
          </div>

          {/* ══ TAB BAR ══ */}
          <div className="flex items-center gap-0.5 px-5 md:px-7 mx-4 md:mx-7 mb-2 mt-2 border-b border-gray-100 dark:border-white/[0.06]">
            {([
              { id: "content" as DrawerTab, label: "Content", icon: <Type className="w-3 h-3" /> },
              { id: "vault" as DrawerTab, label: "Source Vault", icon: <FolderOpen className="w-3 h-3" /> },
              { id: "audit" as DrawerTab, label: "Audit Trail", icon: <History className="w-3 h-3" /> },
            ]).map((tab) => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-[11px] font-semibold border-b-2 -mb-px transition-colors cursor-pointer ${activeTab === tab.id ? "border-orange-500 text-orange-700 dark:text-orange-400" : "border-transparent text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"}`}>
                {tab.icon}{tab.label}
              </button>
            ))}
          </div>

          {/* ══ TAB CONTENT ══ */}
          <div className="px-5 md:px-7 py-5 md:py-6 space-y-6 md:space-y-7">

            {/* ──── TAB 1: CONTENT ──── */}
            {activeTab === "content" && (
              <>
                {/* Hook — containerized card */}
                <div className="bg-slate-50/70 dark:bg-white/[0.02] rounded-xl border border-gray-100 dark:border-white/[0.05] p-5">
                  <label className="text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center gap-1.5 mb-3"><Hash className="w-3.5 h-3.5 text-orange-400" />Hook / First 3 Seconds</label>
                  <InlineEdit
                    value={selectedCard.hook || ""}
                    onSave={(v) => { updateCard(selectedCard.id, { hook: v || undefined }); logAudit(selectedCard.id, currentUser.name, "content_edited", "Updated hook"); }}
                    placeholder="Click to add a hook..."
                    className="text-[14px] text-gray-700 dark:text-gray-300 italic leading-relaxed"
                    inputClassName="text-[14px] italic"
                  />
                </div>

                {/* Caption — containerized card */}
                <div className="bg-slate-50/70 dark:bg-white/[0.02] rounded-xl border border-gray-100 dark:border-white/[0.05] p-5">
                  <label className="text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center gap-1.5 mb-3"><Type className="w-3.5 h-3.5 text-orange-400" />Caption</label>
                  <InlineEdit
                    value={selectedCard.caption || ""}
                    onSave={(v) => { updateCard(selectedCard.id, { caption: v || undefined }); logAudit(selectedCard.id, currentUser.name, "content_edited", "Updated caption"); }}
                    placeholder="Click to write a caption..."
                    multiline
                    className="text-[14px] text-gray-700 dark:text-gray-300 leading-[1.7] whitespace-pre-wrap"
                    inputClassName="text-[14px] leading-[1.7]"
                  />
                </div>

                {/* Notes & Comments */}
                <div className="space-y-3">
                  <label className="text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center gap-1.5"><MessageSquare className="w-3.5 h-3.5 text-orange-400" />Notes & Comments</label>
                  {noteLines.length > 0 && (
                    <div className="space-y-2">
                      {noteLines.map((note, i) => {
                        const closingMatch = note.match(/^(.+?)\s*\(([^)]+)\):\s*([\s\S]+)$/);
                        const hasAuthor = !!closingMatch;
                        const author = hasAuthor ? closingMatch![1].trim() : null;
                        const timestamp = hasAuthor ? closingMatch![2] : null;
                        const content = hasAuthor ? closingMatch![3].trim() : note;
                        const isRevisionNote = author === "Revision Note";
                        const displayAuthor = isRevisionNote ? "Aldridge Dagos" : author;
                        const initials = displayAuthor ? displayAuthor.split(" ").map((n) => n[0]).join("").slice(0, 2) : "??";
                        return (
                          <div key={i} className="flex gap-2.5 group">
                            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[8px] font-bold text-white shrink-0 mt-0.5 ${isRevisionNote ? "bg-gradient-to-br from-violet-500 to-purple-600" : "bg-gradient-to-br from-amber-400 to-orange-500"}`}>{initials}</div>
                            <div className={`flex-1 min-w-0 rounded-xl px-3 py-2 border ${isRevisionNote ? "bg-violet-50 dark:bg-violet-500/5 border-violet-200/40 dark:border-violet-500/10" : "bg-amber-50 dark:bg-amber-500/5 border-amber-200/40 dark:border-amber-500/10"}`}>
                              {displayAuthor && (
                                <div className="flex items-center gap-2 mb-0.5">
                                  <span className={`text-[11px] font-semibold ${isRevisionNote ? "text-violet-800 dark:text-violet-300" : "text-amber-800 dark:text-amber-300"}`}>{displayAuthor}</span>
                                  {isRevisionNote && <span className="text-[8px] font-bold uppercase tracking-wider bg-violet-200 dark:bg-violet-500/20 text-violet-700 dark:text-violet-300 px-1.5 py-0.5 rounded-full">Revision</span>}
                                  {timestamp && <span className={`text-[9px] ${isRevisionNote ? "text-violet-600/60 dark:text-violet-400/40" : "text-amber-600/60 dark:text-amber-400/40"}`}>{timestamp}</span>}
                                </div>
                              )}
                              <p className={`text-[12px] leading-relaxed ${isRevisionNote ? "text-violet-900 dark:text-violet-200" : "text-amber-900 dark:text-amber-200"}`}>{content}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {/* New comment */}
                  <div className="flex gap-2 items-start">
                    {currentUser.avatar ? (
                      <img src={currentUser.avatar} alt={currentUser.name} className="w-7 h-7 rounded-full object-cover shrink-0 mt-0.5" />
                    ) : (
                      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-[8px] font-bold text-white shrink-0 mt-0.5">{currentUser.initials}</div>
                    )}
                    <div className="flex-1 relative">
                      <MentionTextarea value={newComment} onChange={setNewComment} placeholder="Write a comment or note..." className="w-full min-h-[36px] bg-gray-50 dark:bg-white/[0.03] border border-gray-200 dark:border-white/[0.08] rounded-xl px-3 py-2 pr-10 text-[12px] text-gray-800 dark:text-gray-200 placeholder:text-gray-400 outline-none focus:ring-2 focus:ring-blue-200 dark:focus:ring-blue-500/20 focus:border-blue-300 dark:focus:border-blue-500/30 resize-none transition-all duration-150" rows={1} />
                      <button onClick={addComment} disabled={!newComment.trim()} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-500/10 disabled:text-gray-300 dark:disabled:text-gray-600 disabled:hover:bg-transparent cursor-pointer transition-all duration-150"><Send className="w-4 h-4" /></button>
                    </div>
                  </div>
                </div>

                {/* Checklist — containerized */}
                <div className="bg-slate-50/70 dark:bg-white/[0.02] rounded-xl border border-gray-100 dark:border-white/[0.05] p-5">
                  <div className="flex items-center justify-between mb-3">
                    <label className="text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5 text-orange-400" />Pre-Submit Checklist</label>
                    <span className={`text-[12px] font-bold tabular-nums ${allChecked ? "text-emerald-600" : "text-gray-400"}`}>{checkedCount}/{totalChecklist}</span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-gray-200/60 dark:bg-white/[0.06] overflow-hidden mb-3">
                    <div className="h-full rounded-full bg-gradient-to-r from-orange-500 to-yellow-500 transition-all duration-300" style={{ width: `${(checkedCount / totalChecklist) * 100}%` }} />
                  </div>
                  <div className="space-y-1">
                    {selectedCard.checklist.map((item) => (
                      <label key={item.id} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-white dark:hover:bg-white/[0.03] cursor-pointer transition-all duration-150">
                        <Checkbox checked={item.checked} onCheckedChange={() => toggleChecklistItem(item.id)} className="border-gray-300 dark:border-gray-600 data-[state=checked]:bg-orange-500 data-[state=checked]:border-orange-500 transition-all duration-150" />
                        <span className={`text-[13px] transition-all duration-150 leading-snug ${item.checked ? "text-gray-300 dark:text-gray-600 line-through" : "text-gray-700 dark:text-gray-300"}`}>{item.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* ──── TAB 2: SOURCE VAULT ──── */}
            {activeTab === "vault" && (
              <>
                <div className="space-y-4">
                  {/* Design Link */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-[0.08em] flex items-center gap-1.5"><Link2 className="w-3 h-3 text-blue-500" />Design Link <span className="text-[9px] font-normal normal-case text-gray-400">(Canva / Figma)</span></label>
                    <div className="flex gap-2">
                      <Input value={designLink} onChange={(e) => setDesignLink(e.target.value)} placeholder="https://www.canva.com/design/..." className="flex-1 h-9 bg-gray-50 dark:bg-white/[0.03] border-gray-200 dark:border-white/[0.08] rounded-lg text-[12px]" />
                      {designLink && <a href={designLink} target="_blank" rel="noopener noreferrer" className="h-9 px-3 flex items-center rounded-lg bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 text-[11px] hover:bg-blue-100 dark:hover:bg-blue-500/20 transition-colors border border-blue-200 dark:border-blue-500/20"><ExtLink className="w-3 h-3" /></a>}
                    </div>
                  </div>

                  {/* Drive Folder */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-[0.08em] flex items-center gap-1.5"><FolderOpen className="w-3 h-3 text-amber-500" />Drive / Folder Link</label>
                    <div className="flex gap-2">
                      <Input value={driveFolder} onChange={(e) => setDriveFolder(e.target.value)} placeholder="https://drive.google.com/drive/folders/..." className="flex-1 h-9 bg-gray-50 dark:bg-white/[0.03] border-gray-200 dark:border-white/[0.08] rounded-lg text-[12px]" />
                      {driveFolder && <a href={driveFolder} target="_blank" rel="noopener noreferrer" className="h-9 px-3 flex items-center rounded-lg bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[11px] hover:bg-amber-100 dark:hover:bg-amber-500/20 transition-colors border border-amber-200 dark:border-amber-500/20"><ExtLink className="w-3 h-3" /></a>}
                    </div>
                  </div>

                  {/* Save links button */}
                  <Button onClick={saveVault} disabled={vaultSaving} size="sm" className="w-full h-9 rounded-lg bg-gray-900 dark:bg-white dark:text-gray-900 hover:bg-gray-800 text-white text-[12px] font-medium">
                    <Save className="w-3.5 h-3.5 mr-1.5" />{vaultSaving ? "Saving..." : "Save Links"}
                  </Button>
                </div>

                <Separator className="bg-gray-100 dark:bg-white/[0.06]" />

                {/* Raw Files */}
                <div className="space-y-3">
                  <label className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-[0.08em] flex items-center gap-1.5"><Paperclip className="w-3 h-3 text-violet-500" />Raw Project Files</label>

                  <input ref={rawFileInputRef} type="file" onChange={handleRawFileUpload} className="hidden" />
                  <button onClick={() => rawFileInputRef.current?.click()} className="w-full border-2 border-dashed border-gray-200 dark:border-white/[0.08] rounded-xl py-5 flex flex-col items-center gap-1.5 text-gray-400 hover:text-gray-500 hover:border-gray-300 dark:hover:border-white/[0.15] transition-colors cursor-pointer">
                    <Upload className="w-5 h-5" />
                    <span className="text-[11px]">Upload .prproj, .zip, .psd, or any project file</span>
                  </button>

                  {/* Uploaded files list */}
                  {(selectedCard.sourceVault?.rawFiles || []).length > 0 && (
                    <div className="space-y-1.5">
                      {selectedCard.sourceVault!.rawFiles!.map((file, i) => (
                        <div key={i} className="flex items-center gap-3 px-3 py-2.5 bg-gray-50 dark:bg-white/[0.03] rounded-xl border border-gray-200 dark:border-white/[0.06]">
                          <FileText className="w-4 h-4 text-violet-500 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-[12px] font-medium text-gray-700 dark:text-gray-300 truncate">{file.name}</p>
                            <p className="text-[9px] text-gray-400">{new Date(file.uploadedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</p>
                          </div>
                          <a href={file.url} target="_blank" rel="noopener noreferrer" className="p-1.5 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-500/10 text-gray-400 hover:text-blue-500 transition-colors"><ExtLink className="w-3.5 h-3.5" /></a>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}

            {/* ──── TAB 3: AUDIT TRAIL ──── */}
            {activeTab === "audit" && (
              <>
                {auditLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="w-5 h-5 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
                  </div>
                ) : auditLogs.length === 0 ? (
                  <div className="text-center py-12">
                    <History className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
                    <p className="text-[13px] text-gray-400">No audit history yet</p>
                    <p className="text-[11px] text-gray-300 dark:text-gray-600 mt-1">Actions on this card will appear here</p>
                  </div>
                ) : (
                  <div className="relative">
                    {/* Timeline line */}
                    <div className="absolute left-[13px] top-2 bottom-2 w-px bg-gray-200 dark:bg-white/[0.06]" />
                    <div className="space-y-0">
                      {auditLogs.map((entry) => {
                        const date = new Date(entry.created_at);
                        const timeStr = date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
                        const actionColors: Record<string, string> = {
                          stage_change: "bg-blue-500",
                          revision_submitted: "bg-violet-500",
                          revision_requested: "bg-red-500",
                          content_edited: "bg-amber-500",
                          asset_replaced: "bg-emerald-500",
                          card_viewed: "bg-gray-400",
                          comment_added: "bg-orange-500",
                          vault_updated: "bg-sky-500",
                          raw_file_uploaded: "bg-purple-500",
                          title_edited: "bg-amber-500",
                        };
                        const dotColor = actionColors[entry.action_type] || "bg-gray-400";
                        const actionLabels: Record<string, string> = {
                          stage_change: "Stage Changed",
                          revision_submitted: "Fix Submitted",
                          revision_requested: "Revision Requested",
                          content_edited: "Content Edited",
                          asset_replaced: "Asset Replaced",
                          card_viewed: "Viewed",
                          comment_added: "Comment Added",
                          vault_updated: "Vault Updated",
                          raw_file_uploaded: "File Uploaded",
                          title_edited: "Title Edited",
                        };
                        return (
                          <div key={entry.id} className="relative flex gap-3 pb-4 pl-1">
                            <div className={`w-[10px] h-[10px] rounded-full ${dotColor} shrink-0 mt-1.5 z-10 ring-2 ring-white dark:ring-[#111]`} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-[11px] font-semibold text-gray-800 dark:text-gray-200">{entry.user_name}</span>
                                <span className="text-[9px] text-gray-400">{timeStr}</span>
                              </div>
                              <p className="text-[10px] font-medium text-gray-500 dark:text-gray-400 mt-0.5">{actionLabels[entry.action_type] || entry.action_type}</p>
                              {entry.details && <p className="text-[11px] text-gray-600 dark:text-gray-400 mt-0.5 leading-relaxed">{entry.details}</p>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* ─── Footer — context-aware actions ─── */}
        <div className="px-6 py-4 border-t border-gray-100 dark:border-white/[0.06] shrink-0 space-y-2.5 bg-white dark:bg-[#0e0e11]">
          {revisionMode && (
            <div className="space-y-2">
              <div className="bg-red-50 dark:bg-red-500/5 rounded-xl border border-red-200 dark:border-red-500/20 p-3 space-y-2">
                <p className="text-[11px] font-semibold text-red-700 dark:text-red-400">What needs to be changed?</p>
                <textarea value={revisionFeedback} onChange={(e) => setRevisionFeedback(e.target.value)} placeholder="e.g. Make the logo bigger, fix the audio..." className="w-full min-h-[60px] bg-white dark:bg-[#111] border border-red-200 dark:border-red-500/20 rounded-lg p-2.5 text-[12px] text-gray-800 dark:text-gray-200 placeholder:text-gray-400 outline-none focus:ring-2 focus:ring-red-300 dark:focus:ring-red-500/30 resize-none transition-all duration-150" autoFocus />
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => { setRevisionMode(false); setRevisionFeedback(""); }} className="flex-1 h-9 rounded-lg text-[12px]">Cancel</Button>
                <Button size="sm" disabled={!revisionFeedback.trim()} onClick={() => {
                  const ts = new Date().toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
                  const note = `${currentUser.name} (${ts}): ${revisionFeedback.trim()}`;
                  updateCard(selectedCard.id, { notes: (selectedCard.notes ? selectedCard.notes + "\n\n" : "") + note });
                  moveCard(selectedCard.id, "revision_needed");
                  addToast("Revision requested. Agency team notified.", "warning");
                  setRevisionMode(false); setRevisionFeedback("");
                }} className="flex-1 h-9 rounded-lg bg-red-600 hover:bg-red-700 text-white text-[12px] shadow-sm disabled:opacity-40 transition-all duration-150">
                  Submit Revision Request
                </Button>
              </div>
            </div>
          )}

          {!revisionMode && selectedCard.stage === "awaiting_approval" && (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setRevisionMode(true)} className="flex-1 h-9 rounded-lg border-red-200 text-red-600 hover:bg-red-50 dark:border-red-500/20 dark:text-red-400 dark:hover:bg-red-500/10 bg-white dark:bg-transparent text-[12px] transition-all duration-150">
                <ArrowRightLeft className="w-3.5 h-3.5 mr-1.5" />Request Revision
              </Button>
              <Button size="sm" onClick={() => { moveCard(selectedCard.id, "approved_scheduled"); addToast("Post approved and scheduled.", "success"); }}
                className="flex-1 h-9 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[12px] shadow-sm shadow-emerald-500/20 transition-all duration-150">
                <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />Approve Post
              </Button>
            </div>
          )}

          {!revisionMode && selectedCard.stage === "revision_needed" && (
            <div className="flex gap-2">
              <Button size="sm" onClick={() => { requestReapproval(selectedCard.id); }} className="flex-1 h-9 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-[12px] shadow-sm shadow-violet-500/20 transition-all duration-150">
                <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />Ready for Re-Approval
              </Button>
            </div>
          )}

          {!revisionMode && selectedCard.stage !== "awaiting_approval" && selectedCard.stage !== "revision_needed" && (
            <div className="flex gap-2">
              {selectedCard.stage !== "ideas" && selectedCard.stage !== "posted" && (
                <Button variant="outline" size="sm" onClick={() => setRevisionMode(true)} className="flex-1 h-9 rounded-lg border-red-200 text-red-600 hover:bg-red-50 dark:border-red-500/20 dark:text-red-400 bg-white dark:bg-transparent text-[12px] transition-all duration-150">
                  <ArrowRightLeft className="w-3.5 h-3.5 mr-1.5" />Revision
                </Button>
              )}
              {nextStage && nextColumn && selectedCard.stage !== "posted" && (
                <Button size="sm" onClick={() => {
                  moveCard(selectedCard.id, nextStage);
                  addToast(nextStage === "awaiting_approval" ? `Notification & Email dispatched to ${currentUser.name} — Post sent for approval` : `Post moved to ${nextColumn.title}`, nextStage === "awaiting_approval" ? "success" : "info");
                }} className="flex-1 h-9 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white text-[12px] shadow-sm transition-all duration-150">
                  Move to {nextColumn.title}<ChevronRight className="w-3.5 h-3.5 ml-1" />
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
