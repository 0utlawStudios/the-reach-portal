"use client";

import { RawImage } from "@/components/raw-image";
import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabaseClient";
import { NavigationProvider, useNavigation } from "@/lib/navigation-context";
import { PipelineProvider } from "@/lib/pipeline-context";
import { TeamProvider, useTeam } from "@/lib/team-context";
import { ThemeProvider } from "@/lib/theme-context";
import { ToastProvider } from "@/lib/toast-context";
import { LoginScreen } from "./login-screen";
import { ToastContainer } from "./toast-container";
import { TopBar } from "./top-bar";
import { KanbanBoard } from "./kanban-board";
import { AssetReviewDrawer } from "./asset-review-drawer";
import { CreatePostModal } from "./create-post-modal";
import { DashboardPage } from "./pages/dashboard-page";
import { PostPreviewPage } from "./pages/post-preview-page";
import { CalendarPage } from "./pages/calendar-page";
import { MediaPage } from "./pages/media-page";
import { SettingsPage } from "./pages/settings-page";
import { BrandKitPage } from "./pages/brand-kit-page";
import { StudioPage } from "./pages/studio-page";
import { RevisionModal } from "./revision-modal";
import { KickbackModal } from "./kickback-modal";
import {
  CalendarDays,
  ChevronLeft,
  Eye,
  FolderOpen,
  Kanban,
  LayoutDashboard,
  Palette,
  Pin,
  PinOff,
  Plus,
  Settings,
  Sparkles,
} from "lucide-react";

function PageContent() {
  const { currentPage } = useNavigation();
  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      {currentPage === "dashboard" && <DashboardPage />}
      {currentPage === "pipeline" && <KanbanBoard />}
      {currentPage === "studio" && <StudioPage />}
      {currentPage === "calendar" && <CalendarPage />}
      {currentPage === "preview" && <PostPreviewPage />}
      {currentPage === "media" && <MediaPage />}
      {currentPage === "brandkit" && <BrandKitPage />}
      {(currentPage === "team" || currentPage === "settings") && <SettingsPage />}
    </div>
  );
}

function DashboardLayout() {
  const [createOpen, setCreateOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <NavigationProvider>
      {/* ToastProvider must wrap PipelineProvider — pipeline-context calls
          useToast() to surface DB rollback errors. If ToastProvider sat
          inside PipelineProvider the useToast() hook would throw, which
          was the root cause of the cf20bbd "This page couldn't load"
          incident on 2026-05-13. */}
      <ToastProvider>
        <PipelineProvider>
          <TeamProvider>
            <AvatarSync />
            <div className="h-screen flex bg-[#fafbfc] dark:bg-[#0a0a0a] overflow-hidden">
              <Sidebar onCreatePost={() => setCreateOpen(true)} mobileOpen={mobileOpen} setMobileOpen={setMobileOpen} />
              <main className="flex-1 flex flex-col min-w-0">
                <TopBar onMenuClick={() => setMobileOpen(true)} />
                <PageContent />
                <div className="h-8 flex items-center justify-center border-t border-gray-100 dark:border-white/[0.04] bg-white dark:bg-[#111] shrink-0">
                  <p className="text-[10px] text-gray-300 dark:text-gray-600">Ten80Ten Social Media Management Platform &copy; 2026</p>
                </div>
              </main>
              <AssetReviewDrawer />
              <CreatePostModal open={createOpen} onClose={() => setCreateOpen(false)} />
              <RevisionModal />
              <KickbackModal />
              <ToastContainer />
            </div>
          </TeamProvider>
        </PipelineProvider>
      </ToastProvider>
    </NavigationProvider>
  );
}

// ─── Sidebar ───

function Sidebar({ onCreatePost, mobileOpen, setMobileOpen }: {
  onCreatePost: () => void;
  mobileOpen: boolean;
  setMobileOpen: (v: boolean) => void;
}) {
  const { currentPage, navigate, sidebarCollapsed, sidebarPinned, setSidebarCollapsed, togglePin } = useNavigation();
  const { currentUser } = useAuth();
  const studioRoles = ["superadmin", "admin", "owner", "creative_director", "social_media_specialist"];
  const inStudioRole = studioRoles.includes((currentUser.role || "").toLowerCase());

  // Email allowlist gate. Studio access is a two-layer check: role AND (allowlist absent OR email in list).
  // We fetch the live allowlist from /api/ai/studio/access so admins can adjust who sees the link
  // without redeploying. Hidden until we've confirmed — fail-closed prevents flashing the link
  // for users who don't have access.
  const [studioAccessConfirmed, setStudioAccessConfirmed] = useState(false);
  const [studioAccessAllowed, setStudioAccessAllowed] = useState(false);
  useEffect(() => {
    if (!inStudioRole) {
      setStudioAccessConfirmed(true);
      setStudioAccessAllowed(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) return;
        const res = await fetch("/api/ai/studio/access", { headers: { Authorization: `Bearer ${token}` } });
        const json = await res.json();
        if (cancelled) return;
        setStudioAccessAllowed(Boolean(json.data?.allowed));
      } catch {
        if (!cancelled) setStudioAccessAllowed(false);
      } finally {
        if (!cancelled) setStudioAccessConfirmed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [inStudioRole]);

  const canAccessStudio = inStudioRole && studioAccessConfirmed && studioAccessAllowed;
  const autoCollapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverExpandRef = useRef(false);
  // Auto-collapse after 6s on desktop (not mobile, not pinned)
  useEffect(() => {
    if (sidebarPinned) return;
    autoCollapseTimer.current = setTimeout(() => {
      setSidebarCollapsed(true);
    }, 6000);
    return () => { if (autoCollapseTimer.current) clearTimeout(autoCollapseTimer.current); };
  }, [sidebarPinned, setSidebarCollapsed]);

  // Desktop hover handlers
  const handleMouseEnter = () => {
    if (sidebarPinned) return;
    if (autoCollapseTimer.current) { clearTimeout(autoCollapseTimer.current); autoCollapseTimer.current = null; }
    if (sidebarCollapsed) { hoverExpandRef.current = true; setSidebarCollapsed(false); }
  };
  const handleMouseLeave = () => {
    if (sidebarPinned) return;
    if (hoverExpandRef.current) { hoverExpandRef.current = false; setSidebarCollapsed(true); }
  };

  const closeMobile = () => setMobileOpen(false);
  const handleNav = (page: string) => {
    navigate(page as import("@/lib/navigation-context").Page);
    closeMobile();
  };

  // Studio is shown to ALL signed-in users; the page itself renders a
  // greyed-out read-only preview with an "ask admin for access" banner when
  // canAccessStudio is false. See studio-page.tsx denied state for details.
  void canAccessStudio;
  const NAV_ITEMS = [
    { id: "dashboard", label: "Dashboard", icon: <LayoutDashboard className="w-4 h-4" />, section: "plan" },
    { id: "pipeline", label: "Content Engine", icon: <Kanban className="w-4 h-4" />, section: "plan" },
    { id: "studio", label: "Creator Studio", icon: <Sparkles className="w-4 h-4" />, section: "plan" },
    { id: "calendar", label: "Content Calendar", icon: <CalendarDays className="w-4 h-4" />, section: "plan" },
    { id: "preview", label: "Post Preview", icon: <Eye className="w-4 h-4" />, section: "publish" },
    { id: "media", label: "Media Library", icon: <FolderOpen className="w-4 h-4" />, section: "publish" },
    { id: "brandkit", label: "Brand Kit", icon: <Palette className="w-4 h-4" />, section: "publish" },
    { id: "settings", label: "Settings", icon: <Settings className="w-4 h-4" />, section: "manage" },
  ];

  const SECTIONS = [
    { key: "plan", label: "Plan & Create" },
    { key: "publish", label: "Publish" },
    { key: "manage", label: "Manage" },
  ];

  const sidebarContent = (isMobile: boolean) => {
    const expanded = isMobile || !sidebarCollapsed;
    return (
      <>
        {/* Logo */}
        <div className="relative flex items-center justify-center h-[60px] px-4 shrink-0">
          <RawImage src="/ten80ten-logo.png" alt="Ten80Ten" className={`${expanded ? "w-[48px]" : "w-7"} h-auto object-contain`} />
          {isMobile && (
            <button className="absolute right-3 p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-white/[0.06] text-gray-400 cursor-pointer" onClick={closeMobile}>
              <ChevronLeft className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Create */}
        {expanded ? (
          <div className="px-3 pt-1 pb-2">
            <button onClick={() => { onCreatePost(); if (isMobile) closeMobile(); }} className="w-full flex items-center justify-center gap-2 h-[36px] rounded-lg bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white text-[12px] font-semibold transition-all duration-150 cursor-pointer shadow-sm shadow-orange-500/20">
              <Plus className="w-3.5 h-3.5" />Create Post
            </button>
          </div>
        ) : (
          <div className="px-2 pt-1 pb-2">
            <button onClick={onCreatePost} className="w-full flex items-center justify-center h-[36px] rounded-lg bg-gradient-to-r from-orange-500 to-orange-600 text-white transition-colors cursor-pointer shadow-sm shadow-orange-500/20" title="Create Post">
              <Plus className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Nav */}
        <nav className="flex-1 pt-2 px-3 space-y-5 overflow-y-auto overflow-x-hidden">
          {SECTIONS.map((section) => {
            const items = NAV_ITEMS.filter((n) => n.section === section.key);
            return (
              <div key={section.key}>
                {expanded && <p className="px-2.5 mb-1.5 text-[9px] font-bold text-gray-400/60 dark:text-gray-600 tracking-[0.1em] uppercase">{section.label}</p>}
                {!expanded && <div className="w-5 mx-auto mb-2 border-t border-gray-100 dark:border-white/[0.06]" />}
                <div className="space-y-0.5">
                  {items.map((item) => {
                    const active = currentPage === item.id;
                    return (
                      <button key={item.id} onClick={() => handleNav(item.id)}
                        className={`w-full flex items-center gap-2.5 rounded-lg transition-all duration-150 cursor-pointer ${expanded ? "px-2.5 py-[8px]" : "justify-center px-0 py-2"} ${
                          active
                            ? "bg-orange-50 dark:bg-orange-500/10 text-orange-700 dark:text-orange-400 font-semibold"
                            : "text-gray-500 dark:text-gray-500 hover:text-gray-800 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/[0.03]"
                        }`}
                        title={!expanded ? item.label : undefined}>
                        <span className={`shrink-0 ${active ? "text-orange-600 dark:text-orange-400" : "text-gray-400 dark:text-gray-500"}`}>{item.icon}</span>
                        {expanded && <span className="text-[13px] truncate">{item.label}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        {/* Pin (desktop only) */}
        {!isMobile && (
          <div className="px-3 py-3 shrink-0 border-t border-gray-100 dark:border-white/[0.04]">
            <button onClick={togglePin} className={`w-full flex items-center gap-2 rounded-lg px-2.5 py-[7px] transition-all duration-150 cursor-pointer ${sidebarPinned ? "text-orange-500 bg-orange-50 dark:bg-orange-500/10 hover:bg-orange-100 dark:hover:bg-orange-500/15" : "text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/[0.03]"}`}>
              {!expanded ? (
                <Pin className="w-4 h-4 mx-auto" />
              ) : sidebarPinned ? (
                <><PinOff className="w-4 h-4" /><span className="text-[12px] font-medium">Unpin Sidebar</span></>
              ) : (
                <><Pin className="w-4 h-4" /><span className="text-[12px] font-medium">Pin Sidebar</span></>
              )}
            </button>
          </div>
        )}
      </>
    );
  };

  return (
    <>
      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 bg-black/40 z-30 transition-opacity" onClick={closeMobile} />
      )}

      {/* Mobile sidebar */}
      <aside className={`md:hidden fixed inset-y-0 left-0 z-40 w-[270px] bg-white dark:bg-[#0c0c0f] shadow-2xl flex flex-col transition-transform duration-250 ease-out ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}>
        {sidebarContent(true)}
      </aside>

      {/* Desktop sidebar */}
      <aside
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className={`hidden md:flex h-screen flex-col bg-white dark:bg-[#0c0c0f] shrink-0 overflow-hidden transition-[width] duration-200 ease-out shadow-[1px_0_0_rgba(0,0,0,0.04)] dark:shadow-[1px_0_0_rgba(255,255,255,0.04)] ${sidebarCollapsed ? "w-[56px]" : "w-[230px]"}`}
      >
        {sidebarContent(false)}
      </aside>
    </>
  );
}

/** Syncs the current user's avatar from team_members into auth context */
function AvatarSync() {
  const { currentUser, updateCurrentUserAvatar } = useAuth();
  const { members } = useTeam();
  useEffect(() => {
    const me = members.find((m) => m.email === currentUser.email);
    if (me?.avatar && me.avatar !== currentUser.avatar) {
      updateCurrentUserAvatar(me.avatar);
    }
  }, [members, currentUser.email, currentUser.avatar, updateCurrentUserAvatar]);
  return null;
}

export function AppShell() {
  const { isAuthenticated, currentUser } = useAuth();
  if (!isAuthenticated) return <LoginScreen />;
  return <ThemeProvider email={currentUser.email}><DashboardLayout /></ThemeProvider>;
}
