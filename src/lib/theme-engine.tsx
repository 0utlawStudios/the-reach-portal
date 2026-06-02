"use client";

import { createContext, useContext, useState, useEffect, useCallback } from "react";

export type DesignTheme = "default" | "glass" | "clay" | "liquid" | "brutalism";

interface ThemeEngineCtx {
  theme: DesignTheme;
  setTheme: (t: DesignTheme) => void;
}

const Ctx = createContext<ThemeEngineCtx>({ theme: "default", setTheme: () => {} });

const STORAGE_KEY = "reach_design_theme";
const THEMES: DesignTheme[] = ["default", "glass", "clay", "liquid", "brutalism"];

function loadInitialTheme(): DesignTheme {
  if (typeof window === "undefined") return "default";
  const stored = localStorage.getItem(STORAGE_KEY) as DesignTheme | null;
  return stored && THEMES.includes(stored) ? stored : "default";
}

export function ThemeEngineProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<DesignTheme>(loadInitialTheme);

  // Hydrate from localStorage on mount
  useEffect(() => {
    document.documentElement.setAttribute("data-design", theme);
  }, [theme]);

  const setTheme = useCallback((t: DesignTheme) => {
    setThemeState(t);
    localStorage.setItem(STORAGE_KEY, t);
    // Single DOM write — triggers CSS cascade instantly, zero React re-renders in children
    document.documentElement.setAttribute("data-design", t);
  }, []);

  return <Ctx.Provider value={{ theme, setTheme }}>{children}</Ctx.Provider>;
}

export const useDesignTheme = () => useContext(Ctx);
