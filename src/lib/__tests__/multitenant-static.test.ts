import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function source(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf8");
}

describe("multitenant static contracts", () => {
  it("scopes team_members by workspace at the schema and RLS layers", () => {
    const migration = source("supabase/migrations/0053_tenant_scope_team_members.sql");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS workspace_id");
    expect(migration).toContain("team_members_workspace_email_lower_unique_idx");
    expect(migration).toContain("DROP CONSTRAINT IF EXISTS team_members_email_key");
    expect(migration).toContain("team_members_select_v3");
    expect(migration).toContain("is_active_workspace_member(workspace_id");
    expect(migration).toContain("tm.workspace_id = a.workspace_id");
    expect(migration).toContain("tm.workspace_id        AS workspace_id");
  });

  it("uses workspace-scoped team profile checks for auth, setup, and client team views", () => {
    const requireAuth = source("src/lib/auth/require.ts");
    expect(requireAuth).toContain('.eq("workspace_id", workspaceMember.workspace_id)');

    const teamContext = source("src/lib/team-context.tsx");
    expect(teamContext).toContain('.eq("workspace_id", workspaceId)');
    expect(teamContext).toContain("filter: `workspace_id=eq.${workspaceId}`");
    expect(teamContext).toContain("workspace_id: workspaceId");

    const authContext = source("src/lib/auth-context.tsx");
    expect(authContext).toContain("enrichFromTeamMembers(email, fallbackProfile, provisioned.result.workspaceId)");

    const setup = source("src/app/api/auth/complete-setup/route.ts");
    expect(setup).toContain('.select("id, workspace_id, role, status, avatar_url")');
    expect(setup).toContain('.eq("workspace_id", workspaceId)');
    expect(setup).toContain("workspace_id: workspaceId");

    const provision = source("src/app/api/workspace/provision/route.ts");
    expect(provision).toContain('.select("workspace_id, role, status")');
    expect(provision).toContain("workspace_id: workspaceId");
  });

  it("scopes service-role team mutations and notification recipient lookups", () => {
    for (const file of [
      "src/app/api/team/invite/route.ts",
      "src/app/api/team/approve-request/route.ts",
      "src/app/api/team/remove-member/route.ts",
      "src/app/api/team/resend-invite/route.ts",
      "src/app/api/team/update-member/route.ts",
      "src/app/api/team/change-email/route.ts",
    ]) {
      expect(source(file), file).toContain('.eq("workspace_id", ctx.workspaceId)');
    }

    const notificationsShared = source("src/app/api/notifications/_shared.ts");
    expect(notificationsShared).toContain('.eq("workspace_id", workspaceId)');
    for (const file of [
      "src/app/api/notifications/awaiting-approval/route.ts",
      "src/app/api/notifications/mention/route.ts",
      "src/app/api/notifications/revision/route.ts",
      "src/app/api/notifications/approved/route.ts",
      "src/app/api/notifications/published/route.ts",
    ]) {
      expect(source(file), file).toMatch(/workspaceId|workspace_id/);
    }
  });
});
