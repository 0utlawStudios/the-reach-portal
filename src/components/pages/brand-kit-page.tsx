"use client";

import { useState, useEffect, useCallback } from "react";
import { CopyBlock, ColorSwatch } from "@/components/copy-block";
import { useToast } from "@/lib/toast-context";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabaseClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Hash, Type, Palette, Shield, Download, Megaphone, Phone, Globe, Mail,
  CheckCircle, XCircle, Star, Award, Eye, Pencil, Save, X,
  Clock, Zap, Video, Sparkles, Target, ArrowRight, Layers, BookOpen,
} from "lucide-react";

type Tab = "copy" | "strategy" | "visual" | "guardrails";

interface PlaybookData {
  phone: string;
  website: string;
  tagline: string;
  serviceArea: string;
  hashtagCore: string;
  hashtagSeasonal: string;
  hashtagEngagement: string;
  hashtagCommercial: string;
  hooks: string[];
  ctas: string[];
  whenToPost: string;
  contentPillars: { title: string; desc: string }[];
  brandVoice: string;
}

const DEFAULT_DATA: PlaybookData = {
  phone: "+1 615-258-6179",
  website: "ten80ten.com",
  tagline: "Empower your core, delegate the chore!",
  serviceArea: "Global Remote Talent — Headquartered in Nashville, TN",
  hashtagCore: "#Ten80Ten #VirtualAssistant #Delegate #RemoteTeam #BusinessGrowth",
  hashtagSeasonal: "#Q4Planning #ScaleSmart #FutureProofYourBusiness",
  hashtagEngagement: "#TeamEfficiency #LeadershipStrategy #OperationalClarity #ThinkBigger #LeadershipClarity",
  hashtagCommercial: "#BusinessExpansion #StartupScaling #CostEffectiveGrowth #B2B",
  hooks: [
    "Overwhelm isn't always about workload. It's often about unclear priorities.",
    "If execution was predictable, where would your focus go?",
    "Empower your core, delegate the chore! Here's how the 10/80/10 framework works.",
    "Your competitors are already tapping into the global talent pool — don't get left behind.",
  ],
  ctas: [
    "Book a discovery call today at ten80ten.com",
    "Ready to reclaim your time? DM us to learn about the 10/80/10 framework.",
    "Email us at hello@ten80ten.com to build your remote dream team.",
  ],
  whenToPost: "Monday through Friday mornings — B2B prime time. Focus heavily on LinkedIn for agency outreach and decision-maker engagement. Use Instagram for brand culture, team spotlights, and behind-the-scenes content.",
  contentPillars: [
    { title: "The 10/80/10 Framework", desc: "Educate the audience on the core model: 10% Planning, 80% Execution (the VA handles this), and 10% Optimization. Position it as the operating system for scaling without burnout." },
    { title: "Leadership & Strategy", desc: "Free up founder time. 'Structure reduces stress.' Focus on the psychological relief of delegation — show overwhelmed CEOs what life looks like on the other side." },
    { title: "Cost-Effective Scaling", desc: "Highlight how businesses can hire top-tier global talent for up to 70% less than local hires — without cutting corners on quality, communication, or reliability." },
  ],
  brandVoice: "Professional, empowering, and highly structured. We speak directly to overwhelmed founders and CEOs. We do not sound like a cheap outsourcing farm — we sound like strategic growth partners. Our tone is authoritative yet supportive, focused on reducing overwhelm through systems, frameworks, and world-class remote talent.",
};

const useSupabase = !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

export function BrandKitPage() {
  const { addToast } = useToast();
  const { currentUser } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>("copy");
  const [data, setData] = useState<PlaybookData>(DEFAULT_DATA);
  const [editMode, setEditMode] = useState(false);
  const [editData, setEditData] = useState<PlaybookData>(DEFAULT_DATA);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!useSupabase) return;
    supabase.from("brand_playbook").select("data").eq("id", "singleton").single().then(({ data: row }) => {
      if (row?.data) setData(row.data as PlaybookData);
    });
  }, []);

  useEffect(() => {
    if (!useSupabase) return;
    const channel = supabase
      .channel("brand-playbook-realtime")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "brand_playbook" }, (payload) => {
        if (payload.new?.data) {
          setData(payload.new.data as PlaybookData);
          if (!editMode) addToast("Brand playbook updated by another user", "info");
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [editMode]);

  const startEdit = () => { setEditData({ ...data }); setEditMode(true); };
  const cancelEdit = () => { setEditMode(false); };

  const saveEdit = async () => {
    setSaving(true);
    setData(editData);
    if (useSupabase) {
      await supabase.from("brand_playbook").update({ data: editData, updated_by: currentUser.name }).eq("id", "singleton");
    }
    setSaving(false);
    setEditMode(false);
    addToast("Playbook saved and synced to all devices", "success");
  };

  const d = editMode ? editData : data;
  const updateField = (key: keyof PlaybookData, value: any) => setEditData((prev) => ({ ...prev, [key]: value }));
  const updateHook = (i: number, value: string) => setEditData((prev) => ({ ...prev, hooks: prev.hooks.map((h, idx) => idx === i ? value : h) }));
  const updateCta = (i: number, value: string) => setEditData((prev) => ({ ...prev, ctas: prev.ctas.map((c, idx) => idx === i ? value : c) }));
  const updatePillar = (i: number, key: "title" | "desc", value: string) => setEditData((prev) => ({ ...prev, contentPillars: prev.contentPillars.map((p, idx) => idx === i ? { ...p, [key]: value } : p) }));

  const TABS = [
    { id: "copy" as Tab, label: "Copy Hub", icon: <Megaphone className="w-3.5 h-3.5" /> },
    { id: "strategy" as Tab, label: "Strategy", icon: <Target className="w-3.5 h-3.5" /> },
    { id: "visual" as Tab, label: "Identity", icon: <Palette className="w-3.5 h-3.5" /> },
    { id: "guardrails" as Tab, label: "Guardrails", icon: <Shield className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="w-full h-full overflow-y-auto">
      {/* ─── Hero Header with subtle gradient ─── */}
      <div className="relative px-8 pt-8 pb-0">
        <div className="absolute inset-0 bg-gradient-to-b from-orange-50/40 via-transparent to-transparent dark:from-orange-500/[0.03] dark:via-transparent pointer-events-none" />
        <div className="relative flex items-start justify-between mb-2">
          <div>
            <div className="flex items-center gap-3 mb-1.5">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-orange-500 to-yellow-600 flex items-center justify-center shadow-lg shadow-orange-500/20">
                <BookOpen className="w-4.5 h-4.5 text-white" />
              </div>
              <h1 className="text-[24px] font-extrabold text-slate-900 dark:text-white tracking-[-0.04em]">Brand Playbook</h1>
            </div>
            <p className="text-[13px] text-gray-400 ml-[48px]">Copy-ready assets, content strategy, and brand guidelines for Ten80Ten.</p>
          </div>
          {!editMode ? (
            <Button onClick={startEdit} className="h-9 rounded-lg bg-slate-900 dark:bg-white dark:text-slate-900 hover:bg-slate-800 text-white text-[12px] font-medium cursor-pointer shrink-0">
              <Pencil className="w-3.5 h-3.5 mr-1.5" />Edit Playbook
            </Button>
          ) : (
            <div className="flex gap-2 shrink-0">
              <Button variant="outline" onClick={cancelEdit} className="h-9 rounded-lg text-[12px] cursor-pointer"><X className="w-3.5 h-3.5 mr-1" />Cancel</Button>
              <Button onClick={saveEdit} disabled={saving} className="h-9 rounded-lg bg-orange-600 hover:bg-orange-700 text-white text-[12px] font-medium cursor-pointer shadow-sm shadow-orange-500/20">
                <Save className="w-3.5 h-3.5 mr-1.5" />{saving ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          )}
        </div>

        {editMode && (
          <div className="relative mt-4 bg-orange-50 dark:bg-orange-500/5 border border-orange-200 dark:border-orange-500/20 rounded-xl px-4 py-2.5 flex items-center gap-2">
            <Pencil className="w-4 h-4 text-orange-600 dark:text-orange-400 shrink-0" />
            <p className="text-[12px] text-orange-800 dark:text-orange-300">Edit mode active — changes sync to all devices when saved.</p>
          </div>
        )}

        {/* ─── Tab Navigation ─── */}
        <div className="relative flex items-center gap-0.5 mt-6 border-b border-gray-200 dark:border-white/[0.06]">
          {TABS.map((tab) => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-5 py-3 text-[12px] font-semibold border-b-2 -mb-px transition-all duration-150 cursor-pointer ${activeTab === tab.id ? "border-orange-500 text-orange-700 dark:text-orange-400" : "border-transparent text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"}`}>
              {tab.icon}{tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* ─── Tab Content ─── */}
      <div className="px-8 py-8">

        {/* ═══════════════ TAB 1: COPY HUB ═══════════════ */}
        {activeTab === "copy" && (
          <div className="space-y-12 max-w-3xl mx-auto">

            <Section icon={<Phone className="w-4 h-4 text-orange-500" />} title="Business Essentials" sub="Core contact information — click any field to copy">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {editMode ? (
                  <>
                    <EditField label="Phone" value={editData.phone} onChange={(v) => updateField("phone", v)} />
                    <EditField label="Website" value={editData.website} onChange={(v) => updateField("website", v)} />
                    <EditField label="Tagline" value={editData.tagline} onChange={(v) => updateField("tagline", v)} />
                    <EditField label="Service Area" value={editData.serviceArea} onChange={(v) => updateField("serviceArea", v)} />
                  </>
                ) : (
                  <>
                    <CopyBlock label="Phone" text={d.phone} />
                    <CopyBlock label="Website" text={d.website} />
                    <CopyBlock label="Email" text="hello@ten80ten.com" />
                    <CopyBlock label="Service Area" text={d.serviceArea} />
                    <div className="sm:col-span-2">
                      <CopyBlock label="Tagline" text={d.tagline} />
                    </div>
                  </>
                )}
              </div>
            </Section>

            <Section icon={<Hash className="w-4 h-4 text-yellow-600" />} title="Hashtag Banks" sub="Click any block to copy the full set">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {(["hashtagCore", "hashtagSeasonal", "hashtagEngagement", "hashtagCommercial"] as const).map((key) => {
                  const config: Record<string, { label: string; accent: string }> = {
                    hashtagCore: { label: "Core / Brand", accent: "border-l-orange-500" },
                    hashtagSeasonal: { label: "Seasonal / Promo", accent: "border-l-yellow-500" },
                    hashtagEngagement: { label: "Engagement / Reach", accent: "border-l-orange-400" },
                    hashtagCommercial: { label: "Commercial / B2B", accent: "border-l-yellow-600" },
                  };
                  const { label, accent } = config[key];
                  return editMode ? (
                    <EditField key={key} label={label} value={editData[key]} onChange={(v) => updateField(key, v)} multiline />
                  ) : (
                    <div key={key} className={`border-l-[3px] ${accent} pl-0`}>
                      <CopyBlock label={label} text={d[key]} mono />
                    </div>
                  );
                })}
              </div>
            </Section>

            <Section icon={<Zap className="w-4 h-4 text-orange-500" />} title="Proven Hooks" sub="High-performing opening lines — click to copy">
              <div className="space-y-3">
                {d.hooks.map((hook, i) => editMode ? (
                  <EditField key={i} value={editData.hooks[i]} onChange={(v) => updateHook(i, v)} />
                ) : (
                  <div key={i} className="flex gap-3 items-start">
                    <div className="w-7 h-7 rounded-lg bg-orange-100 dark:bg-orange-500/10 flex items-center justify-center text-[11px] font-bold text-orange-700 dark:text-orange-400 shrink-0 mt-0.5">{i + 1}</div>
                    <div className="flex-1"><CopyBlock text={hook} /></div>
                  </div>
                ))}
              </div>
            </Section>

            <Section icon={<Megaphone className="w-4 h-4 text-yellow-600" />} title="Standard CTAs" sub="Close every post with one of these">
              <div className="space-y-3">
                {d.ctas.map((cta, i) => editMode ? (
                  <EditField key={i} value={editData.ctas[i]} onChange={(v) => updateCta(i, v)} multiline />
                ) : (
                  <div key={i} className="flex gap-3 items-start">
                    <div className="w-7 h-7 rounded-lg bg-yellow-100 dark:bg-yellow-500/10 flex items-center justify-center text-[11px] font-bold text-yellow-700 dark:text-yellow-400 shrink-0 mt-0.5">{i + 1}</div>
                    <div className="flex-1"><CopyBlock text={cta} /></div>
                  </div>
                ))}
              </div>
            </Section>
          </div>
        )}

        {/* ═══════════════ TAB 2: STRATEGY ═══════════════ */}
        {activeTab === "strategy" && (
          <div className="space-y-12 max-w-3xl mx-auto">

            <Section icon={<Clock className="w-4 h-4 text-orange-500" />} title="Posting Schedule" sub="When and where to publish">
              {editMode ? (
                <EditField value={editData.whenToPost} onChange={(v) => updateField("whenToPost", v)} multiline />
              ) : (
                <div className="bg-white dark:bg-[#151518] rounded-2xl border border-gray-200 dark:border-white/[0.06] overflow-hidden shadow-sm">
                  <div className="p-7">
                    <p className="text-[14px] text-gray-700 dark:text-gray-300 leading-[1.8]">{d.whenToPost}</p>
                  </div>
                  <div className="border-t border-gray-100 dark:border-white/[0.06] px-7 py-3.5 bg-slate-50/50 dark:bg-white/[0.02] flex items-center gap-6">
                    <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-orange-500" /><span className="text-[11px] text-gray-500 dark:text-gray-400">Mon – Fri mornings</span></div>
                    <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-sky-500" /><span className="text-[11px] text-gray-500 dark:text-gray-400">LinkedIn primary</span></div>
                    <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-pink-500" /><span className="text-[11px] text-gray-500 dark:text-gray-400">Instagram culture</span></div>
                  </div>
                </div>
              )}
            </Section>

            <Section icon={<Layers className="w-4 h-4 text-orange-500" />} title="Content Pillars" sub="The three strategic themes that drive all content">
              <div className="space-y-4">
                {d.contentPillars.map((pillar, i) => (
                  <div key={i} className="bg-white dark:bg-[#151518] rounded-2xl border border-gray-200 dark:border-white/[0.06] overflow-hidden shadow-sm hover:shadow-md transition-all duration-200">
                    {editMode ? (
                      <div className="p-7 space-y-3">
                        <Input value={editData.contentPillars[i]?.title || ""} onChange={(e) => updatePillar(i, "title", e.target.value)} className="h-10 text-[15px] font-semibold bg-gray-50 dark:bg-white/[0.04] border-gray-200 dark:border-white/[0.08] rounded-xl" />
                        <Textarea value={editData.contentPillars[i]?.desc || ""} onChange={(e) => updatePillar(i, "desc", e.target.value)} className="min-h-[80px] bg-gray-50 dark:bg-white/[0.04] border-gray-200 dark:border-white/[0.08] rounded-xl text-[13px] resize-none" />
                      </div>
                    ) : (
                      <div className="flex">
                        <div className="w-1.5 shrink-0 bg-gradient-to-b from-orange-500 to-yellow-600 rounded-l-2xl" />
                        <div className="p-7 flex-1">
                          <div className="flex items-center gap-3 mb-3">
                            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-orange-100 to-yellow-100 dark:from-orange-500/10 dark:to-yellow-500/10 flex items-center justify-center text-[12px] font-bold text-orange-700 dark:text-orange-400">{i + 1}</div>
                            <h3 className="text-[16px] font-bold text-slate-900 dark:text-white tracking-tight">{pillar.title}</h3>
                          </div>
                          <p className="text-[13px] text-gray-600 dark:text-gray-400 leading-[1.8] ml-[44px]">{pillar.desc}</p>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Section>

            <Section icon={<Award className="w-4 h-4 text-yellow-600" />} title="Brand Voice & Tone" sub="How Ten80Ten sounds across all platforms">
              {editMode ? (
                <EditField value={editData.brandVoice} onChange={(v) => updateField("brandVoice", v)} multiline />
              ) : (
                <div className="bg-white dark:bg-[#151518] rounded-2xl border border-gray-200 dark:border-white/[0.06] overflow-hidden shadow-sm">
                  <div className="flex">
                    <div className="w-1.5 shrink-0 bg-gradient-to-b from-yellow-500 to-orange-500 rounded-l-2xl" />
                    <div className="p-7">
                      <p className="text-[14px] text-gray-700 dark:text-gray-300 leading-[1.8]">{d.brandVoice}</p>
                      <div className="flex flex-wrap gap-2 mt-5">
                        {["Professional", "Empowering", "Structured", "Authoritative", "Supportive"].map((trait) => (
                          <span key={trait} className="px-3 py-1 rounded-full bg-orange-50 dark:bg-orange-500/10 border border-orange-200/60 dark:border-orange-500/20 text-[10px] font-semibold text-orange-700 dark:text-orange-400 uppercase tracking-wider">{trait}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </Section>
          </div>
        )}

        {/* ═══════════════ TAB 3: VISUAL IDENTITY ═══════════════ */}
        {activeTab === "visual" && (
          <div className="space-y-12 max-w-3xl mx-auto">

            <Section icon={<Palette className="w-4 h-4 text-orange-500" />} title="Color Palette" sub="Click any swatch to copy the hex code">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
                <ColorSwatch name="Ten80Ten Orange" hex="#ea580c" desc="Primary action, highlights" role="Primary" />
                <ColorSwatch name="Structural Gold" hex="#ca8a04" desc="Premium accents, CTAs" role="Secondary" />
                <ColorSwatch name="Midnight Slate" hex="#0f172a" desc="Headings, dark surfaces" role="Foundation" />
                <ColorSwatch name="Crisp Base" hex="#f8fafc" desc="Backgrounds, cards" role="Surface" />
                <ColorSwatch name="Warm Ember" hex="#c2410c" desc="Hover states, emphasis" role="Accent" />
                <ColorSwatch name="Muted Gold" hex="#a16207" desc="Subtle premium touches" role="Accent" />
                <ColorSwatch name="Signal Green" hex="#16a34a" desc="Approvals, success" role="Semantic" />
                <ColorSwatch name="Alert Red" hex="#dc2626" desc="Warnings, kickbacks" role="Semantic" />
              </div>
            </Section>

            <Section icon={<Type className="w-4 h-4 text-yellow-600" />} title="Typography" sub="Inter — system font across all platforms">
              <div className="bg-white dark:bg-[#151518] rounded-2xl border border-gray-200 dark:border-white/[0.06] overflow-hidden shadow-sm">
                <div className="p-8 space-y-8">
                  <div>
                    <p className="text-[9px] font-bold text-orange-500/60 uppercase tracking-[0.15em] mb-3">H1 — Hero / Page Titles</p>
                    <p className="text-[32px] font-extrabold text-slate-900 dark:text-white tracking-tight leading-[1.1]">Empower Your Core,<br />Delegate the Chore</p>
                  </div>
                  <hr className="border-gray-100 dark:border-white/[0.06]" />
                  <div>
                    <p className="text-[9px] font-bold text-orange-500/60 uppercase tracking-[0.15em] mb-3">H2 — Section Headers</p>
                    <p className="text-[22px] font-bold text-slate-800 dark:text-gray-200 tracking-tight">Strategic Virtual Talent for Scaling Businesses</p>
                  </div>
                  <hr className="border-gray-100 dark:border-white/[0.06]" />
                  <div>
                    <p className="text-[9px] font-bold text-orange-500/60 uppercase tracking-[0.15em] mb-3">Body — Paragraphs</p>
                    <p className="text-[15px] text-gray-600 dark:text-gray-400 leading-[1.8]">Ten80Ten connects overwhelmed founders with world-class remote talent through the 10/80/10 framework — so you can focus on the 20% that moves the needle while we handle the rest.</p>
                  </div>
                  <hr className="border-gray-100 dark:border-white/[0.06]" />
                  <div>
                    <p className="text-[9px] font-bold text-orange-500/60 uppercase tracking-[0.15em] mb-3">Caption — Social Copy</p>
                    <p className="text-[14px] text-gray-500 dark:text-gray-500 leading-relaxed italic">"Structure reduces stress. Delegation creates freedom. That's the 10/80/10 way."</p>
                  </div>
                </div>
              </div>
            </Section>

            <Section icon={<Download className="w-4 h-4 text-orange-500" />} title="Logo Assets" sub="Approved logo variants for all applications">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                {[
                  { name: "Primary Logo", desc: "Full color — light backgrounds", bg: "bg-white border border-gray-200 dark:border-white/[0.06]" },
                  { name: "Light Logo", desc: "Inverted — dark backgrounds", bg: "bg-slate-900 dark:bg-slate-800" },
                  { name: "Favicon / Mark", desc: "Square — profile pictures", bg: "bg-slate-100 dark:bg-white/[0.06]" },
                ].map((a) => (
                  <div key={a.name} className="bg-white dark:bg-[#151518] rounded-2xl border border-gray-200 dark:border-white/[0.06] overflow-hidden shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300">
                    <div className={`${a.bg} h-36 flex items-center justify-center`}>
                      <img src="/ten80ten-logo.png" alt={a.name} className="h-14 object-contain" style={a.name === "Light Logo" ? { filter: "brightness(0) invert(1)" } : {}} />
                    </div>
                    <div className="p-5 flex items-center justify-between border-t border-gray-100 dark:border-white/[0.06]">
                      <div><p className="text-[13px] font-semibold text-slate-800 dark:text-gray-200">{a.name}</p><p className="text-[11px] text-gray-400 mt-0.5">{a.desc}</p></div>
                      <button className="p-2.5 rounded-lg hover:bg-orange-50 dark:hover:bg-orange-500/10 text-gray-400 hover:text-orange-500 cursor-pointer transition-all"><Download className="w-4 h-4" /></button>
                    </div>
                  </div>
                ))}
              </div>
            </Section>

            <Section icon={<Globe className="w-4 h-4 text-yellow-600" />} title="Social Media Specs" sub="Required dimensions for each platform">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {[
                  { label: "Profile Photo", size: "400 × 400", platform: "All" },
                  { label: "Cover Photo", size: "820 × 312", platform: "Facebook" },
                  { label: "Story / Reel", size: "1080 × 1920", platform: "IG / TikTok" },
                  { label: "Feed Post", size: "1080 × 1080", platform: "Instagram" },
                  { label: "Video Thumb", size: "1280 × 720", platform: "YouTube" },
                  { label: "Banner", size: "1584 × 396", platform: "LinkedIn" },
                ].map((s) => (
                  <div key={s.label} className="bg-white dark:bg-[#151518] rounded-xl border border-gray-200 dark:border-white/[0.06] p-5 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-300">
                    <p className="text-[12px] font-semibold text-slate-800 dark:text-gray-200">{s.label}</p>
                    <p className="text-[20px] font-mono font-bold text-slate-900 dark:text-white mt-1.5 tracking-tight">{s.size}</p>
                    <p className="text-[10px] text-gray-400 mt-1.5 font-medium">{s.platform}</p>
                  </div>
                ))}
              </div>
            </Section>
          </div>
        )}

        {/* ═══════════════ TAB 4: GUARDRAILS ═══════════════ */}
        {activeTab === "guardrails" && (
          <div className="space-y-12 max-w-3xl mx-auto">

            <Section icon={<Shield className="w-4 h-4 text-orange-500" />} title="Brand Do's & Don'ts" sub="Non-negotiable guidelines for every piece of content">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* DO */}
                <div className="bg-white dark:bg-[#151518] rounded-2xl border border-yellow-200/60 dark:border-yellow-500/10 overflow-hidden shadow-sm">
                  <div className="px-6 py-4 bg-gradient-to-r from-yellow-50 to-orange-50/50 dark:from-yellow-500/5 dark:to-orange-500/5 border-b border-yellow-200/40 dark:border-yellow-500/10">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-yellow-500 to-orange-500 flex items-center justify-center shadow-sm"><CheckCircle className="w-4 h-4 text-white" /></div>
                      <div>
                        <h3 className="text-[14px] font-bold text-yellow-800 dark:text-yellow-300">DO</h3>
                        <p className="text-[10px] text-yellow-700/60 dark:text-yellow-400/50">Always follow these</p>
                      </div>
                    </div>
                  </div>
                  <ul className="p-6 space-y-3.5">
                    {[
                      "Lead with the 10/80/10 framework",
                      "Use real team photos and BTS content",
                      "Always include a CTA (call, DM, or email)",
                      "Position Ten80Ten as a strategic partner",
                      "Emphasize cost savings with quality intact",
                      "Post Monday – Friday mornings",
                      "Speak directly to overwhelmed founders",
                      "Show client results and transformations",
                      "End every post with a clear next step",
                    ].map((item, i) => (
                      <li key={i} className="flex items-start gap-3"><CheckCircle className="w-4 h-4 text-yellow-600 dark:text-yellow-500 mt-0.5 shrink-0" /><span className="text-[13px] text-gray-700 dark:text-gray-300 leading-snug">{item}</span></li>
                    ))}
                  </ul>
                </div>
                {/* DON'T */}
                <div className="bg-white dark:bg-[#151518] rounded-2xl border border-orange-200/60 dark:border-orange-500/10 overflow-hidden shadow-sm">
                  <div className="px-6 py-4 bg-gradient-to-r from-orange-50 to-red-50/50 dark:from-orange-500/5 dark:to-red-500/5 border-b border-orange-200/40 dark:border-orange-500/10">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-orange-600 to-red-600 flex items-center justify-center shadow-sm"><XCircle className="w-4 h-4 text-white" /></div>
                      <div>
                        <h3 className="text-[14px] font-bold text-orange-800 dark:text-orange-300">DON'T</h3>
                        <p className="text-[10px] text-orange-700/60 dark:text-orange-400/50">Never do these</p>
                      </div>
                    </div>
                  </div>
                  <ul className="p-6 space-y-3.5">
                    {[
                      "Sound like a cheap outsourcing agency",
                      "Post without phone, email, or website",
                      "Stretch, recolor, or alter the logo",
                      "Use generic stock photos",
                      "Make direct competitor comparisons",
                      "Post outside Mon–Fri without approval",
                      "Use casual slang or excessive emojis",
                      "Promise specific revenue guarantees",
                      "Publish without the pre-submit checklist",
                    ].map((item, i) => (
                      <li key={i} className="flex items-start gap-3"><XCircle className="w-4 h-4 text-orange-500 mt-0.5 shrink-0" /><span className="text-[13px] text-gray-700 dark:text-gray-300 leading-snug">{item}</span></li>
                    ))}
                  </ul>
                </div>
              </div>
            </Section>

            <Section icon={<Eye className="w-4 h-4 text-yellow-600" />} title="Approval Chain" sub="Every post follows this pipeline before going live">
              <div className="bg-white dark:bg-[#151518] rounded-2xl border border-gray-200 dark:border-white/[0.06] p-7 shadow-sm">
                <div className="flex flex-wrap items-center gap-2 justify-center">
                  {[
                    { step: "1", label: "VA Creates Draft", role: "Virtual Assistant", color: "from-orange-500 to-yellow-500" },
                    { step: "2", label: "Lead SM Reviews", role: "Social Media Specialist", color: "from-yellow-500 to-orange-400" },
                    { step: "3", label: "Approver Reviews", role: "Designated Approver", color: "from-orange-600 to-red-500" },
                    { step: "4", label: "Post Goes Live", role: "Auto-Publish", color: "from-yellow-600 to-orange-500" },
                  ].map((s, i) => (
                    <div key={s.step} className="flex items-center gap-2">
                      <div className="flex items-center gap-3 bg-slate-50 dark:bg-white/[0.03] border border-gray-200 dark:border-white/[0.06] rounded-xl px-5 py-3.5">
                        <div className={`w-9 h-9 rounded-full bg-gradient-to-br ${s.color} text-white flex items-center justify-center text-[13px] font-bold shadow-sm`}>{s.step}</div>
                        <div>
                          <p className="text-[12px] font-semibold text-slate-800 dark:text-gray-200">{s.label}</p>
                          <p className="text-[10px] text-gray-400">{s.role}</p>
                        </div>
                      </div>
                      {i < 3 && <ArrowRight className="w-4 h-4 text-orange-300 dark:text-orange-500/30 shrink-0" />}
                    </div>
                  ))}
                </div>
              </div>
            </Section>

            <Section icon={<Star className="w-4 h-4 text-orange-500" />} title="Key Facts & Proof Points" sub="Reference these in captions, bios, and sales decks">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {[
                  { fact: "10/80/10 Framework", note: "Core operating model", icon: <Layers className="w-4 h-4 text-orange-500" /> },
                  { fact: "Up to 70% Savings", note: "vs. local hires, same quality", icon: <Zap className="w-4 h-4 text-yellow-600" /> },
                  { fact: "Nashville, TN HQ", note: "US-based leadership", icon: <Globe className="w-4 h-4 text-orange-400" /> },
                  { fact: "hello@ten80ten.com", note: "Primary business contact", icon: <Mail className="w-4 h-4 text-yellow-600" /> },
                  { fact: "+1 615-258-6179", note: "Discovery call line", icon: <Phone className="w-4 h-4 text-orange-500" /> },
                  { fact: "Mon – Fri AM", note: "Peak posting window", icon: <Clock className="w-4 h-4 text-yellow-500" /> },
                ].map((item) => (
                  <div key={item.fact} className="bg-white dark:bg-[#151518] rounded-xl border border-gray-200 dark:border-white/[0.06] p-5 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-300">
                    <div className="flex items-center gap-2 mb-2.5">
                      <div className="w-8 h-8 rounded-lg bg-orange-50 dark:bg-orange-500/[0.06] flex items-center justify-center">{item.icon}</div>
                    </div>
                    <p className="text-[13px] font-bold text-slate-800 dark:text-gray-200">{item.fact}</p>
                    <p className="text-[11px] text-gray-400 mt-1">{item.note}</p>
                  </div>
                ))}
              </div>
            </Section>
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ icon, title, sub, children }: { icon: React.ReactNode; title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-6">
        <h2 className="text-[16px] font-bold text-slate-900 dark:text-white flex items-center gap-2.5 tracking-tight">{icon}{title}</h2>
        {sub && <p className="text-[12px] text-gray-400 mt-1 ml-[30px]">{sub}</p>}
      </div>
      {children}
    </section>
  );
}

function EditField({ label, value, onChange, multiline }: { label?: string; value: string; onChange: (v: string) => void; multiline?: boolean }) {
  return (
    <div>
      {label && <p className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-[0.08em] mb-1.5">{label}</p>}
      {multiline ? (
        <Textarea value={value} onChange={(e) => onChange(e.target.value)} className="min-h-[70px] bg-white dark:bg-white/[0.04] border-orange-200 dark:border-orange-500/30 rounded-xl text-[13px] resize-none ring-2 ring-orange-100 dark:ring-orange-500/10" />
      ) : (
        <Input value={value} onChange={(e) => onChange(e.target.value)} className="h-10 bg-white dark:bg-white/[0.04] border-orange-200 dark:border-orange-500/30 rounded-xl text-[13px] ring-2 ring-orange-100 dark:ring-orange-500/10" />
      )}
    </div>
  );
}
