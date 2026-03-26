"use client";

import { createContext, useContext, useState, useEffect, useCallback } from "react";

export type DesignTheme = "default" | "glass" | "clay" | "liquid" | "brutalism";

interface ThemeEngineCtx {
  theme: DesignTheme;
  setTheme: (t: DesignTheme) => void;
}

const Ctx = createContext<ThemeEngineCtx>({ theme: "default", setTheme: () => {} });

const STORAGE_KEY = "t10_design_theme";

export function ThemeEngineProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<DesignTheme>("default");

  // Hydrate from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as DesignTheme | null;
    if (stored && ["default", "glass", "clay", "liquid", "brutalism"].includes(stored)) {
      setThemeState(stored);
      document.documentElement.setAttribute("data-design", stored);
    }
  }, []);

  const setTheme = useCallback((t: DesignTheme) => {
    setThemeState(t);
    localStorage.setItem(STORAGE_KEY, t);
    // Single DOM write — triggers CSS cascade instantly, zero React re-renders in children
    document.documentElement.setAttribute("data-design", t);
  }, []);

  return <Ctx.Provider value={{ theme, setTheme }}>{children}</Ctx.Provider>;
}

export const useDesignTheme = () => useContext(Ctx);
