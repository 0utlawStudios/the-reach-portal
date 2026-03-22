"use client";

import { createContext, useContext, useState, useCallback, useMemo, useEffect, useRef, ReactNode } from "react";
import { loadState, saveState } from "./persistence";

export type Page = "dashboard" | "pipeline" | "calendar" | "preview" | "team" | "media" | "settings" | "brandkit";

interface NavigationContextType {
  currentPage: Page;
  sidebarCollapsed: boolean;
  pendingOpenPostId: string | null;
  navigate: (page: Page) => void;
  navigateToPost: (postId: string) => void;
  clearPendingPost: () => void;
  toggleSidebar: () => void;
}

const NavigationContext = createContext<NavigationContextType | null>(null);

const PAGE_KEY = "nav_page";
const SIDEBAR_KEY = "nav_sidebar";

export function NavigationProvider({ children }: { children: ReactNode }) {
  const [currentPage, setCurrentPage] = useState<Page>("dashboard");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [pendingOpenPostId, setPendingOpenPostId] = useState<string | null>(null);
  const hydrated = useRef(false);

  useEffect(() => {
    setCurrentPage(loadState<Page>(PAGE_KEY, "dashboard"));
    setSidebarCollapsed(loadState<boolean>(SIDEBAR_KEY, false));
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

  const clearPendingPost = useCallback(() => {
    setPendingOpenPostId(null);
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((p) => {
      const next = !p;
      saveState(SIDEBAR_KEY, next);
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ currentPage, sidebarCollapsed, pendingOpenPostId, navigate, navigateToPost, clearPendingPost, toggleSidebar }),
    [currentPage, sidebarCollapsed, pendingOpenPostId, navigate, navigateToPost, clearPendingPost, toggleSidebar]
  );

  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}

export function useNavigation() {
  const ctx = useContext(NavigationContext);
  if (!ctx) throw new Error("useNavigation must be used within NavigationProvider");
  return ctx;
}
