"use client";

import { createContext, useContext, useState, useCallback, useMemo, useEffect, useRef, ReactNode } from "react";
import { loadState, saveState } from "./persistence";

export type Page = "dashboard" | "pipeline" | "calendar" | "preview" | "team" | "media" | "settings" | "brandkit" | "studio";

interface NavigationContextType {
  currentPage: Page;
  sidebarCollapsed: boolean;
  sidebarPinned: boolean;
  pendingOpenPostId: string | null;
  navigate: (page: Page) => void;
  navigateToPost: (postId: string) => void;
  clearPendingPost: () => void;
  toggleSidebar: () => void;
  setSidebarCollapsed: (v: boolean) => void;
  togglePin: () => void;
}

const NavigationContext = createContext<NavigationContextType | null>(null);

const PAGE_KEY = "nav_page";
const SIDEBAR_KEY = "nav_sidebar";
const PIN_KEY = "nav_sidebar_pinned";

export function NavigationProvider({ children }: { children: ReactNode }) {
  const [currentPage, setCurrentPage] = useState<Page>(() => loadState<Page>(PAGE_KEY, "dashboard"));
  const [sidebarCollapsed, setSidebarCollapsedState] = useState(() => loadState<boolean>(PIN_KEY, false) ? false : loadState<boolean>(SIDEBAR_KEY, false));
  const [sidebarPinned, setSidebarPinned] = useState(() => loadState<boolean>(PIN_KEY, false));
  const [pendingOpenPostId, setPendingOpenPostId] = useState<string | null>(null);
  const hydrated = useRef(false);

  useEffect(() => {
    hydrated.current = true;
  }, []);

  const navigate = useCallback((page: Page) => {
    setCurrentPage(page);
    saveState(PAGE_KEY, page);
  }, []);

  const navigateToPost = useCallback((postId: string) => {
    setPendingOpenPostId(postId);
    setCurrentPage("pipeline");
    saveState(PAGE_KEY, "pipeline");
  }, []);

  const clearPendingPost = useCallback(() => { setPendingOpenPostId(null); }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsedState((p) => {
      const next = !p;
      saveState(SIDEBAR_KEY, next);
      return next;
    });
  }, []);

  const setSidebarCollapsed = useCallback((v: boolean) => {
    setSidebarCollapsedState(v);
    saveState(SIDEBAR_KEY, v);
  }, []);

  const togglePin = useCallback(() => {
    setSidebarPinned((p) => {
      const next = !p;
      saveState(PIN_KEY, next);
      if (next) {
        setSidebarCollapsedState(false);
        saveState(SIDEBAR_KEY, false);
      }
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ currentPage, sidebarCollapsed, sidebarPinned, pendingOpenPostId, navigate, navigateToPost, clearPendingPost, toggleSidebar, setSidebarCollapsed, togglePin }),
    [currentPage, sidebarCollapsed, sidebarPinned, pendingOpenPostId, navigate, navigateToPost, clearPendingPost, toggleSidebar, setSidebarCollapsed, togglePin]
  );

  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}

export function useNavigation() {
  const ctx = useContext(NavigationContext);
  if (!ctx) throw new Error("useNavigation must be used within NavigationProvider");
  return ctx;
}
