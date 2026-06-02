"use client";

import { useState, useEffect, useRef } from "react";
import { ReachWordmark } from "@/components/reach-wordmark";
import { useAuth } from "@/lib/auth-context";
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
import { RevisionModal } from "./revision-modal";
import { KickbackModal } from "./kickback-modal";
import { SupportWidget } from "./support/support-widget";
import { SupportInbox } from "./support/support-inbox";
import { useSupportAlert } from "@/lib/support/use-support-alert";
import {
  CalendarDays,
  ChevronLeft,
  Eye,
  FolderOpen,
  Inbox,
  Kanban,
  LayoutDashboard,
  Loader2,
  Lock,
  Palette,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  Settings,
} from "lucide-react";

function PageContent() {
  const { currentPage } = useNavigation();
  const { currentUser } = useAuth();
  const isSuperadmin = (currentUser.role || "").toLowerCase() === "superadmin";
  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      {currentPage === "dashboard" && <DashboardPage />}
      {currentPage === "pipeline" && <KanbanBoard />}
      {currentPage === "calendar" && <CalendarPage />}
      {currentPage === "preview" && <PostPreviewPage />}
      {currentPage === "media" && <MediaPage />}
      {currentPage === "brandkit" && <BrandKitPage />}
      {currentPage === "support" && (isSuperadmin ? <SupportInboxPage /> : <DashboardPage />)}
      {(currentPage === "team" || currentPage === "settings") && <SettingsPage />}
    </div>
  );
}

function SupportInboxPage() {
  return (
    <div className="mx-auto w-full max-w-[1180px] px-3 py-4 sm:px-5 sm:py-5 lg:px-6">
      <div className="mb-4">
        <h1 className="text-[18px] font-bold tracking-[-0.02em] text-gray-900 dark:text-white">Support Inbox</h1>
        <p className="mt-0.5 text-[13px] text-gray-400">Tickets and live chat from the workspace</p>
      </div>
      <SupportInbox />
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
            <div className="h-dvh flex bg-[#E1DFD5] dark:bg-[#0a0a0a] overflow-hidden">
              <Sidebar onCreatePost={() => setCreateOpen(true)} mobileOpen={mobileOpen} setMobileOpen={setMobileOpen} />
              <main className="flex-1 flex flex-col min-w-0">
                <TopBar onMenuClick={() => setMobileOpen(true)} />
                <PageContent />
                <div className="h-8 flex items-center justify-center border-t border-[#6C655A]/15 dark:border-white/[0.04] bg-[#E1DFD5] dark:bg-[#111] shrink-0">
                  <p className="text-[10px] text-[#6C655A]/70 dark:text-gray-600">The Reach &copy; 2026</p>
                </div>
              </main>
              <AssetReviewDrawer />
              <CreatePostModal open={createOpen} onClose={() => setCreateOpen(false)} />
              <RevisionModal />
              <KickbackModal />
              <SupportWidget />
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
  const isSuperadmin = (currentUser.role || "").toLowerCase() === "superadmin";
  const supportAlert = useSupportAlert(isSuperadmin);
  const hoverExpandRef = useRef(false);

  // Desktop hover handlers
  const handleMouseEnter = () => {
    if (sidebarPinned) return;
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

  const NAV_ITEMS = [
    { id: "dashboard", label: "Dashboard", icon: <LayoutDashboard className="w-4 h-4" />, section: "plan" },
    { id: "pipeline", label: "Content Pipeline", icon: <Kanban className="w-4 h-4" />, section: "plan" },
    { id: "calendar", label: "Content Calendar", icon: <CalendarDays className="w-4 h-4" />, section: "plan" },
    { id: "preview", label: "Post Preview", icon: <Eye className="w-4 h-4" />, section: "publish" },
    { id: "media", label: "Media Library", icon: <FolderOpen className="w-4 h-4" />, section: "publish" },
    { id: "brandkit", label: "Brand Kit", icon: <Palette className="w-4 h-4" />, section: "publish" },
    ...(isSuperadmin ? [{ id: "support", label: "Support Inbox", icon: <Inbox className="w-4 h-4" />, section: "manage", alert: supportAlert.hasAlert }] : []),
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
          {expanded ? (
            <ReachWordmark className="h-[13px] w-[150px] text-[#E1DFD5]" />
          ) : (
            <span className="font-heading text-[17px] font-semibold text-[#E1DFD5] tracking-[0.22em]" aria-label="The Reach">R</span>
          )}
          {isMobile && (
            <button className="absolute right-3 p-1.5 rounded-lg hover:bg-[#E1DFD5]/[0.10] dark:hover:bg-white/[0.06] text-[#E1DFD5]/[0.70] cursor-pointer" onClick={closeMobile}>
              <ChevronLeft className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Create */}
        {expanded ? (
          <div className="px-3 pt-1 pb-2">
            <button onClick={() => { onCreatePost(); if (isMobile) closeMobile(); }} className="w-full flex items-center justify-center gap-2 h-[36px] rounded-lg bg-[#975428] hover:bg-[#975428]/90 text-[#E1DFD5] text-[12px] font-semibold transition-all duration-150 cursor-pointer shadow-sm shadow-[#975428]/20">
              <Plus className="w-3.5 h-3.5" />Create Post
            </button>
          </div>
        ) : (
          <div className="px-2 pt-1 pb-2">
            <button onClick={onCreatePost} className="w-full flex items-center justify-center h-[36px] rounded-lg bg-[#975428] text-[#E1DFD5] transition-colors cursor-pointer shadow-sm shadow-[#975428]/20" title="Create Post">
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
                {expanded && <p className="px-2.5 mb-1.5 text-[9px] font-bold text-[#E1DFD5]/[0.50] dark:text-gray-600 tracking-[0.1em] uppercase">{section.label}</p>}
                {!expanded && <div className="w-5 mx-auto mb-2 border-t border-[#E1DFD5]/[0.15] dark:border-white/[0.06]" />}
                <div className="space-y-0.5">
                  {items.map((item) => {
                    const active = currentPage === item.id;
                    return (
                      <button key={item.id} onClick={() => handleNav(item.id)}
                        className={`relative w-full flex items-center gap-2.5 rounded-lg transition-all duration-150 cursor-pointer ${expanded ? "px-2.5 py-[8px]" : "justify-center px-0 py-2"} ${
                          active
                            ? "bg-[#E1DFD5]/[0.14] dark:bg-orange-500/10 text-[#E1DFD5] dark:text-orange-400 font-semibold"
                            : "text-[#E1DFD5]/[0.65] dark:text-gray-500 hover:text-[#E1DFD5] dark:hover:text-gray-300 hover:bg-[#E1DFD5]/[0.08] dark:hover:bg-white/[0.03]"
                        }`}
                        title={!expanded ? item.label : undefined}>
                        <span className={`shrink-0 ${active ? "text-[#E1DFD5] dark:text-orange-400" : "text-[#E1DFD5]/[0.55] dark:text-gray-500"}`}>{item.icon}</span>
                        {expanded && <span className="text-[13px] truncate">{item.label}</span>}
                        {"alert" in item && item.alert && (
                          <span
                            aria-hidden="true"
                            className={`${expanded ? "ml-auto" : "absolute right-1.5 top-1.5"} h-1.5 w-1.5 rounded-full bg-[#975428] shadow-[0_0_0_2px_rgba(151,84,40,0.18)] animate-pulse`}
                          />
                        )}
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
          <div className="px-3 py-3 shrink-0 border-t border-[#E1DFD5]/[0.15] dark:border-white/[0.04]">
            <button onClick={togglePin} className={`w-full flex items-center gap-2 rounded-lg px-2.5 py-[7px] transition-all duration-150 cursor-pointer ${sidebarPinned ? "text-[#E1DFD5] bg-[#E1DFD5]/[0.12] dark:bg-orange-500/10 hover:bg-[#E1DFD5]/[0.16] dark:hover:bg-orange-500/15" : "text-[#E1DFD5]/[0.55] hover:text-[#E1DFD5] dark:hover:text-gray-300 hover:bg-[#E1DFD5]/[0.08] dark:hover:bg-white/[0.03]"}`}>
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
      <aside className={`md:hidden fixed inset-y-0 left-0 z-40 w-[270px] bg-[#6C655A] dark:bg-[#0c0c0f] shadow-2xl flex flex-col transition-transform duration-250 ease-out ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}>
        {sidebarContent(true)}
      </aside>

      {/* Desktop sidebar */}
      <aside
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className={`hidden md:flex h-dvh flex-col bg-[#6C655A] dark:bg-[#0c0c0f] shrink-0 overflow-hidden transition-[width] duration-200 ease-out shadow-[1px_0_0_rgba(108,101,90,0.28)] dark:shadow-[1px_0_0_rgba(255,255,255,0.04)] ${sidebarCollapsed ? "w-[56px]" : "w-[230px]"}`}
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
  const { isAuthenticated, currentUser, provisionStatus, provisionMessage, logout } = useAuth();
  if (!isAuthenticated) return <LoginScreen />;
  if (provisionStatus !== "active") {
    return (
      <div className="min-h-dvh bg-[#09090b] flex items-center justify-center p-4">
        <div className="w-full max-w-[420px] rounded-2xl border border-white/[0.08] bg-[#131316] p-6 text-center shadow-2xl">
          <div className="w-12 h-12 mx-auto rounded-xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center mb-4">
            {provisionStatus === "unknown" ? (
              <Loader2 className="w-5 h-5 text-orange-400 animate-spin" />
            ) : (
              <Lock className="w-5 h-5 text-orange-400" />
            )}
          </div>
          <h1 className="text-[17px] font-bold text-white">
            {provisionStatus === "unknown" ? "Checking workspace access" : "Workspace access not active"}
          </h1>
          <p className="text-[13px] text-gray-400 mt-2 leading-relaxed">
            {provisionStatus === "unknown"
              ? "Confirming your team membership before loading shared content."
              : provisionMessage || "Your invitation is not active yet. Ask an admin to resend the invite or complete setup again."}
          </p>
          {provisionStatus !== "unknown" && (
            <div className="flex gap-2 mt-5">
              <button
                onClick={() => window.location.reload()}
                className="flex-1 h-10 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-[12px] font-semibold flex items-center justify-center gap-2 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />Refresh
              </button>
              <button
                onClick={logout}
                className="flex-1 h-10 rounded-lg border border-white/[0.08] text-gray-300 hover:bg-white/[0.04] text-[12px] font-semibold cursor-pointer"
              >
                Sign Out
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }
  return <ThemeProvider email={currentUser.email}><DashboardLayout /></ThemeProvider>;
}
