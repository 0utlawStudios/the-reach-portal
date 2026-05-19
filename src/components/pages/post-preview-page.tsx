"use client";

import { RawImage } from "@/components/raw-image";
import { useState, useMemo } from "react";
import { usePipeline } from "@/lib/pipeline-context";
import { ContentCard, Platform, ALL_PLATFORMS } from "@/lib/types";
import { PlatformIcon } from "@/components/platform-icons";
import { Heart, MessageCircle, Send, Bookmark, MoreHorizontal, ThumbsUp, Share2, Play, Filter } from "lucide-react";

// ─── Platform Preview Components ───
function InstagramPreview({ card }: { card: ContentCard }) {
  return (
    <div className="max-w-full overflow-x-auto"><div className="w-full max-w-[400px] mx-auto bg-white rounded-xl overflow-hidden border border-gray-200 shadow-lg">
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <div className="w-8 h-8 rounded-full bg-white ring-1 ring-gray-200 overflow-hidden flex items-center justify-center shrink-0">
          <RawImage src="/ten80ten-logo.png" alt="Ten80Ten" className="w-[80%] h-[80%] object-contain" />
        </div>
        <div className="flex-1"><p className="text-[11px] font-semibold text-gray-900" style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>ten80ten</p><p className="text-[10px] text-gray-400">Sponsored</p></div>
        <MoreHorizontal className="w-4 h-4 text-gray-400" />
      </div>
      <div className="aspect-square w-full bg-gray-100"><RawImage src={card.thumbnailUrl} alt="" className="w-full h-full object-cover" /></div>
      <div className="px-3 py-2.5">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-4"><Heart className="w-[22px] h-[22px] text-gray-900" /><MessageCircle className="w-[22px] h-[22px] text-gray-900" /><Send className="w-[22px] h-[22px] text-gray-900" /></div>
          <Bookmark className="w-[22px] h-[22px] text-gray-900" />
        </div>
        <p className="text-[12px] font-semibold text-gray-900 mb-0.5" style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>2,847 likes</p>
        <p className="text-[12px] text-gray-900 leading-relaxed" style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>
          <span className="font-semibold">ten80ten</span>{" "}{card.caption || "No caption yet..."}
        </p>
      </div>
    </div></div>
  );
}

function FacebookPreview({ card }: { card: ContentCard }) {
  return (
    <div className="max-w-full overflow-x-auto"><div className="w-full max-w-[400px] mx-auto bg-white rounded-xl overflow-hidden border border-gray-200 shadow-lg">
      <div className="p-3 flex items-center gap-2.5">
        <div className="w-10 h-10 rounded-full bg-white ring-1 ring-gray-200 overflow-hidden flex items-center justify-center shrink-0">
          <RawImage src="/ten80ten-logo.png" alt="Ten80Ten" className="w-[80%] h-[80%] object-contain" />
        </div>
        <div><p className="text-[13px] font-semibold text-gray-900">Ten80Ten</p><p className="text-[11px] text-gray-500">Just now · 🌍</p></div>
      </div>
      <p className="px-3 pb-2 text-[13px] text-gray-800 leading-relaxed">{card.caption || "No caption..."}</p>
      <div className="aspect-video w-full bg-gray-100"><RawImage src={card.thumbnailUrl} alt="" className="w-full h-full object-cover" /></div>
      <div className="px-3 py-1 border-t border-gray-100 flex items-center justify-between text-[12px] text-gray-500">
        <span>👍 142</span><span>23 comments · 8 shares</span>
      </div>
      <div className="px-3 py-1.5 border-t border-gray-100">
        <div className="flex items-center justify-around">
          {[{ icon: ThumbsUp, label: "Like" }, { icon: MessageCircle, label: "Comment" }, { icon: Share2, label: "Share" }].map(({ icon: Icon, label }) => (
            <button key={label} className="flex items-center gap-2 text-[13px] text-gray-600 font-medium py-1.5 px-4 rounded-md hover:bg-gray-50 cursor-pointer"><Icon className="w-5 h-5" />{label}</button>
          ))}
        </div>
      </div>
    </div></div>
  );
}

function YouTubePreview({ card }: { card: ContentCard }) {
  return (
    <div className="max-w-full overflow-x-auto"><div className="w-full max-w-[400px] mx-auto bg-white rounded-xl overflow-hidden border border-gray-200 shadow-lg">
      <div className="aspect-video w-full bg-black relative"><RawImage src={card.thumbnailUrl} alt="" className="w-full h-full object-cover" />
        <div className="absolute inset-0 flex items-center justify-center"><div className="w-16 h-11 rounded-xl bg-red-600/90 flex items-center justify-center"><Play className="w-6 h-6 text-white ml-0.5" /></div></div>
        <div className="absolute bottom-2 right-2 bg-black/80 text-white text-[10px] px-1.5 py-0.5 rounded font-medium">3:42</div>
      </div>
      <div className="p-3 flex gap-3">
        <div className="w-9 h-9 rounded-full bg-white ring-1 ring-gray-200 overflow-hidden flex items-center justify-center shrink-0">
          <RawImage src="/ten80ten-logo.png" alt="Ten80Ten" className="w-[80%] h-[80%] object-contain" />
        </div>
        <div><p className="text-[13px] font-medium text-gray-900 line-clamp-2 leading-tight">{card.title}</p><p className="text-[11px] text-gray-500 mt-1">Ten80Ten · 1.2K views · 2 hours ago</p></div>
      </div>
    </div></div>
  );
}

function LinkedInPreview({ card }: { card: ContentCard }) {
  return (
    <div className="max-w-full overflow-x-auto"><div className="w-full max-w-[400px] mx-auto bg-white rounded-xl overflow-hidden border border-gray-200 shadow-lg">
      <div className="p-3 flex items-center gap-3">
        <div className="w-12 h-12 rounded-full bg-white ring-1 ring-gray-200 overflow-hidden flex items-center justify-center shrink-0">
          <RawImage src="/ten80ten-logo.png" alt="Ten80Ten" className="w-[80%] h-[80%] object-contain" />
        </div>
        <div><p className="text-[13px] font-semibold text-gray-900">Ten80Ten</p><p className="text-[11px] text-gray-500">2,400 followers · 2h</p></div>
      </div>
      <p className="px-3 pb-2 text-[13px] text-gray-800 leading-relaxed">{card.caption || "No caption..."}</p>
      <div className="aspect-video w-full bg-gray-100"><RawImage src={card.thumbnailUrl} alt="" className="w-full h-full object-cover" /></div>
      <div className="px-3 py-1 border-t border-gray-100 flex items-center gap-2 text-[11px] text-gray-500"><span>👍 86</span><span>·</span><span>14 comments</span></div>
      <div className="px-3 py-1.5 border-t border-gray-100">
        <div className="flex items-center justify-around">
          {[{ icon: ThumbsUp, label: "Like" }, { icon: MessageCircle, label: "Comment" }, { icon: Share2, label: "Repost" }, { icon: Send, label: "Send" }].map(({ icon: Icon, label }) => (
            <button key={label} className="flex items-center gap-1.5 text-[11px] text-gray-600 font-medium py-1.5 px-3 rounded-md hover:bg-gray-50 cursor-pointer"><Icon className="w-4 h-4" />{label}</button>
          ))}
        </div>
      </div>
    </div></div>
  );
}

function TikTokPreview({ card }: { card: ContentCard }) {
  return (
    <div className="max-w-full overflow-x-auto"><div className="w-full max-w-[290px] mx-auto h-[500px] bg-black rounded-[2rem] overflow-hidden border-[3px] border-gray-800 shadow-lg relative">
      <RawImage src={card.thumbnailUrl} alt="" className="w-full h-full object-cover" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
      {/* TikTok UI overlay */}
      <div className="absolute bottom-0 left-0 right-14 p-4">
        <p className="text-[13px] font-bold text-white mb-1">@teneightyten</p>
        <p className="text-[11px] text-white/90 line-clamp-3 leading-relaxed">{card.caption || "No caption..."}</p>
        <div className="flex items-center gap-2 mt-2"><div className="w-4 h-4 rounded-full bg-white/20" /><p className="text-[10px] text-white/70">Original Sound - Ten80Ten</p></div>
      </div>
      <div className="absolute right-3 bottom-20 flex flex-col items-center gap-5">
        {[{ icon: Heart, label: "24.5K" }, { icon: MessageCircle, label: "312" }, { icon: Bookmark, label: "1.2K" }, { icon: Share2, label: "489" }].map(({ icon: Icon, label }) => (
          <div key={label} className="flex flex-col items-center gap-1"><Icon className="w-6 h-6 text-white drop-shadow-lg" /><span className="text-[10px] text-white/80 font-medium">{label}</span></div>
        ))}
      </div>
      {/* Notch */}
      <div className="absolute top-2 left-1/2 -translate-x-1/2 w-20 h-5 bg-black rounded-full" />
    </div></div>
  );
}

const previewComponents: Record<Platform, (c: ContentCard) => React.ReactNode> = {
  instagram: (c) => <InstagramPreview card={c} />,
  facebook: (c) => <FacebookPreview card={c} />,
  tiktok: (c) => <TikTokPreview card={c} />,
  youtube: (c) => <YouTubePreview card={c} />,
  linkedin: (c) => <LinkedInPreview card={c} />,
};

// ─── Main Page ───
export function PostPreviewPage() {
  const { cards } = usePipeline();
  const [platformFilter, setPlatformFilter] = useState<Platform | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Platform>("instagram");

  const previewableCards = useMemo(() => {
    let filtered = [...cards];
    if (platformFilter !== "all") filtered = filtered.filter((c) => c.platforms.includes(platformFilter));
    return filtered;
  }, [cards, platformFilter]);

  const selectedCard = cards.find((c) => c.id === selectedId) || (previewableCards[0] || null);

  return (
    <div className="flex h-full flex-col md:flex-row">
      {/* Posts list — left panel */}
      <div className="w-full md:w-[280px] border-b md:border-b-0 md:border-r border-gray-100 dark:border-white/[0.06] bg-white dark:bg-[#111] flex flex-col shrink-0">
        {/* Filter header */}
        <div className="p-3 border-b border-gray-100 dark:border-white/[0.06] space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-[12px] font-bold text-gray-700 dark:text-gray-300">Posts</h2>
            <span className="text-[10px] text-gray-400">{previewableCards.length} results</span>
          </div>
          <div className="flex flex-wrap gap-1">
            <button onClick={() => setPlatformFilter("all")} className={`px-2.5 py-1 rounded-lg text-[10px] font-medium cursor-pointer transition-all duration-200 ${platformFilter === "all" ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900 shadow-sm" : "bg-gray-100 dark:bg-white/[0.04] text-gray-500 hover:bg-gray-200 dark:hover:bg-white/[0.08]"}`}>All</button>
            {ALL_PLATFORMS.map((p) => (
              <button key={p.id} onClick={() => setPlatformFilter(p.id)} className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-medium cursor-pointer transition-all duration-200 ${platformFilter === p.id ? "bg-blue-600 text-white shadow-sm" : "bg-gray-100 dark:bg-white/[0.04] text-gray-500 hover:bg-gray-200 dark:hover:bg-white/[0.08]"}`}>
                <PlatformIcon platform={p.id} className="w-3 h-3" />{p.label}
              </button>
            ))}
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-2">
          {previewableCards.map((card) => {
            const isActive = selectedCard?.id === card.id;
            return (
              <button key={card.id} onClick={() => { setSelectedId(card.id); setActiveTab(card.platforms[0]); }}
                className={`w-full flex items-center gap-3 p-3 rounded-xl text-left cursor-pointer mb-1 transition-all duration-200 ${isActive
                  ? "bg-blue-50 dark:bg-blue-500/10 border-l-4 border-l-blue-600 shadow-sm"
                  : "hover:bg-gray-50 dark:hover:bg-white/[0.03] border-l-4 border-l-transparent"
                }`}>
                <RawImage src={card.thumbnailUrl} alt="" className="w-12 h-12 rounded-xl object-cover shrink-0 shadow-sm" />
                <div className="flex-1 min-w-0">
                  <p className={`text-[12px] font-medium line-clamp-2 leading-tight ${isActive ? "text-blue-900 dark:text-blue-200" : "text-gray-700 dark:text-gray-300"}`}>{card.title}</p>
                  <div className="flex items-center gap-1.5 mt-1.5">
                    {card.platforms.map((p) => <span key={p} className="text-gray-400"><PlatformIcon platform={p} className="w-3 h-3" /></span>)}
                  </div>
                </div>
              </button>
            );
          })}
          {previewableCards.length === 0 && <p className="text-[11px] text-gray-400 text-center py-8">No posts match this filter</p>}
        </div>
      </div>

      {/* Preview studio — right pane */}
      <div className="flex-1 flex flex-col min-w-0">
        {selectedCard ? (
          <>
            {/* Segmented control */}
            <div className="flex items-center justify-center px-5 pt-4 pb-3 bg-white dark:bg-[#111] border-b border-gray-100 dark:border-white/[0.06] shrink-0">
              <div className="inline-flex items-center bg-gray-100 dark:bg-white/[0.06] rounded-xl p-1 gap-0.5">
                {ALL_PLATFORMS.filter((p) => selectedCard.platforms.includes(p.id)).map((p) => (
                  <button key={p.id} onClick={() => setActiveTab(p.id)}
                    className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-[12px] font-medium cursor-pointer transition-all duration-200 ${activeTab === p.id
                      ? "bg-white dark:bg-[#151518] text-gray-900 dark:text-white shadow-sm"
                      : "text-gray-500 dark:text-gray-400 hover:text-gray-700"
                    }`}>
                    <PlatformIcon platform={p.id} className="w-4 h-4" /><span className="hidden sm:inline">{p.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Studio canvas */}
            <div className="flex-1 flex items-center justify-center p-6 overflow-y-auto" style={{
              background: "radial-gradient(circle at 50% 50%, rgba(99,102,241,0.03) 0%, transparent 70%), radial-gradient(rgba(0,0,0,0.02) 1px, transparent 1px)",
              backgroundSize: "100% 100%, 20px 20px",
            }}>
              <div className="flex flex-col items-center gap-6">
                {/* Device frame for TikTok, plain for others */}
                <div className={activeTab === "tiktok" ? "" : "transform scale-[1.02]"}>
                  {previewComponents[activeTab]?.(selectedCard)}
                </div>

                <p className="text-[9px] text-gray-400/60 uppercase tracking-[0.2em] font-medium">
                  Visual Mockup — Actual rendering may vary by platform
                </p>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center" style={{ background: "radial-gradient(circle, rgba(99,102,241,0.03) 0%, transparent 70%)" }}>
            <div className="text-center">
              <div className="w-12 h-12 rounded-2xl bg-gray-100 dark:bg-white/[0.04] flex items-center justify-center mx-auto mb-3"><Filter className="w-5 h-5 text-gray-400" /></div>
              <p className="text-[14px] text-gray-500 font-medium">Select a post to preview</p>
              <p className="text-[12px] text-gray-400 mt-1">Choose from the list on the left</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
