"use client";

import { createContext, useContext, useState, useCallback, useMemo, useEffect, ReactNode } from "react";
import { supabase } from "./supabaseClient";

type Theme = "light" | "dark";

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | null>(null);
const STORAGE_KEY = "reach_theme_preference";

function isSupabaseConfigured(): boolean {
  return !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export function ThemeProvider({ children, email }: { children: ReactNode; email?: string }) {
  const [theme, setTheme] = useState<Theme>(() => {
    // Default to Reach light mode unless this app has an explicit saved preference.
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(STORAGE_KEY) as Theme | null;
      if (saved === "light" || saved === "dark") return saved;
    }
    return "light";
  });

  // Fetch per-user theme preference from Supabase when email is provided
  useEffect(() => {
    if (!email || !isSupabaseConfigured()) return;
    let cancelled = false;

    supabase
      .from("team_members")
      .select("theme_preference")
      .eq("email", email)
      .single()
      .then(({ data }) => {
        if (!cancelled && data?.theme_preference) {
          const pref = data.theme_preference as Theme;
          if (pref === "light" || pref === "dark") {
            setTheme(pref);
            localStorage.setItem(STORAGE_KEY, pref);
          }
        }
      });

    return () => { cancelled = true; };
  }, [email]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((t) => {
      const next = t === "light" ? "dark" : "light";
      localStorage.setItem(STORAGE_KEY, next);

      // Persist to Supabase per-user if email is available
      if (email && isSupabaseConfigured()) {
        supabase
          .from("team_members")
          .update({ theme_preference: next })
          .eq("email", email)
          .then(() => {});
      }

      return next;
    });
  }, [email]);

  const value = useMemo(() => ({ theme, toggleTheme }), [theme, toggleTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
