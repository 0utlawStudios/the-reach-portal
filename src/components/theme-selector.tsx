"use client";

import { useDesignTheme, DesignTheme } from "@/lib/theme-engine";
import { Layers, Sparkles, Box, Droplets, Zap, Check } from "lucide-react";

const THEMES: { id: DesignTheme; label: string; desc: string; icon: typeof Layers; preview: string; previewDark: string }[] = [
  {
    id: "default",
    label: "Clean",
    desc: "Minimal & professional",
    icon: Layers,
    preview: "bg-white border-gray-200",
    previewDark: "dark:bg-[#151518] dark:border-white/[0.08]",
  },
  {
    id: "glass",
    label: "Glassmorphism",
    desc: "Frosted glass & blur",
    icon: Sparkles,
    preview: "bg-blue-100/40 border-white/50 backdrop-blur-sm",
    previewDark: "dark:bg-blue-900/20 dark:border-white/15",
  },
  {
    id: "skeuomorphic",
    label: "Skeuomorphic",
    desc: "Tactile depth & texture",
    icon: Box,
    preview: "bg-gradient-to-b from-white to-gray-100 border-gray-300 shadow-md",
    previewDark: "dark:from-slate-700 dark:to-slate-800 dark:border-slate-600",
  },
  {
    id: "liquid",
    label: "Liquid Glass",
    desc: "Organic macOS fluidity",
    icon: Droplets,
    preview: "bg-purple-100/30 border-white/40 backdrop-blur-sm rounded-2xl",
    previewDark: "dark:bg-purple-900/15 dark:border-white/10",
  },
  {
    id: "brutalism",
    label: "Neobrutalism",
    desc: "Bold & aggressive",
    icon: Zap,
    preview: "bg-amber-100 border-[3px] border-black shadow-[4px_4px_0px_#000]",
    previewDark: "dark:bg-slate-800 dark:border-slate-300 dark:shadow-[4px_4px_0px_#e2e8f0]",
  },
];

export function ThemeSelector() {
  const { theme, setTheme } = useDesignTheme();

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-4">
        <Layers className="w-4 h-4 text-orange-500" />
        <h3 className="text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-[0.08em]">Design Engine</h3>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {THEMES.map((t) => {
          const active = theme === t.id;
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setTheme(t.id)}
              className={`
                relative group p-4 rounded-xl border-2 cursor-pointer transition-all duration-200
                ${active
                  ? "border-orange-500 bg-orange-50/50 dark:bg-orange-500/5 ring-2 ring-orange-200 dark:ring-orange-500/20"
                  : "border-gray-200 dark:border-white/[0.08] hover:border-gray-300 dark:hover:border-white/[0.15] bg-white dark:bg-white/[0.02]"
                }
              `}
            >
              {/* Active check */}
              {active && (
                <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-orange-500 flex items-center justify-center">
                  <Check className="w-3 h-3 text-white" />
                </div>
              )}

              {/* Preview swatch */}
              <div className={`w-full h-10 rounded-lg border mb-3 ${t.preview} ${t.previewDark} transition-all`} />

              {/* Label */}
              <div className="flex items-center gap-1.5 mb-1">
                <Icon className={`w-3.5 h-3.5 ${active ? "text-orange-500" : "text-gray-400 dark:text-gray-500"}`} />
                <span className={`text-[12px] font-bold ${active ? "text-orange-600 dark:text-orange-400" : "text-gray-700 dark:text-gray-300"}`}>
                  {t.label}
                </span>
              </div>
              <p className="text-[10px] text-gray-400 dark:text-gray-500 leading-snug">{t.desc}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
