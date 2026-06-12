"use client";

import dynamic from "next/dynamic";
import { useState, useEffect } from "react";
import { ReachWordmark } from "@/components/reach-wordmark";
import { useAuth } from "@/lib/auth-context";
import { NavigationProvider, useNavigation } from "@/lib/navigation-context";
import { PipelineProvider, usePipeline } from "@/lib/pipeline-context";
import { TeamProvider, useTeam } from "@/lib/team-context";
import { ToastProvider } from "@/lib/toast-context";
import { PresenceProvider } from "@/lib/use-presence";
import { ToastContainer } from "./toast-container";
import { TopBar } from "./top-bar";
import { useSupportAlert } from "@/lib/support/use-support-alert";
import {
  CalendarDays,
  ChevronLeft,
  Eye,
  FolderOpen,
  Inbox,
  Kanban,
  LayoutDashboard,
  Palette,
  Pin,
  PinOff,
  Plus,
  Settings,
} from "lucide-react";

const DashboardPage = dynamic(() => import("./pages/dashboard-page").then((mod) => mod.DashboardPage), {
  loading: () => <PageLoadingShell label="Loading dashboard" />,
});
const KanbanBoard = dynamic(() => import("./kanban-board").then((mod) => mod.KanbanBoard), {
  loading: () => <PageLoadingShell label="Loading content board" />,
});
const CalendarPage = dynamic(() => import("./pages/calendar-page").then((mod) => mod.CalendarPage), {
  loading: () => <PageLoadingShell label="Loading calendar" />,
});
const PostPreviewPage = dynamic(() => import("./pages/post-preview-page").then((mod) => mod.PostPreviewPage), {
  loading: () => <PageLoadingShell label="Loading preview" />,
});
const MediaPage = dynamic(() => import("./pages/media-page").then((mod) => mod.MediaPage), {
  loading: () => <PageLoadingShell label="Loading media library" />,
});
const BrandKitPage = dynamic(() => import("./pages/brand-kit-page").then((mod) => mod.BrandKitPage), {
  loading: () => <PageLoadingShell label="Loading brand kit" />,
});
const SettingsPage = dynamic(() => import("./pages/settings-page").then((mod) => mod.SettingsPage), {
  loading: () => <PageLoadingShell label="Loading settings" />,
});
const SupportInbox = dynamic(() => import("./support/support-inbox").then((mod) => mod.SupportInbox), {
  loading: () => <PageLoadingShell label="Loading support inbox" />,
});
const AssetReviewDrawer = dynamic(() => import("./asset-review-drawer").then((mod) => mod.AssetReviewDrawer));
const CreatePostModal = dynamic(() => import("./create-post-modal").then((mod) => mod.CreatePostModal));
const RevisionModal = dynamic(() => import("./revision-modal").then((mod) => mod.RevisionModal));
const KickbackModal = dynamic(() => import("./kickback-modal").then((mod) => mod.KickbackModal));
const SupportWidget = dynamic(() => import("./support/support-widget").then((mod) => mod.SupportWidget));

function PageLoadingShell({ label }: { label: string }) {
  return (
    <div className="flex h-full min-h-[260px] items-center justify-center px-4">
      <div className="h-2 w-32 overflow-hidden rounded-full bg-gray-200/70 dark:bg-white/[0.08]" aria-label={label} role="status">
        <div className="h-full w-1/2 animate-pulse rounded-full bg-[#975428]" />
      </div>
    </div>
  );
}

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
              <PipelineOverlays />
              {createOpen && <CreatePostModal open onClose={() => setCreateOpen(false)} />}
              <IdleSupportWidget />
              <ToastContainer />
            </div>
          </TeamProvider>
        </PipelineProvider>
      </ToastProvider>
    </NavigationProvider>
  );
}

function PipelineOverlays() {
  const { isDrawerOpen, pendingReapproval, pendingKickback } = usePipeline();
  return (
    <>
      {isDrawerOpen && <AssetReviewDrawer />}
      {pendingReapproval && <RevisionModal />}
      {pendingKickback && <KickbackModal />}
    </>
  );
}

type IdleCallbackWindow = Window & {
  requestIdleCallback?: (cb: () => void, options?: { timeout?: number }) => number;
  cancelIdleCallback?: (id: number) => void;
};

function IdleSupportWidget() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const w = window as IdleCallbackWindow;
    let idleId: number | undefined;
    let timerId: ReturnType<typeof setTimeout> | undefined;
    if (w.requestIdleCallback) {
      idleId = w.requestIdleCallback(() => setReady(true), { timeout: 2500 });
    } else {
      timerId = setTimeout(() => setReady(true), 1800);
    }
    return () => {
      if (idleId !== undefined && w.cancelIdleCallback) w.cancelIdleCallback(idleId);
      if (timerId) clearTimeout(timerId);
    };
  }, []);
  return ready ? <SupportWidget /> : null;
}

// ─── Sidebar ───

function Sidebar({ onCreatePost, mobileOpen, setMobileOpen }: {
  onCreatePost: () => void;
  mobileOpen: boolean;
  setMobileOpen: (v: boolean) => void;
}) {
  const { currentPage, navigate, sidebarPinned, togglePin } = useNavigation();
  const { currentUser } = useAuth();
  const isSuperadmin = (currentUser.role || "").toLowerCase() === "superadmin";
  const supportAlert = useSupportAlert(isSuperadmin);

  const handleTogglePin = () => {
    togglePin();
  };

  const closeMobile = () => setMobileOpen(false);
  const handleNav = (page: string) => {
    navigate(page as import("@/lib/navigation-context").Page);
    closeMobile();
  };

  const NAV_ITEMS = [
    { id: "dashboard", label: "Dashboard", icon: <LayoutDashboard className="w-4 h-4" />, section: "plan" },
    { id: "pipeline", label: "Content Engine", icon: <Kanban className="w-4 h-4" />, section: "plan" },
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

  const expandedSidebarContent = (isMobile: boolean) => {
    return (
      <>
        {/* Logo */}
        <div className="relative flex items-center justify-center h-[60px] px-4 shrink-0">
          <ReachWordmark className="h-[13px] w-[150px] text-[#E1DFD5]" />
          {isMobile && (
            <button className="absolute right-3 p-1.5 rounded-lg hover:bg-[#E1DFD5]/[0.10] dark:hover:bg-white/[0.06] text-[#E1DFD5]/[0.70] cursor-pointer" onClick={closeMobile}>
              <ChevronLeft className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Create */}
        <div className="px-3 pt-1 pb-2">
          <button
            onClick={() => { onCreatePost(); if (isMobile) closeMobile(); }}
            className="w-full min-w-0 flex h-8 items-center justify-center gap-2 rounded-md bg-[#975428]/80 hover:bg-[#975428] text-[#E1DFD5] text-[11px] font-semibold whitespace-nowrap transition-colors duration-100 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">Create Post</span>
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 pt-2 px-3 space-y-5 overflow-y-auto overflow-x-hidden">
          {SECTIONS.map((section) => {
            const items = NAV_ITEMS.filter((n) => n.section === section.key);
            return (
              <div key={section.key}>
                <p className="px-2.5 mb-1.5 text-[9px] font-bold text-[#E1DFD5]/[0.50] dark:text-gray-600 tracking-[0.1em] uppercase">{section.label}</p>
                <div className="space-y-0.5">
                  {items.map((item) => {
                    const active = currentPage === item.id;
                    return (
                      <button key={item.id} onClick={() => handleNav(item.id)}
                        className={`relative w-full flex items-center justify-start gap-2.5 rounded-lg px-2.5 py-[8px] text-left transition-colors duration-100 cursor-pointer ${
                          active
                            ? "bg-[#E1DFD5]/[0.14] dark:bg-orange-500/10 text-[#E1DFD5] dark:text-orange-400 font-semibold"
                            : "text-[#E1DFD5]/[0.65] dark:text-gray-500 hover:text-[#E1DFD5] dark:hover:text-gray-300 hover:bg-[#E1DFD5]/[0.08] dark:hover:bg-white/[0.03]"
                        }`}>
                        <span className={`shrink-0 ${active ? "text-[#E1DFD5] dark:text-orange-400" : "text-[#E1DFD5]/[0.55] dark:text-gray-500"}`}>{item.icon}</span>
                        <span className="text-[13px] truncate whitespace-nowrap">{item.label}</span>
                        {"alert" in item && item.alert && (
                          <span
                            aria-hidden="true"
                            className="ml-auto h-1.5 w-1.5 rounded-full bg-[#975428] shadow-[0_0_0_2px_rgba(151,84,40,0.18)] animate-pulse"
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
            <button
              onClick={handleTogglePin}
              aria-label={sidebarPinned ? "Unpin sidebar" : "Pin sidebar"}
              className={`relative isolate flex h-8 w-full items-center justify-start gap-2 overflow-hidden rounded-lg px-2.5 py-[7px] transition-colors duration-100 cursor-pointer ${
                sidebarPinned
                  ? "text-[#E1DFD5] bg-[#E1DFD5]/[0.12] dark:bg-orange-500/10 hover:bg-[#E1DFD5]/[0.16] dark:hover:bg-orange-500/15"
                  : "text-[#E1DFD5]/[0.55] hover:text-[#E1DFD5] dark:hover:text-gray-300 hover:bg-[#E1DFD5]/[0.08] dark:hover:bg-white/[0.03]"
              }`}
            >
              {sidebarPinned ? (
                <><PinOff className="w-4 h-4 shrink-0" /><span className="truncate whitespace-nowrap text-[12px] font-medium">Unpin Sidebar</span></>
              ) : (
                <><Pin className="w-4 h-4 shrink-0" /><span className="truncate whitespace-nowrap text-[12px] font-medium">Pin Sidebar</span></>
              )}
            </button>
          </div>
        )}
      </>
    );
  };

  const autoHideSidebarContent = () => (
    <>
      <div className="relative h-[60px] shrink-0">
        <span className="absolute left-0 top-0 flex h-[60px] w-[52px] items-center justify-center font-heading text-[17px] font-semibold text-[#E1DFD5] tracking-[0.22em]" aria-label="The Reach">R</span>
        <ReachWordmark className="reach-sidebar-auto-expanded absolute left-[66px] top-1/2 h-[13px] w-[132px] -translate-y-1/2 text-[#E1DFD5]" />
      </div>

      <div className="px-2.5 pt-1 pb-2">
        <button onClick={onCreatePost} className="reach-sidebar-auto-create reach-sidebar-auto-item grid h-8 grid-cols-[32px_1fr] items-center overflow-hidden rounded-md text-[#E1DFD5] transition-colors duration-100 hover:bg-[#975428] cursor-pointer" title="Create Post">
          <span className="reach-sidebar-auto-icon-cell flex items-center justify-center rounded-md">
            <Plus className="w-3.5 h-3.5" />
          </span>
          <span className="reach-sidebar-auto-expanded min-w-0 truncate whitespace-nowrap pr-3 text-left text-[11px] font-semibold">Create Post</span>
        </button>
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto overflow-x-hidden pt-2">
        {SECTIONS.map((section) => {
          const items = NAV_ITEMS.filter((n) => n.section === section.key);
          return (
            <div key={section.key}>
              <div className="relative mb-2 h-5">
                <div className="reach-sidebar-auto-rail-only absolute left-4 top-1/2 w-5 border-t border-[#E1DFD5]/[0.15] dark:border-white/[0.06]" />
                <p className="reach-sidebar-auto-expanded absolute left-3 top-0 text-[9px] font-bold text-[#E1DFD5]/[0.50] tracking-[0.1em] uppercase dark:text-gray-600">{section.label}</p>
              </div>
              <div className="space-y-0.5">
                {items.map((item) => {
                  const active = currentPage === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => handleNav(item.id)}
                      className={`reach-sidebar-auto-item ${active ? "reach-sidebar-auto-item-active" : ""} relative ml-2.5 grid h-8 grid-cols-[32px_1fr_auto] items-center overflow-hidden rounded-lg text-left transition-colors duration-100 cursor-pointer ${
                        active
                          ? "text-[#E1DFD5] dark:text-orange-400"
                          : "text-[#E1DFD5]/[0.65] dark:text-gray-500 hover:text-[#E1DFD5] dark:hover:text-gray-300 hover:bg-[#E1DFD5]/[0.08] dark:hover:bg-white/[0.03]"
                      }`}
                      title={item.label}
                    >
                      <span className={`reach-sidebar-auto-icon-cell flex items-center justify-center rounded-lg ${active ? "text-[#E1DFD5] dark:text-orange-400" : "text-[#E1DFD5]/[0.55] dark:text-gray-500"}`}>{item.icon}</span>
                      <span className="reach-sidebar-auto-expanded min-w-0 truncate whitespace-nowrap pr-2 text-[13px]">{item.label}</span>
                      {"alert" in item && item.alert && (
                        <span aria-hidden="true" className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-[#975428] shadow-[0_0_0_2px_rgba(151,84,40,0.18)] animate-pulse" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      <div className="shrink-0 border-t border-[#E1DFD5]/[0.15] px-2.5 py-3 dark:border-white/[0.04]">
        <button
          onClick={handleTogglePin}
          aria-label="Pin sidebar"
          title="Pin sidebar"
          className="reach-sidebar-auto-item grid h-8 grid-cols-[32px_1fr] items-center overflow-hidden rounded-lg text-[#E1DFD5]/[0.55] transition-colors duration-100 hover:bg-[#E1DFD5]/[0.08] hover:text-[#E1DFD5] dark:hover:bg-white/[0.03] dark:hover:text-gray-300 cursor-pointer"
        >
          <span className="reach-sidebar-auto-icon-cell flex items-center justify-center rounded-lg">
            <Pin className="w-4 h-4" />
          </span>
          <span className="reach-sidebar-auto-expanded min-w-0 truncate whitespace-nowrap pr-3 text-left text-[12px] font-medium">Pin Sidebar</span>
        </button>
      </div>
    </>
  );

  return (
    <>
      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 bg-black/40 z-30 transition-opacity" onClick={closeMobile} />
      )}

      {/* Mobile sidebar */}
      <aside className={`md:hidden fixed inset-y-0 left-0 z-40 w-[270px] bg-[#6C655A] dark:bg-[#0c0c0f] shadow-2xl flex flex-col transition-transform duration-250 ease-out ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}>
        {expandedSidebarContent(true)}
      </aside>

      {/* Desktop sidebar */}
      {sidebarPinned ? (
        <aside
          data-sidebar-state="pinned"
          className="hidden md:flex h-dvh w-[218px] flex-col bg-[#6C655A] dark:bg-[#0c0c0f] shrink-0 overflow-hidden shadow-[1px_0_0_rgba(108,101,90,0.28)] dark:shadow-[1px_0_0_rgba(255,255,255,0.04)]"
        >
          {expandedSidebarContent(false)}
        </aside>
      ) : (
        <aside
          data-sidebar-state="auto-hide"
          className="reach-sidebar-auto hidden md:block"
        >
          <div className="reach-sidebar-auto-panel">
            {autoHideSidebarContent()}
          </div>
        </aside>
      )}
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

export function AuthenticatedAppShell() {
  return (
    <PresenceProvider>
      <DashboardLayout />
    </PresenceProvider>
  );
}
