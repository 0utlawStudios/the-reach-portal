"use client";

import { useState, useEffect } from "react";
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

function PageContent() {
  const { currentPage } = useNavigation();
  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      {currentPage === "dashboard" && <DashboardPage />}
      {currentPage === "pipeline" && <KanbanBoard />}
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

  return (
    <NavigationProvider>
      <PipelineProvider>
        <TeamProvider>
          <ToastProvider>
          <AvatarSync />
          <div className="h-screen flex bg-[#fafbfc] dark:bg-[#0a0a0a] overflow-hidden">
            <SidebarWithCreate onCreatePost={() => setCreateOpen(true)} />
            <main className="flex-1 flex flex-col min-w-0">
              <TopBar />
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
          </ToastProvider>
        </TeamProvider>
      </PipelineProvider>
    </NavigationProvider>
  );
}

function SidebarWithCreate({ onCreatePost }: { onCreatePost: () => void }) {
  return <SidebarWrapper onCreatePost={onCreatePost} />;
}

function SidebarWrapper({ onCreatePost }: { onCreatePost: () => void }) {
  const { currentPage, navigate, sidebarCollapsed, toggleSidebar } = useNavigation();
  const {
    LayoutDashboard, Kanban, CalendarDays, Eye, Users, FolderOpen, Settings, ChevronLeft, ChevronRight, Plus, Palette,
  } = require("lucide-react");


  const NAV_ITEMS = [
    { id: "dashboard", label: "Dashboard", icon: <LayoutDashboard className="w-4 h-4" />, section: "plan" },
    { id: "pipeline", label: "Content Pipeline", icon: <Kanban className="w-4 h-4" />, section: "plan" },
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

  return (
    <>
    {/* Mobile backdrop */}
    <div id="mobile-sidebar-backdrop" className="hidden md:hidden fixed inset-0 bg-black/30 z-30" onClick={() => { document.getElementById("mobile-sidebar")?.classList.add("hidden"); document.getElementById("mobile-sidebar")?.classList.remove("flex"); document.getElementById("mobile-sidebar-backdrop")?.classList.add("hidden"); }} />
    <aside id="mobile-sidebar" className={`hidden md:flex h-screen flex-col bg-white dark:bg-[#0c0c0f] shrink-0 overflow-hidden transition-[width] duration-200 ease-out shadow-[1px_0_0_rgba(0,0,0,0.04)] dark:shadow-[1px_0_0_rgba(255,255,255,0.04)] ${sidebarCollapsed ? "w-[56px]" : "w-[230px]"} max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-40 max-md:w-[270px] max-md:shadow-2xl`}>
      {/* Logo */}
      <div className="relative flex items-center justify-center h-[60px] px-4 shrink-0">
        {!sidebarCollapsed ? (
          <img src="/ten80ten-logo.png" alt="Ten80Ten" className="w-[48px] h-auto object-contain" />
        ) : (
          <img src="/ten80ten-logo.png" alt="Ten80Ten" className="w-7 h-auto object-contain" />
        )}
        <button className="md:hidden absolute right-3 p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-white/[0.06] text-gray-400 cursor-pointer" onClick={() => { document.getElementById("mobile-sidebar")?.classList.add("hidden"); document.getElementById("mobile-sidebar")?.classList.remove("flex"); document.getElementById("mobile-sidebar-backdrop")?.classList.add("hidden"); }}>
          <ChevronLeft className="w-4 h-4" />
        </button>
      </div>

      {/* Create */}
      {!sidebarCollapsed ? (
        <div className="px-3 pt-1 pb-2">
          <button onClick={onCreatePost} className="w-full flex items-center justify-center gap-2 h-[36px] rounded-lg bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white text-[12px] font-semibold transition-all duration-150 cursor-pointer shadow-sm shadow-orange-500/20">
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
          const items = NAV_ITEMS.filter((n: any) => n.section === section.key);
          return (
            <div key={section.key}>
              {!sidebarCollapsed && <p className="px-2.5 mb-1.5 text-[9px] font-bold text-gray-400/60 dark:text-gray-600 tracking-[0.1em] uppercase">{section.label}</p>}
              {sidebarCollapsed && <div className="w-5 mx-auto mb-2 border-t border-gray-100 dark:border-white/[0.06]" />}
              <div className="space-y-0.5">
                {items.map((item: any) => {
                  const active = currentPage === item.id;
                  return (
                    <button key={item.id} onClick={() => { navigate(item.id); document.getElementById("mobile-sidebar")?.classList.add("hidden"); document.getElementById("mobile-sidebar")?.classList.remove("flex"); document.getElementById("mobile-sidebar-backdrop")?.classList.add("hidden"); }}
                      className={`w-full flex items-center gap-2.5 rounded-lg transition-all duration-150 cursor-pointer ${sidebarCollapsed ? "justify-center px-0 py-2" : "px-2.5 py-[8px]"} ${
                        active
                          ? "bg-orange-50 dark:bg-orange-500/10 text-orange-700 dark:text-orange-400 font-semibold"
                          : "text-gray-500 dark:text-gray-500 hover:text-gray-800 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/[0.03]"
                      }`}
                      title={sidebarCollapsed ? item.label : undefined}>
                      <span className={`shrink-0 ${active ? "text-orange-600 dark:text-orange-400" : "text-gray-400 dark:text-gray-500"}`}>{item.icon}</span>
                      {!sidebarCollapsed && <span className="text-[13px] truncate">{item.label}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      {/* Collapse */}
      <div className="px-3 py-3 shrink-0 border-t border-gray-100 dark:border-white/[0.04]">
        <button onClick={toggleSidebar} className="w-full flex items-center gap-2 rounded-lg px-2.5 py-[7px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/[0.03] transition-all duration-150 cursor-pointer">
          {sidebarCollapsed ? <ChevronRight className="w-4 h-4 mx-auto" /> : <><ChevronLeft className="w-4 h-4" /><span className="text-[12px] font-medium">Collapse</span></>}
        </button>
      </div>
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
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return <LoginScreen />;
  return (
    <ThemeProvider>
      <DashboardLayout />
    </ThemeProvider>
  );
}
