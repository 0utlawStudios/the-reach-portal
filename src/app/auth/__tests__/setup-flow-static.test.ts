import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const SETUP_SRC = readFileSync(join(process.cwd(), "src/app/auth/setup/page.tsx"), "utf8");
const APP_SHELL_SRC = readFileSync(join(process.cwd(), "src/components/app-shell.tsx"), "utf8");
const AUTHENTICATED_APP_SHELL_SRC = readFileSync(join(process.cwd(), "src/components/authenticated-app-shell.tsx"), "utf8");
const GLOBALS_SRC = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
const NAVIGATION_SRC = readFileSync(join(process.cwd(), "src/lib/navigation-context.tsx"), "utf8");
const SETTINGS_SRC = readFileSync(join(process.cwd(), "src/components/pages/settings-page.tsx"), "utf8");
const CALENDAR_SRC = readFileSync(join(process.cwd(), "src/components/pages/calendar-page.tsx"), "utf8");
const DASHBOARD_SRC = readFileSync(join(process.cwd(), "src/components/pages/dashboard-page.tsx"), "utf8");
const SUPPORT_WIDGET_SRC = readFileSync(join(process.cwd(), "src/components/support/support-widget.tsx"), "utf8");
const SUPPORT_ALERT_SRC = readFileSync(join(process.cwd(), "src/lib/support/use-support-alert.ts"), "utf8");
const AUTH_CONTEXT_SRC = readFileSync(join(process.cwd(), "src/lib/auth-context.tsx"), "utf8");
const AUDIT_SRC = readFileSync(join(process.cwd(), "src/lib/audit.ts"), "utf8");
const TEAM_CONTEXT_SRC = readFileSync(join(process.cwd(), "src/lib/team-context.tsx"), "utf8");
const PRESENCE_SRC = readFileSync(join(process.cwd(), "src/lib/use-presence.tsx"), "utf8");
const IO_MIGRATION_SRC = readFileSync(join(process.cwd(), "supabase/migrations/0030_supabase_io_hardening.sql"), "utf8");
const SUPPORT_ALERT_MIGRATION_SRC = readFileSync(join(process.cwd(), "supabase/migrations/0031_support_alert_indexes.sql"), "utf8");
const TEAM_ACCESS_REALTIME_MIGRATION_SRC = readFileSync(join(process.cwd(), "supabase/migrations/0037_reach_team_access_realtime.sql"), "utf8");
const AUDIT_ACTOR_CLEANUP_MIGRATION_SRC = readFileSync(join(process.cwd(), "supabase/migrations/0038_reach_launch_audit_actor_cleanup.sql"), "utf8");
const AUDIT_ACTOR_NORMALIZATION_MIGRATION_SRC = readFileSync(join(process.cwd(), "supabase/migrations/0039_reach_cleanup_audit_actor_normalization.sql"), "utf8");
const AUTH_AUDIT_AVATAR_MIGRATION_SRC = readFileSync(join(process.cwd(), "supabase/migrations/0041_auth_audit_avatar_hardening.sql"), "utf8");
const THEME_PREFERENCE_MIGRATION_SRC = readFileSync(join(process.cwd(), "supabase/migrations/0042_team_theme_preference.sql"), "utf8");
const QA_AUDIT_NORMALIZATION_MIGRATION_SRC = readFileSync(join(process.cwd(), "supabase/migrations/0043_qa_cleanup_audit_actor_normalization.sql"), "utf8");
const QA_AUDIT_LIKE_FIX_MIGRATION_SRC = readFileSync(join(process.cwd(), "supabase/migrations/0044_qa_cleanup_audit_actor_like_fix.sql"), "utf8");
const CLEANUP_AUDIT_SYSTEM_ROLE_MIGRATION_SRC = readFileSync(join(process.cwd(), "supabase/migrations/0045_reach_cleanup_audit_system_role.sql"), "utf8");
const THEME_CONTEXT_SRC = readFileSync(join(process.cwd(), "src/lib/theme-context.tsx"), "utf8");

describe("invite setup flow hardening", () => {
  it("activates invitations through the server route, not a client-side team_members update", () => {
    expect(SETUP_SRC).toContain("/api/auth/complete-setup");
    expect(SETUP_SRC).not.toMatch(/from\(\s*["']team_members["']\s*\)\s*\.\s*update\(/);
  });

  it("keeps the user session after setup so workspace provisioning can refresh immediately", () => {
    expect(SETUP_SRC).not.toMatch(/auth\.signOut\s*\(/);
    expect(SETUP_SRC).toMatch(/window\.location\.replace\(\s*["']\/["']\s*\)/);
  });

  it("lets interrupted invite setup resume from an existing session", () => {
    expect(SETUP_SRC).toContain("setup was");
    expect(SETUP_SRC).toContain("supabase.auth.getSession()");
    expect(APP_SHELL_SRC).toContain("Complete Setup");
    expect(APP_SHELL_SRC).toContain('window.location.href = "/auth/setup"');
  });

  it("requires a profile photo while still allowing setup retry from the existing session", () => {
    expect(SETUP_SRC).toContain("Please add a profile photo.");
    expect(SETUP_SRC).toContain("Failed to upload photo. Please try again.");
    expect(SETUP_SRC).toContain("profiles/${user.id}/");
    expect(SETUP_SRC).toContain("The page can resume from an existing");
    expect(SETUP_SRC).toContain("const canSubmit = ready && !loading");
    expect(SETUP_SRC).not.toContain("Photo upload failed, but your workspace access will still be activated.");
  });

  it("locks avatar writes to authenticated user-owned storage prefixes", () => {
    expect(AUTH_AUDIT_AVATAR_MIGRATION_SRC).toContain("DROP POLICY IF EXISTS \"Allow uploads avatars\"");
    expect(AUTH_AUDIT_AVATAR_MIGRATION_SRC).toContain("FOR INSERT TO authenticated");
    expect(AUTH_AUDIT_AVATAR_MIGRATION_SRC).toContain("(storage.foldername(name))[2] = auth.uid()::text");
    expect(AUTH_AUDIT_AVATAR_MIGRATION_SRC).toContain("IN ('profiles', 'kickback')");
  });
});

describe("Supabase IO hardening", () => {
  it("keeps the support widget cold until opened", () => {
    expect(SUPPORT_WIDGET_SRC).toContain("supportEnabled");
    expect(SUPPORT_WIDGET_SRC).toContain('useSupport("own", { enabled: supportEnabled, realtime: supportEnabled })');
  });

  it("keeps presence database writes and summary reads on slow cadences", () => {
    expect(PRESENCE_SRC).toContain("const HEARTBEAT_MS = 5 * 60 * 1000");
    expect(PRESENCE_SRC).toContain("const SUMMARY_REFRESH_MS = 15 * 60 * 1000");
  });

  it("tracks the production RLS and realtime cleanup migration", () => {
    expect(IO_MIGRATION_SRC).toContain("workspace_members_user_status_workspace_idx");
    expect(IO_MIGRATION_SRC).toContain("team_members_lower_email_idx");
    expect(IO_MIGRATION_SRC).toContain("public.is_active_workspace_member(workspace_id, NULL)");
    expect(IO_MIGRATION_SRC).toContain("ALTER PUBLICATION supabase_realtime DROP TABLE public.post_audit_logs");
  });

  it("keeps the support sidebar alert lightweight and indexed", () => {
    expect(SUPPORT_ALERT_SRC).toContain("/api/support/alert");
    expect(SUPPORT_ALERT_SRC).toContain("90 * 1000");
    expect(SUPPORT_ALERT_SRC).not.toMatch(/\.on\(\s*["']postgres_changes/);
    expect(SUPPORT_ALERT_MIGRATION_SRC).toContain("support_threads_admin_unread_idx");
    expect(SUPPORT_ALERT_MIGRATION_SRC).toContain("support_threads_admin_untouched_open_ticket_idx");
  });

  it("keeps team and request access state fresh through revalidation and realtime invalidation", () => {
    expect(AUTH_CONTEXT_SRC).toContain("const ACCESS_REVALIDATE_MS = 10 * 60 * 1000");
    expect(AUTH_CONTEXT_SRC).toContain("needsFullCheck");
    expect(AUTH_CONTEXT_SRC).toContain("applyAccessState(session)");
    expect(AUTH_CONTEXT_SRC).toContain("provisionWorkspace(session.access_token)");
    expect(TEAM_CONTEXT_SRC).toContain("const TEAM_REFRESH_MS = 5 * 60 * 1000");
    expect(TEAM_CONTEXT_SRC).toContain('channel("team-access-sync")');
    expect(TEAM_CONTEXT_SRC).toContain('table: "team_members"');
    expect(TEAM_CONTEXT_SRC).toContain('table: "signup_requests"');
    expect(TEAM_ACCESS_REALTIME_MIGRATION_SRC).toContain("ALTER PUBLICATION supabase_realtime ADD TABLE public.team_members");
    expect(TEAM_ACCESS_REALTIME_MIGRATION_SRC).toContain("ALTER PUBLICATION supabase_realtime ADD TABLE public.signup_requests");
  });

  it("shows launch cleanup audit entries as system activity, not Aldridge's personal action", () => {
    expect(AUDIT_SRC).toContain('details.startsWith("Reach launch cleanup removed ")');
    expect(AUDIT_SRC).toContain("LAUNCH_CLEANUP_EMAILS");
    expect(AUDIT_SRC).toContain("Removed ([^ ]+) from team, workspace access, and auth");
    expect(AUDIT_SRC).toContain('return "SYSTEM"');
    expect(AUDIT_ACTOR_CLEANUP_MIGRATION_SRC).toContain("metadata->>'details' LIKE 'Reach launch cleanup removed %'");
    expect(AUDIT_ACTOR_CLEANUP_MIGRATION_SRC).toContain("to_jsonb('SYSTEM'::text)");
    expect(AUDIT_ACTOR_NORMALIZATION_MIGRATION_SRC).toContain("'Removed alex@ten80ten.com from team, workspace access, and auth'");
    expect(AUDIT_ACTOR_NORMALIZATION_MIGRATION_SRC).toContain("to_jsonb('SYSTEM'::text)");
    expect(AUDIT_SRC).toContain("Removed qa-(invite|request)-\\d+@example\\.com");
    expect(QA_AUDIT_NORMALIZATION_MIGRATION_SRC).toContain("Removed qa-(invite|request)-[0-9]+@example\\\\.com");
    expect(QA_AUDIT_LIKE_FIX_MIGRATION_SRC).toContain("LIKE 'Removed qa-%@example.com from team, workspace access, and auth'");
    expect(QA_AUDIT_NORMALIZATION_MIGRATION_SRC).toContain("to_jsonb('SYSTEM'::text)");
    expect(CLEANUP_AUDIT_SYSTEM_ROLE_MIGRATION_SRC).toContain("actor_user_id = NULL");
    expect(CLEANUP_AUDIT_SYSTEM_ROLE_MIGRATION_SRC).toContain("actor_role = 'system'");
    expect(CLEANUP_AUDIT_SYSTEM_ROLE_MIGRATION_SRC).toContain("metadata->>'details' LIKE 'Reach launch cleanup removed %'");
    expect(CLEANUP_AUDIT_SYSTEM_ROLE_MIGRATION_SRC).toContain("'Removed hanes@ten80ten.com from team, workspace access, and auth'");
  });

  it("keeps default light mode backed by a real team_members preference column", () => {
    expect(THEME_CONTEXT_SRC).toContain("return \"light\"");
    expect(THEME_CONTEXT_SRC).toContain("theme_preference");
    expect(THEME_PREFERENCE_MIGRATION_SRC).toContain("add column if not exists theme_preference text");
    expect(THEME_PREFERENCE_MIGRATION_SRC).toContain("set default 'light'");
    expect(THEME_PREFERENCE_MIGRATION_SRC).toContain("check (theme_preference in ('light', 'dark'))");
  });
});

describe("Support Inbox navigation", () => {
  it("moves the Support Inbox out of Settings and into a superadmin-only sidebar page", () => {
    expect(NAVIGATION_SRC).toContain('"support"');
    expect(NAVIGATION_SRC).toContain('setCurrentPage("support")');
    expect(AUTHENTICATED_APP_SHELL_SRC).toContain('id: "support"');
    expect(AUTHENTICATED_APP_SHELL_SRC).toContain("isSuperadmin ? <SupportInboxPage /> : <DashboardPage />");
    expect(SETTINGS_SRC).not.toContain("SupportInbox");
    expect(SETTINGS_SRC).not.toContain("Support Inbox");
  });

  it("keeps the desktop sidebar auto-hidden whenever it is unpinned", () => {
    expect(NAVIGATION_SRC).toContain("loadState<boolean>(PIN_KEY, false) ? false : true");
    expect(NAVIGATION_SRC).toContain("setSidebarCollapsedState(true);");
    expect(NAVIGATION_SRC).toContain("saveState(SIDEBAR_KEY, true);");
    expect(NAVIGATION_SRC).not.toContain("setSidebarCollapsedState(v);\n    saveState(SIDEBAR_KEY, v);");
    expect(AUTHENTICATED_APP_SHELL_SRC).not.toContain("onMouseEnter=");
    expect(AUTHENTICATED_APP_SHELL_SRC).not.toContain("onMouseLeave=");
    expect(AUTHENTICATED_APP_SHELL_SRC).not.toContain("hoverExpandRef");
    expect(AUTHENTICATED_APP_SHELL_SRC).not.toContain("setSidebarCollapsed(false)");
    expect(AUTHENTICATED_APP_SHELL_SRC).toContain('data-sidebar-state="auto-hide"');
    expect(AUTHENTICATED_APP_SHELL_SRC).toContain('className="group relative z-30 hidden h-dvh w-[52px] shrink-0 overflow-visible md:block"');
    expect(AUTHENTICATED_APP_SHELL_SRC).toContain("const autoHideSidebarContent = () =>");
    expect(AUTHENTICATED_APP_SHELL_SRC).toContain("absolute inset-y-0 left-0 z-40 flex w-[52px] flex-col overflow-hidden");
    expect(AUTHENTICATED_APP_SHELL_SRC).toContain("group-hover:w-[218px]");
    expect(AUTHENTICATED_APP_SHELL_SRC).toContain("grid-cols-[32px_1fr_auto]");
    expect(AUTHENTICATED_APP_SHELL_SRC).toContain("absolute left-0 top-0 flex h-[60px] w-[52px]");
  });

  it("keeps the desktop pin control lightweight with no load-time teaser motion", () => {
    expect(AUTHENTICATED_APP_SHELL_SRC).not.toContain("SIDEBAR_PIN_TEASER_MS");
    expect(AUTHENTICATED_APP_SHELL_SRC).not.toContain("pinTeaserStartedRef");
    expect(AUTHENTICATED_APP_SHELL_SRC).not.toContain("pinTeaserActive");
    expect(AUTHENTICATED_APP_SHELL_SRC).not.toContain("pinTeaserTimerRef");
    expect(AUTHENTICATED_APP_SHELL_SRC).not.toContain("if (pinTeaserActive) return;");
    expect(AUTHENTICATED_APP_SHELL_SRC).not.toContain("reach-sidebar-pin-hint");
    expect(AUTHENTICATED_APP_SHELL_SRC).not.toContain("saveState(PIN_KEY");
    expect(AUTHENTICATED_APP_SHELL_SRC).not.toContain("const SIDEBAR_CHROME_REVEAL_MS");
    expect(AUTHENTICATED_APP_SHELL_SRC).not.toContain("desktopChromeReady");
    expect(AUTHENTICATED_APP_SHELL_SRC).not.toContain("data-sidebar-chrome");
    expect(AUTHENTICATED_APP_SHELL_SRC).not.toContain("transition-[width]");
    expect(AUTHENTICATED_APP_SHELL_SRC).not.toContain("group-hover:px");
    expect(AUTHENTICATED_APP_SHELL_SRC).not.toContain("group-hover:gap");
    expect(AUTHENTICATED_APP_SHELL_SRC).not.toContain("group-hover:justify");
    expect(AUTHENTICATED_APP_SHELL_SRC).not.toContain("group-hover:flex");
    expect(AUTHENTICATED_APP_SHELL_SRC).toContain('data-sidebar-state="pinned"');
    expect(AUTHENTICATED_APP_SHELL_SRC).toContain("group-hover:w-[198px]");
    expect(AUTHENTICATED_APP_SHELL_SRC).toContain('w-[218px]');
    expect(AUTHENTICATED_APP_SHELL_SRC).toContain('w-[52px]');
    expect(AUTHENTICATED_APP_SHELL_SRC).toContain("whitespace-nowrap");
    expect(AUTHENTICATED_APP_SHELL_SRC).toContain("justify-start gap-2.5");
    expect(AUTHENTICATED_APP_SHELL_SRC).toContain("text-left");
    expect(GLOBALS_SRC).not.toContain("@keyframes reach-sidebar-pin-hint");
    expect(GLOBALS_SRC).not.toContain("@keyframes reach-sidebar-pin-hint-icon");
    expect(GLOBALS_SRC).not.toContain("@keyframes reach-sidebar-pin-hint-sheen");
    expect(GLOBALS_SRC).not.toContain("scale(2.8)");
  });
});

const removedGenerationLabel = ["Creator", "Studio"].join(" ");
const removedGenerationPage = ["Studio", "Page"].join("");
const removedGenerationEndpoint = ["/api/ai", "studio"].join("/");

describe("AI generation surface removal", () => {
  it("keeps the removed generation surface out of portal navigation and settings UI", () => {
    expect(NAVIGATION_SRC).not.toContain('"studio"');
    expect(APP_SHELL_SRC).not.toContain(removedGenerationPage);
    expect(APP_SHELL_SRC).not.toContain(removedGenerationLabel);
    expect(AUTHENTICATED_APP_SHELL_SRC).not.toContain(removedGenerationPage);
    expect(AUTHENTICATED_APP_SHELL_SRC).not.toContain(removedGenerationLabel);
    expect(SETTINGS_SRC).not.toContain(removedGenerationLabel);
    expect(SETTINGS_SRC).not.toContain(removedGenerationEndpoint);
  });
});

describe("calendar settings UX", () => {
  it("removes the disabled week-start setting and keeps calendars Sunday-first", () => {
    expect(SETTINGS_SRC).not.toContain("Week starts on");
    expect(SETTINGS_SRC).not.toContain("First day of the week in calendar");
    expect(CALENDAR_SRC).toContain('const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]');
    expect(DASHBOARD_SRC).toContain('const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]');
  });
});
