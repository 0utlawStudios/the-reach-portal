import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const SETUP_SRC = readFileSync(join(process.cwd(), "src/app/auth/setup/page.tsx"), "utf8");
const APP_SHELL_SRC = readFileSync(join(process.cwd(), "src/components/app-shell.tsx"), "utf8");
const NAVIGATION_SRC = readFileSync(join(process.cwd(), "src/lib/navigation-context.tsx"), "utf8");
const STUDIO_SRC = readFileSync(join(process.cwd(), "src/components/pages/studio-page.tsx"), "utf8");
const SETTINGS_SRC = readFileSync(join(process.cwd(), "src/components/pages/settings-page.tsx"), "utf8");
const CALENDAR_SRC = readFileSync(join(process.cwd(), "src/components/pages/calendar-page.tsx"), "utf8");
const DASHBOARD_SRC = readFileSync(join(process.cwd(), "src/components/pages/dashboard-page.tsx"), "utf8");
const SUPPORT_WIDGET_SRC = readFileSync(join(process.cwd(), "src/components/support/support-widget.tsx"), "utf8");
const SUPPORT_ALERT_SRC = readFileSync(join(process.cwd(), "src/lib/support/use-support-alert.ts"), "utf8");
const TEAM_CONTEXT_SRC = readFileSync(join(process.cwd(), "src/lib/team-context.tsx"), "utf8");
const PRESENCE_SRC = readFileSync(join(process.cwd(), "src/lib/use-presence.tsx"), "utf8");
const IO_MIGRATION_SRC = readFileSync(join(process.cwd(), "supabase/migrations/0030_supabase_io_hardening.sql"), "utf8");
const SUPPORT_ALERT_MIGRATION_SRC = readFileSync(join(process.cwd(), "supabase/migrations/0031_support_alert_indexes.sql"), "utf8");
const TEAM_REALTIME_TRIM_MIGRATION_SRC = readFileSync(join(process.cwd(), "supabase/migrations/0032_trim_team_members_realtime.sql"), "utf8");

describe("invite setup flow hardening", () => {
  it("activates invitations through the server route, not a client-side team_members update", () => {
    expect(SETUP_SRC).toContain("/api/auth/complete-setup");
    expect(SETUP_SRC).not.toMatch(/from\(\s*["']team_members["']\s*\)\s*\.\s*update\(/);
  });

  it("keeps the user session after setup so workspace provisioning can refresh immediately", () => {
    expect(SETUP_SRC).not.toMatch(/auth\.signOut\s*\(/);
    expect(SETUP_SRC).toMatch(/window\.location\.replace\(\s*["']\/["']\s*\)/);
  });
});

describe("Creator Studio default row count", () => {
  it("does not pad the planner with a long placeholder sheet", () => {
    expect(STUDIO_SRC).not.toMatch(/14\s*-\s*have/);
    expect(STUDIO_SRC).toMatch(/fetched\.length\s*>\s*0\s*\?\s*fetched\s*:\s*\[makeBlankRow\(0\)\]/);
  });

  it("loads daily spend through the server API instead of direct client RLS reads", () => {
    expect(STUDIO_SRC).toContain("/api/ai/studio/spend");
    expect(STUDIO_SRC).not.toMatch(/from\(\s*["']ai_generation_jobs["']\s*\)\.select\(\s*["']cost_usd/);
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

  it("keeps team freshness off permanent Realtime polling", () => {
    expect(TEAM_CONTEXT_SRC).toContain("const TEAM_REFRESH_MS = 5 * 60 * 1000");
    expect(TEAM_CONTEXT_SRC).not.toContain("team-realtime");
    expect(TEAM_REALTIME_TRIM_MIGRATION_SRC).toContain("ALTER PUBLICATION supabase_realtime DROP TABLE public.team_members");
  });
});

describe("Support Inbox navigation", () => {
  it("moves the Support Inbox out of Settings and into a superadmin-only sidebar page", () => {
    expect(NAVIGATION_SRC).toContain('"support"');
    expect(NAVIGATION_SRC).toContain('setCurrentPage("support")');
    expect(APP_SHELL_SRC).toContain('id: "support"');
    expect(APP_SHELL_SRC).toContain("isSuperadmin ? <SupportInboxPage /> : <DashboardPage />");
    expect(SETTINGS_SRC).not.toContain("SupportInbox");
    expect(SETTINGS_SRC).not.toContain("Support Inbox");
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
