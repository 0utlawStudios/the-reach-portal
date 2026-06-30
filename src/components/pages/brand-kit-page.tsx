"use client";

import { useState, useEffect, useRef } from "react";
import { ReachWordmark } from "@/components/reach-wordmark";
import { CopyBlock, ColorSwatch } from "@/components/copy-block";
import { useToast } from "@/lib/toast-context";
import { useAuth } from "@/lib/auth-context";
import { usePipeline } from "@/lib/pipeline-context";
import { supabase } from "@/lib/supabaseClient";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Hash, Type, Palette, Shield, Download, Megaphone, Phone, Globe,
  CheckCircle, XCircle, Star, Award, Eye, Pencil, Save, X,
  Clock, Zap, Target, ArrowRight, Layers, BookOpen, Compass,
  CalendarDays, Camera, Users, FileText, Route, BadgeDollarSign,
  MessageCircle, Sparkles,
} from "lucide-react";

type Tab = "copy" | "source" | "strategy" | "visual" | "guardrails";

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
  phone: "",
  website: "www.thereach.travel",
  tagline: "Chic, curated, full service.",
  serviceArea: "Luxury travel planning and booking for hotels, transfers, airfare, tours, and activities.",
  hashtagCore: "#TheReach #BespokeTravel #CuratedTravel #DesignForwardTravel #TravelWithTaste",
  hashtagSeasonal: "#BhutanTravel #SwitzerlandTravel #PiedmontItaly #MilanTravel #BahamasTravel",
  hashtagEngagement: "#TravelByPerspective #SeamlessTravel #HighTouchTravel #WhereToNext #HowDoYouWantToFeel",
  hashtagCommercial: "#LuxuryTravelAdvisor #BespokeItinerary #HotelPerks #FullServiceTravel #TravelPlanning",
  hooks: [
    "Time and ease are the best form of luxury.",
    "AI can plan a trip. It cannot VIP a client.",
    "The right hotel can change the way a destination feels.",
    "The best travel is not about seeing everything. It is about seeing the right things at the right pace.",
    "Curation is knowing what to include and what to leave out.",
    "Where do you want to go, and how do you want to feel when you return?",
  ],
  ctas: [
    "Where do you want to go, and how do you want to feel?",
    "Start planning a trip that feels personal from the first detail.",
    "Let The Reach handle the research, access, and booking.",
  ],
  whenToPost: "Use polished, personal travel content built around design-forward stays, hotel features, off-the-beaten-path destinations, and scouting trips. Lead with Bhutan in June, Switzerland in July, Bangkok and the Bahamas in September, then Milan and Piedmont in November when relevant.",
  contentPillars: [
    { title: "Perspective-Led Planning", desc: "Show travel shaped by taste, access, and personal context rather than generic guidebook recommendations." },
    { title: "Design-Forward Destinations", desc: "Feature interesting places, nature-forward stays, thoughtful hotels, and off-the-beaten-path experiences." },
    { title: "High-Touch Full-Service Travel", desc: "Emphasize planning, booking, transfers, airfare, tours, activities, VIP treatment, perks, time, and ease." },
    { title: "Sensory Travel", desc: "Build stories around texture, flavor, movement, stillness, service moments, and the feeling of being somewhere new." },
  ],
  brandVoice: "Chic, curated, personal, and precise. The Reach communicates with clarity and confidence. The writing is direct, warm, and grounded in perspective. It never oversells, overexplains, feels generic, or makes luxury feel on the nose.",
};

const useSupabase = !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

const CLIENT_BRIEF_SECTIONS = [
  {
    title: "Business Position",
    icon: Sparkles,
    items: [
      { label: "Services", value: "Full-service luxury travel planning and booking: hotels, transfers, airfare, tours, and activities." },
      { label: "Difference", value: "Perspective-led recommendations, off-the-beaten-path destinations, high-touch planning, and trips tailored to the client's preferences." },
      { label: "Brand words", value: "Chic, curated, full service." },
      { label: "Avoid", value: "Luxury that feels obvious, cookie-cutter posts, cold content, or anything without a distinct Reach point of view." },
    ],
  },
  {
    title: "Ideal Client",
    icon: Users,
    items: [
      { label: "Who", value: "Open-minded, adventurous people with great taste. Core travel types are couples and families." },
      { label: "Desire", value: "Seamless travel with interesting elements: designed hotels, hard-to-secure activities, and the feeling that the vacation starts as soon as they decide to go." },
      { label: "Pain", value: "No time to research, limited industry knowledge, limited access, and uncertainty about what is worth booking." },
      { label: "Objection", value: "Planning fees and the belief that AI can replace an advisor. The counterpoint: AI cannot VIP a client or unlock advisor perks." },
    ],
  },
  {
    title: "Travel Focus",
    icon: Compass,
    items: [
      { label: "Specialty", value: "Interesting destinations, design-forward stays, nature-forward travel, and full-service itineraries." },
      { label: "Current draw", value: "Italy and nature-forward farm hotels." },
      { label: "Promote more", value: "Nature-forward, design-based, off-the-beaten-path travel." },
      { label: "Angle", value: "Quality over quantity. The right hotel, meal, guide, pace, and sensory detail matter more than a packed itinerary." },
    ],
  },
  {
    title: "Marketing Goals",
    icon: Target,
    items: [
      { label: "Primary goal", value: "Build brand awareness, create a social identity, grow the following, increase inquiries, and convert more bookings." },
      { label: "Creative bar", value: "A beautiful, designed social presence that reflects the brand's taste and gives The Reach a recognizable voice." },
      { label: "Content first", value: "Bhutan scouting trip, June 10-20." },
      { label: "Calendar", value: "Switzerland in July, Bangkok and the Bahamas in September, Milan and Piedmont in November." },
    ],
  },
  {
    title: "Content Direction",
    icon: Camera,
    items: [
      { label: "More of", value: "Reels, authentic posts, hotel features, and personal travel experiences." },
      { label: "Founder presence", value: "Stefani is not fully comfortable being featured yet, but a visible face can build credibility with the right guidance." },
      { label: "Lead path", value: "Most inquiries come through friends, word of mouth, email, or text." },
      { label: "CTA", value: "Where do you want to go, and how do you want to feel?" },
    ],
  },
  {
    title: "Sales Inputs",
    icon: BadgeDollarSign,
    items: [
      { label: "Qualify with", value: "Budget, destination idea, trip duration, pace, and how the traveler wants to feel while traveling and when they return." },
      { label: "Booking friction", value: "Up-front fees, total itinerary cost, or a proposed trip that exceeds budget." },
      { label: "Channels", value: "Instagram first. TikTok is open for consideration if it fits The Reach's voice." },
      { label: "Success", value: "Bookings are the main result. Target volume is 15-25 leads or bookings per month." },
    ],
  },
];

const VOICE_TERRITORIES = [
  { title: "Quality Over Quantity", copy: "The best travel is not about seeing everything. It is about seeing the right things at the right pace, with people who know the place." },
  { title: "The Power of Curation", copy: "A trip becomes transformative through the quality of each experience: the right hotel, the right meal, and the guide who knows the terrain." },
  { title: "Personal Approach", copy: "Build trips around how people actually want to travel, not how a guidebook says they should." },
  { title: "Beyond the Itinerary", copy: "Travel should engage the senses: texture, flavor, light, pace, service, and the full feeling of being somewhere new." },
];

const CAMPAIGN_MOMENTS = [
  { label: "June", value: "Bhutan scouting trip", detail: "First destination focus" },
  { label: "July", value: "Switzerland", detail: "Summer alpine story" },
  { label: "September", value: "Bangkok + Bahamas", detail: "Contrast city energy and island restoration" },
  { label: "November", value: "Milan + Piedmont", detail: "Design, food, and northern Italy depth" },
];

const PHOTO_CATEGORIES = [
  { title: "Place", desc: "Natural landscapes and outdoor environments that frame the journey: mountains, coastlines, deserts, forests, and water." },
  { title: "Space", desc: "Hotels, interiors, architecture, rooms, and designed environments that show quality and intention." },
  { title: "Activities", desc: "Hiking, spa treatments, dining, yoga, cultural practices, movement, and rest." },
  { title: "Culture", desc: "Local people, traditions, markets, artisans, everyday rituals, and human connection." },
  { title: "Detail", desc: "Close-ups of food, materials, textures, crafted objects, and small signs of care." },
  { title: "Macro", desc: "Abstract natural textures, shadows, reflections, patterns, and observed moments that create mood without demanding attention." },
];

const INSTAGRAM_TEMPLATES = [
  { title: "Image Only", desc: "Use when the photography can stand alone. No overlay, no explanation, less is more." },
  { title: "Image + Wordmark", desc: "Default branded post. Place the wordmark sparingly and default to Sand over imagery unless another brand color gives clearer contrast." },
  { title: "Destination Callout", desc: "Use a restrained place label or coordinate treatment when the location itself is the story." },
  { title: "Quote / Text", desc: "Use for voice-led thoughts, founder perspective, or sensory travel lines that need quiet space." },
  { title: "Editorial Note", desc: "Pair a short insight with strong margins and one image. Avoid filling every inch." },
  { title: "Grid Mix", desc: "Rotate all formats so the feed feels considered and alive, not repetitive." },
];

const LOGO_RULES = [
  "Wordmark is Everett from Weltkern, all caps, with generous letter spacing.",
  "Primary wordmark use is Sun on Sand.",
  "Over imagery, default to Sand for contrast, then choose the brand color that reads best.",
  "Clearspace equals the height of the letter H on all sides.",
  "Do not stretch, distort, rotate, or recolor outside the brand palette.",
];

const normalizePlaybookData = (raw?: Partial<PlaybookData> | null): PlaybookData => ({
  ...DEFAULT_DATA,
  ...(raw || {}),
  hooks: raw?.hooks?.length ? raw.hooks : DEFAULT_DATA.hooks,
  ctas: raw?.ctas?.length ? raw.ctas : DEFAULT_DATA.ctas,
  contentPillars: raw?.contentPillars?.length ? raw.contentPillars : DEFAULT_DATA.contentPillars,
});

export function BrandKitPage() {
  const { addToast } = useToast();
  const { currentUser } = useAuth();
  const { workspaceId } = usePipeline();
  const [activeTab, setActiveTab] = useState<Tab>(() => {
    if (typeof window === "undefined") return "copy";
    const requestedTab = window.sessionStorage.getItem("reach_brandkit_tab");
    return requestedTab === "strategy" || requestedTab === "visual" || requestedTab === "guardrails" || requestedTab === "source" || requestedTab === "copy"
      ? requestedTab
      : "copy";
  });
  const [focusTarget, setFocusTarget] = useState<"hashtags" | "captions" | null>(() => {
    if (typeof window === "undefined") return null;
    const requestedFocus = window.sessionStorage.getItem("reach_brandkit_focus");
    return requestedFocus === "hashtags" || requestedFocus === "captions" ? requestedFocus : null;
  });
  const hashtagRef = useRef<HTMLDivElement>(null);
  const captionsRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<PlaybookData>(DEFAULT_DATA);
  const [editMode, setEditMode] = useState(false);
  const [editData, setEditData] = useState<PlaybookData>(DEFAULT_DATA);
  const [saving, setSaving] = useState(false);
  const [playbookRowId, setPlaybookRowId] = useState<string | null>(null);

  useEffect(() => {
    if (activeTab !== "copy" || !focusTarget) return;
    const target = focusTarget === "hashtags" ? hashtagRef.current : captionsRef.current;
    const timer = window.setTimeout(() => {
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
      setFocusTarget(null);
    }, 80);
    return () => window.clearTimeout(timer);
  }, [activeTab, focusTarget]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.sessionStorage.removeItem("reach_brandkit_tab");
    window.sessionStorage.removeItem("reach_brandkit_focus");
  }, []);

  useEffect(() => {
    if (!useSupabase || !workspaceId) return;
    let cancelled = false;
    supabase
      .from("brand_playbook")
      .select("id, data")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data: row, error }) => {
        if (cancelled) return;
        if (error) {
          console.error("[brand-kit] load failed:", error.message);
          return;
        }
        const nextData = normalizePlaybookData(row?.data as Partial<PlaybookData> | null);
        setPlaybookRowId(row?.id ? row.id as string : null);
        setData(nextData);
        setEditData(nextData);
        setEditMode(false);
      });
    return () => { cancelled = true; };
  }, [workspaceId]);

  useEffect(() => {
    if (!useSupabase || !workspaceId) return;
    const channel = supabase
      .channel(`brand-playbook-realtime-${workspaceId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "brand_playbook", filter: `workspace_id=eq.${workspaceId}` }, (payload) => {
        if (payload.eventType === "DELETE") return;
        if (payload.new?.id) setPlaybookRowId(payload.new.id as string);
        if (payload.new?.data) {
          setData(normalizePlaybookData(payload.new.data as Partial<PlaybookData>));
          if (!editMode) addToast("Brand playbook updated by another user", "info");
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [workspaceId, editMode, addToast]);

  const persistPlaybook = async (nextData: PlaybookData) => {
    if (!workspaceId) {
      return { error: new Error("Workspace is still loading. Please try again.") };
    }

    if (playbookRowId) {
      const updateResult = await supabase
        .from("brand_playbook")
        .update({ data: nextData, updated_by: currentUser.name })
        .eq("id", playbookRowId)
        .eq("workspace_id", workspaceId)
        .select("id")
        .maybeSingle();
      if (updateResult.error || updateResult.data?.id) {
        return updateResult;
      }
    }

    const insertResult = await supabase
      .from("brand_playbook")
      .upsert({
        id: `brand:${workspaceId}`,
        workspace_id: workspaceId,
        data: nextData,
        updated_by: currentUser.name,
      }, { onConflict: "id" })
      .select("id")
      .single();
    if (!insertResult.error && insertResult.data?.id) {
      setPlaybookRowId(insertResult.data.id as string);
    }
    return insertResult;
  };

  const startEdit = () => { setEditData({ ...data }); setEditMode(true); };
  const cancelEdit = () => { setEditMode(false); };

  const saveEdit = async () => {
    setSaving(true);
    // DATA-008: snapshot so a failed DB write can be rolled back instead of
    // leaving the optimistic local state with a misleading success toast.
    const previousData = data;
    setData(editData);
    if (useSupabase) {
      const { error } = await persistPlaybook(editData);
      if (error) {
        console.error("[brand-kit] saveEdit sync failed:", error.message);
        setData(previousData);
        setSaving(false);
        addToast(`Save failed: ${error.message}. Changes reverted.`, "error");
        return;
      }
    }
    setSaving(false);
    setEditMode(false);
    addToast("Playbook saved and synced to all devices", "success");
  };

  const d = editMode ? editData : data;
  const updateField = <K extends keyof PlaybookData>(key: K, value: PlaybookData[K]) => setEditData((prev) => ({ ...prev, [key]: value }));
  const updateHook = (i: number, value: string) => setEditData((prev) => ({ ...prev, hooks: prev.hooks.map((h, idx) => idx === i ? value : h) }));
  const updateCta = (i: number, value: string) => setEditData((prev) => ({ ...prev, ctas: prev.ctas.map((c, idx) => idx === i ? value : c) }));
  const updatePillar = (i: number, key: "title" | "desc", value: string) => setEditData((prev) => ({ ...prev, contentPillars: prev.contentPillars.map((p, idx) => idx === i ? { ...p, [key]: value } : p) }));

  const TABS = [
    { id: "copy" as Tab, label: "Copy Hub", icon: <Megaphone className="w-3.5 h-3.5" /> },
    { id: "source" as Tab, label: "Client Intel", icon: <FileText className="w-3.5 h-3.5" /> },
    { id: "strategy" as Tab, label: "Strategy", icon: <Target className="w-3.5 h-3.5" /> },
    { id: "visual" as Tab, label: "Identity", icon: <Palette className="w-3.5 h-3.5" /> },
    { id: "guardrails" as Tab, label: "Guardrails", icon: <Shield className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="w-full h-full overflow-y-auto">
      {/* ─── Hero Header with subtle gradient ─── */}
      <div className="relative px-4 sm:px-8 pt-8 pb-0">
        <div className="absolute inset-0 bg-gradient-to-b from-[#E1DFD5] via-transparent to-transparent dark:from-orange-500/[0.03] dark:via-transparent pointer-events-none" />
        <div className="relative flex items-start justify-between mb-2">
          <div>
            <div className="flex items-center gap-3 mb-1.5">
              <div className="w-9 h-9 rounded-xl border border-[#6C655A]/25 bg-[#E1DFD5] flex items-center justify-center shadow-[0_8px_24px_rgba(108,101,90,0.18),inset_0_1px_0_rgba(255,255,255,0.45)]">
                <BookOpen className="w-4.5 h-4.5 text-[#975428]" />
              </div>
              <h1 className="text-[24px] font-extrabold text-slate-900 dark:text-white tracking-[-0.04em]">Brand Playbook</h1>
            </div>
            <p className="text-[13px] text-gray-400 ml-[48px]">Copy-ready assets, content strategy, and brand guidelines for The Reach.</p>
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
        <div className="relative flex items-center gap-0.5 mt-6 border-b border-gray-200 dark:border-white/[0.06] overflow-x-auto -mx-4 sm:-mx-8 px-4 sm:px-8 [mask-image:linear-gradient(to_right,transparent,black_24px,black_calc(100%-24px),transparent)]">
          {TABS.map((tab) => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-5 py-3 text-[12px] font-semibold border-b-2 -mb-px transition-all duration-150 cursor-pointer ${activeTab === tab.id ? "border-orange-500 text-orange-700 dark:text-orange-400" : "border-transparent text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"}`}>
              {tab.icon}{tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* ─── Tab Content ─── */}
      <div className="px-4 sm:px-8 py-8">

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
                    <CopyBlock label="Phone" text={d.phone || "Not provided"} />
                    <CopyBlock label="Website" text={d.website} />
                    <CopyBlock label="Tagline" text={d.tagline} />
                    <CopyBlock label="Service Area" text={d.serviceArea} />
                  </>
                )}
              </div>
            </Section>

            <div ref={hashtagRef} className="scroll-mt-6">
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
            </div>

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

            <div ref={captionsRef} className="scroll-mt-6">
              <Section icon={<BookOpen className="w-4 h-4 text-orange-500" />} title="Caption Templates" sub="Reusable formats for polished Reach captions">
                <div className="space-y-3">
                  {[
                    {
                      label: "Hotel Feature",
                      text: "Open with the feeling of the stay. Name the design detail or service moment. Explain why it changes the destination. Close with a planning question.",
                    },
                    {
                      label: "Destination Note",
                      text: "Lead with a point of view. Add one grounded detail from the place. Connect it to timing, access, or ease. End with The Reach CTA.",
                    },
                    {
                      label: "Full-Service Planning",
                      text: "Start with the travel friction. Show what The Reach handles: research, access, booking, transfers, tours, and perks. Close with where the client wants to go next.",
                    },
                  ].map((template) => (
                    <CopyBlock key={template.label} label={template.label} text={template.text} />
                  ))}
                </div>
              </Section>
            </div>
          </div>
        )}

        {/* ═══════════════ TAB 2: CLIENT INTEL ═══════════════ */}
        {activeTab === "source" && (
          <div className="space-y-12 max-w-5xl mx-auto">
            <section className="relative overflow-hidden rounded-2xl border border-gray-200 dark:border-white/[0.06] bg-white dark:bg-[#151518] shadow-sm">
              <div className="absolute inset-0 pointer-events-none opacity-70 [background:radial-gradient(circle_at_22%_18%,rgba(151,84,40,0.16),transparent_32%),radial-gradient(circle_at_88%_12%,rgba(90,101,108,0.14),transparent_28%)]" />
              <div className="relative grid gap-6 lg:grid-cols-[1.1fr_0.9fr] p-6 sm:p-8">
                <div>
                  <div className="flex items-center gap-2 mb-5">
                    <div className="w-8 h-8 rounded-xl bg-[#975428] text-[#E1DFD5] flex items-center justify-center shadow-sm">
                      <FileText className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">Client intake translated into operating guidance</p>
                      <h2 className="text-[20px] font-extrabold text-slate-900 dark:text-white tracking-[-0.03em]">The Reach source brief</h2>
                    </div>
                  </div>
                  <p className="max-w-2xl text-[14px] leading-[1.8] text-gray-700 dark:text-gray-300">
                    The raw client answers are repositioned here as a working brief for SMMs: what The Reach sells, who it is for, which angles matter, and which words should steer content before a post reaches approval.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: "Primary result", value: "Bookings" },
                    { label: "Target volume", value: "15-25" },
                    { label: "First story", value: "Bhutan" },
                    { label: "Core CTA", value: "How do you want to feel?" },
                  ].map((item) => (
                    <div key={item.label} className="rounded-xl border border-gray-200 dark:border-white/[0.06] bg-gray-50 dark:bg-white/[0.03] p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-orange-300 dark:hover:border-orange-500/30">
                      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-[0.08em]">{item.label}</p>
                      <p className="mt-2 text-[16px] font-bold text-slate-900 dark:text-white tracking-tight">{item.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {CLIENT_BRIEF_SECTIONS.map((section) => {
                const Icon = section.icon;
                return (
                  <section key={section.title} className="group rounded-2xl border border-gray-200 dark:border-white/[0.06] bg-white dark:bg-[#151518] overflow-hidden shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md">
                    <div className="px-5 py-4 border-b border-gray-100 dark:border-white/[0.06] bg-slate-50/70 dark:bg-white/[0.02] flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-orange-50 dark:bg-orange-500/10 flex items-center justify-center text-orange-600 dark:text-orange-400 transition-transform duration-300 group-hover:scale-105">
                        <Icon className="w-4 h-4" />
                      </div>
                      <h3 className="text-[14px] font-bold text-slate-900 dark:text-white tracking-tight">{section.title}</h3>
                    </div>
                    <div className="divide-y divide-gray-100 dark:divide-white/[0.06]">
                      {section.items.map((item) => (
                        <div key={item.label} className="grid gap-1 px-5 py-4 sm:grid-cols-[126px_1fr]">
                          <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-gray-400 dark:text-gray-500">{item.label}</p>
                          <p className="text-[13px] leading-[1.7] text-gray-700 dark:text-gray-300">{item.value}</p>
                        </div>
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          </div>
        )}

        {/* ═══════════════ TAB 3: STRATEGY ═══════════════ */}
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

            <Section icon={<CalendarDays className="w-4 h-4 text-yellow-600" />} title="Campaign Moments" sub="Travel hooks pulled from the client intake">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {CAMPAIGN_MOMENTS.map((moment) => (
                  <div key={moment.label} className="relative overflow-hidden bg-white dark:bg-[#151518] rounded-xl border border-gray-200 dark:border-white/[0.06] p-5 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md">
                    <div className="absolute top-0 left-0 h-full w-1 bg-[#975428]" />
                    <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-orange-600 dark:text-orange-400">{moment.label}</p>
                    <p className="mt-2 text-[15px] font-bold text-slate-900 dark:text-white tracking-tight">{moment.value}</p>
                    <p className="mt-1 text-[12px] leading-relaxed text-gray-500 dark:text-gray-400">{moment.detail}</p>
                  </div>
                ))}
              </div>
            </Section>

            <Section icon={<Layers className="w-4 h-4 text-orange-500" />} title="Content Pillars" sub="The strategic themes that drive all content">
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

            <Section icon={<Award className="w-4 h-4 text-yellow-600" />} title="Brand Voice & Tone" sub="How The Reach sounds across all platforms">
              {editMode ? (
                <EditField value={editData.brandVoice} onChange={(v) => updateField("brandVoice", v)} multiline />
              ) : (
                <div className="bg-white dark:bg-[#151518] rounded-2xl border border-gray-200 dark:border-white/[0.06] overflow-hidden shadow-sm">
                  <div className="flex">
                    <div className="w-1.5 shrink-0 bg-gradient-to-b from-yellow-500 to-orange-500 rounded-l-2xl" />
                    <div className="p-7">
                      <p className="text-[14px] text-gray-700 dark:text-gray-300 leading-[1.8]">{d.brandVoice}</p>
                      <div className="flex flex-wrap gap-2 mt-5">
                        {["Chic", "Curated", "Personal", "Precise", "High-Touch"].map((trait) => (
                          <span key={trait} className="px-3 py-1 rounded-full bg-orange-50 dark:bg-orange-500/10 border border-orange-200/60 dark:border-orange-500/20 text-[10px] font-semibold text-orange-700 dark:text-orange-400 uppercase tracking-wider">{trait}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </Section>

            <Section icon={<MessageCircle className="w-4 h-4 text-orange-500" />} title="Voice Territories" sub="Brand-deck language translated into repeatable caption angles">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {VOICE_TERRITORIES.map((territory) => (
                  <div key={territory.title} className="bg-white dark:bg-[#151518] rounded-xl border border-gray-200 dark:border-white/[0.06] p-5 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md">
                    <p className="text-[13px] font-bold text-slate-900 dark:text-white tracking-tight">{territory.title}</p>
                    <p className="mt-2 text-[12px] leading-[1.75] text-gray-600 dark:text-gray-400">{territory.copy}</p>
                  </div>
                ))}
              </div>
            </Section>
          </div>
        )}

        {/* ═══════════════ TAB 3: VISUAL IDENTITY ═══════════════ */}
        {activeTab === "visual" && (
          <div className="space-y-12 max-w-3xl mx-auto">

            <Section icon={<Palette className="w-4 h-4 text-orange-500" />} title="Color Palette" sub="Click any swatch to copy the hex code">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
                <ColorSwatch name="Sand" hex="#E1DFD5" desc="Primary background" role="Background" />
                <ColorSwatch name="Stone" hex="#6C655A" desc="Primary text" role="Text" />
                <ColorSwatch name="Sun" hex="#975428" desc="Accent and emphasis" role="Accent" />
                <ColorSwatch name="Water" hex="#5A656C" desc="Secondary accent" role="Support" />
              </div>
              <div className="mt-5 rounded-2xl border border-gray-200 dark:border-white/[0.06] bg-white dark:bg-[#151518] p-5 shadow-sm">
                <div className="grid gap-4 md:grid-cols-3">
                  {[
                    { title: "Use Sand first", copy: "Sand is the primary background. It replaces white." },
                    { title: "Use Stone or Sun for text", copy: "When a darker color becomes the background, Sand becomes the text color." },
                    { title: "Use Water sparingly", copy: "Water adds quiet depth. It should support the core palette, not compete with it." },
                  ].map((rule) => (
                    <div key={rule.title}>
                      <p className="text-[12px] font-bold text-slate-900 dark:text-white">{rule.title}</p>
                      <p className="mt-1 text-[12px] leading-relaxed text-gray-500 dark:text-gray-400">{rule.copy}</p>
                    </div>
                  ))}
                </div>
                <p className="mt-4 text-[11px] font-medium text-orange-700 dark:text-orange-400">Pure black and pure white are not part of the brand system.</p>
              </div>
            </Section>

            <Section icon={<Type className="w-4 h-4 text-yellow-600" />} title="Typography" sub="Bradford from Lineto and Everett from Weltkern">
              <div className="bg-white dark:bg-[#151518] rounded-2xl border border-gray-200 dark:border-white/[0.06] overflow-hidden shadow-sm">
                <div className="p-8 space-y-8">
                  <div>
                    <p className="text-[9px] font-bold text-orange-500/60 uppercase tracking-[0.15em] mb-3">Bradford by Lineto - Primary Voice</p>
                    <p className="text-[32px] font-extrabold text-slate-900 dark:text-white tracking-tight leading-[1.1]">The Reach designs travel shaped by perspective, access, and taste.</p>
                  </div>
                  <hr className="border-gray-100 dark:border-white/[0.06]" />
                  <div>
                    <p className="text-[9px] font-bold text-orange-500/60 uppercase tracking-[0.15em] mb-3">Everett by Weltkern - Counterpoint</p>
                    <p className="text-[22px] font-bold text-slate-800 dark:text-gray-200 tracking-tight">Intentional, restrained, and used for supporting details.</p>
                  </div>
                  <hr className="border-gray-100 dark:border-white/[0.06]" />
                  <div>
                    <p className="text-[9px] font-bold text-orange-500/60 uppercase tracking-[0.15em] mb-3">Wordmark - Everett All Caps</p>
                    <p className="text-[18px] text-slate-800 dark:text-gray-200 tracking-[0.4em] leading-[1.4]">THE REACH</p>
                    <p className="mt-2 text-[12px] text-gray-500 dark:text-gray-400 leading-relaxed">The wordmark uses all caps with 40% letter spacing.</p>
                  </div>
                  <hr className="border-gray-100 dark:border-white/[0.06]" />
                  <div>
                    <p className="text-[9px] font-bold text-orange-500/60 uppercase tracking-[0.15em] mb-3">Caption - Social Copy</p>
                    <p className="text-[14px] text-gray-500 dark:text-gray-500 leading-relaxed italic">&quot;Where do you want to go, and how do you want to feel?&quot;</p>
                  </div>
                </div>
              </div>
            </Section>

            <Section icon={<Download className="w-4 h-4 text-orange-500" />} title="Logo Assets" sub="Approved site wordmark variants for all applications">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                {[
                  { name: "Sun Wordmark", desc: "Primary on Sand backgrounds", bg: "bg-[#E1DFD5] border border-[#6C655A]/20", color: "text-[#975428]", file: "/the-reach-wordmark.svg" },
                  { name: "Sand Wordmark", desc: "Reversed on Stone backgrounds", bg: "bg-[#6C655A]", color: "text-[#E1DFD5]", file: "/the-reach-wordmark-sand.svg" },
                  { name: "Stone Wordmark", desc: "Quiet on Sand backgrounds", bg: "bg-[#E1DFD5] border border-[#6C655A]/20", color: "text-[#6C655A]", file: "/the-reach-wordmark-stone.svg" },
                ].map((a) => (
                  <div key={a.name} className="bg-white dark:bg-[#151518] rounded-2xl border border-gray-200 dark:border-white/[0.06] overflow-hidden shadow-[0_1px_2px_rgba(108,101,90,0.12),0_16px_34px_rgba(108,101,90,0.16)] hover:shadow-[0_2px_4px_rgba(108,101,90,0.14),0_22px_44px_rgba(108,101,90,0.2)] hover:-translate-y-0.5 transition-all duration-300">
                    <div className={`${a.bg} h-36 flex items-center justify-center`}>
                      <ReachWordmark className={`h-5 w-[224px] ${a.color}`} />
                    </div>
                    <div className="p-5 flex items-center justify-between border-t border-gray-100 dark:border-white/[0.06]">
                      <div><p className="text-[13px] font-semibold text-slate-800 dark:text-gray-200">{a.name}</p><p className="text-[11px] text-gray-400 mt-0.5">{a.desc}</p></div>
                      <a href={a.file} download className="p-2.5 rounded-lg hover:bg-orange-50 dark:hover:bg-orange-500/10 text-gray-400 hover:text-orange-500 cursor-pointer transition-all" aria-label={`Download ${a.name}`}><Download className="w-4 h-4" /></a>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-5 rounded-2xl border border-gray-200 dark:border-white/[0.06] bg-white dark:bg-[#151518] p-5 shadow-sm">
                <div className="grid gap-3 md:grid-cols-5">
                  {LOGO_RULES.map((rule, i) => (
                    <div key={rule} className="rounded-xl bg-gray-50 dark:bg-white/[0.03] border border-gray-200 dark:border-white/[0.06] p-4 transition-all duration-200 hover:-translate-y-0.5">
                      <p className="text-[11px] font-bold text-orange-600 dark:text-orange-400">{String(i + 1).padStart(2, "0")}</p>
                      <p className="mt-2 text-[12px] leading-relaxed text-gray-700 dark:text-gray-300">{rule}</p>
                    </div>
                  ))}
                </div>
              </div>
            </Section>

            <Section icon={<Camera className="w-4 h-4 text-orange-500" />} title="Photography System" sub="Six categories from the brand deck">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {PHOTO_CATEGORIES.map((category) => (
                  <div key={category.title} className="group bg-white dark:bg-[#151518] rounded-xl border border-gray-200 dark:border-white/[0.06] p-5 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-orange-50 dark:bg-orange-500/10 flex items-center justify-center text-orange-600 dark:text-orange-400 transition-transform duration-300 group-hover:scale-105">
                        <Camera className="w-4 h-4" />
                      </div>
                      <p className="text-[14px] font-bold text-slate-900 dark:text-white">{category.title}</p>
                    </div>
                    <p className="mt-3 text-[12px] leading-[1.75] text-gray-600 dark:text-gray-400">{category.desc}</p>
                  </div>
                ))}
              </div>
            </Section>

            <Section icon={<Route className="w-4 h-4 text-yellow-600" />} title="Instagram Template Mix" sub="Use rotation to keep the feed considered, not repetitive">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {INSTAGRAM_TEMPLATES.map((template) => (
                  <div key={template.title} className="bg-white dark:bg-[#151518] rounded-xl border border-gray-200 dark:border-white/[0.06] p-5 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md">
                    <p className="text-[13px] font-bold text-slate-900 dark:text-white">{template.title}</p>
                    <p className="mt-2 text-[12px] leading-[1.7] text-gray-600 dark:text-gray-400">{template.desc}</p>
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

            <Section icon={<Shield className="w-4 h-4 text-orange-500" />} title="Brand Do&apos;s & Don&apos;ts" sub="Non-negotiable guidelines for every piece of content">
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
                      "Lead with perspective, access, and taste",
                      "Use authentic hotel features and personal travel experiences",
                      "Highlight time, ease, and high-touch planning",
                      "Position The Reach as a bespoke travel partner",
                      "Feature design-forward and nature-forward destinations",
                      "Use the CTA: where do you want to go, and how do you want to feel?",
                      "Speak to open-minded travelers with great taste",
                      "Show interesting elements that are hard to secure",
                      "Use Sand, Stone, Sun, and Water as the full visual system",
                      "Rotate image-only, branded, quote, editorial, and destination templates",
                      "Keep every post polished, personal, and precise",
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
                        <h3 className="text-[14px] font-bold text-orange-800 dark:text-orange-300">DON&apos;T</h3>
                        <p className="text-[10px] text-orange-700/60 dark:text-orange-400/50">Never do these</p>
                      </div>
                    </div>
                  </div>
                  <ul className="p-6 space-y-3.5">
                    {[
                      "Make luxury feel on the nose",
                      "Use cookie-cutter captions with no personality",
                      "Stretch, recolor, or alter the logo",
                      "Use pure black or pure white in brand applications",
                      "Place the wordmark on every post by default",
                      "Use cold or disconnected travel content",
                      "Oversell or overexplain the brand",
                      "Promise perks or access that are not confirmed",
                      "Use generic posts that feel like everyone else",
                      "Let AI-sounding copy replace personal perspective",
                      "Publish without the pre-submit checklist",
                    ].map((item, i) => (
                      <li key={i} className="flex items-start gap-3"><XCircle className="w-4 h-4 text-orange-500 mt-0.5 shrink-0" /><span className="text-[13px] text-gray-700 dark:text-gray-300 leading-snug">{item}</span></li>
                    ))}
                  </ul>
                </div>
              </div>
            </Section>

            <Section icon={<Palette className="w-4 h-4 text-orange-500" />} title="Design Approval Checks" sub="Use these before moving a post forward">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[
                  { title: "Logo", checks: ["Wordmark has enough clearspace", "No rotation, stretching, or non-brand color", "Overlay color has real contrast"] },
                  { title: "Color", checks: ["Sand replaces white", "Sun or Stone replaces black", "Water is only a quiet accent"] },
                  { title: "Imagery", checks: ["At least one of the six photo categories is clear", "Image feels sensory, specific, and grounded", "No generic stock-travel feeling"] },
                  { title: "Copy", checks: ["Direct, warm, and grounded in perspective", "No obvious luxury language", "CTA points to feeling, access, or ease"] },
                ].map((group) => (
                  <div key={group.title} className="rounded-xl border border-gray-200 dark:border-white/[0.06] bg-white dark:bg-[#151518] p-5 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md">
                    <p className="text-[13px] font-bold text-slate-900 dark:text-white">{group.title}</p>
                    <ul className="mt-3 space-y-2.5">
                      {group.checks.map((check) => (
                        <li key={check} className="flex items-start gap-2.5">
                          <CheckCircle className="w-3.5 h-3.5 text-orange-500 mt-0.5 shrink-0" />
                          <span className="text-[12px] leading-snug text-gray-600 dark:text-gray-400">{check}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </Section>

            <Section icon={<Eye className="w-4 h-4 text-yellow-600" />} title="Approval Chain" sub="Every post follows this workflow before going live">
              <div className="bg-white dark:bg-[#151518] rounded-2xl border border-gray-200 dark:border-white/[0.06] p-7 shadow-[0_1px_2px_rgba(108,101,90,0.12),0_18px_38px_rgba(108,101,90,0.16)]">
                <div className="flex flex-wrap items-center gap-2 justify-center">
                  {[
                    { step: "1", label: "VA Creates Draft", role: "Virtual Assistant", bg: "bg-[#975428]", text: "text-[#E1DFD5]" },
                    { step: "2", label: "Lead SM Reviews", role: "Social Media Specialist", bg: "bg-[#5A656C]", text: "text-[#E1DFD5]" },
                    { step: "3", label: "Approver Reviews", role: "Designated Approver", bg: "bg-[#6C655A]", text: "text-[#E1DFD5]" },
                    { step: "4", label: "Post Goes Live", role: "Auto-Publish", bg: "bg-[#975428]", text: "text-[#E1DFD5]" },
                  ].map((s, i) => (
                    <div key={s.step} className="flex items-center gap-2">
                      <div className="flex items-center gap-3 bg-slate-50 dark:bg-white/[0.03] border border-gray-200 dark:border-white/[0.06] rounded-xl px-5 py-3.5 shadow-[0_1px_2px_rgba(108,101,90,0.12),0_8px_18px_rgba(108,101,90,0.12)]">
                        <div className={`w-9 h-9 rounded-full ${s.bg} ${s.text} flex items-center justify-center text-[13px] font-bold shadow-[0_6px_14px_rgba(108,101,90,0.2)]`}>{s.step}</div>
                        <div>
                          <p className="text-[12px] font-semibold text-slate-800 dark:text-gray-200">{s.label}</p>
                          <p className="text-[10px] text-gray-400">{s.role}</p>
                        </div>
                      </div>
                      {i < 3 && <ArrowRight className="w-4 h-4 text-[#975428]/70 dark:text-orange-500/30 shrink-0" />}
                    </div>
                  ))}
                </div>
              </div>
            </Section>

            <Section icon={<Star className="w-4 h-4 text-orange-500" />} title="Key Facts & Proof Points" sub="Reference these in captions, bios, and sales decks">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {[
                  { fact: "Chic, curated, full service", note: "Brand description", icon: <Layers className="w-4 h-4 text-orange-500" /> },
                  { fact: "Hotels, transfers, airfare, tours", note: "Core service set", icon: <Zap className="w-4 h-4 text-yellow-600" /> },
                  { fact: "www.thereach.travel", note: "Website from intake", icon: <Globe className="w-4 h-4 text-orange-400" /> },
                  { fact: "Bhutan in June", note: "Scouting-trip content focus", icon: <Star className="w-4 h-4 text-yellow-600" /> },
                  { fact: "Switzerland in July", note: "Seasonal content focus", icon: <Phone className="w-4 h-4 text-orange-500" /> },
                  { fact: "Bookings", note: "Primary success metric", icon: <Clock className="w-4 h-4 text-yellow-500" /> },
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
