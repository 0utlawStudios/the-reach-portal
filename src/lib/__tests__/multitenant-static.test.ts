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

    const published = source("src/app/api/notifications/published/route.ts");
    expect(published).toContain('.from("publish_jobs")');
    expect(published).toContain('.eq("post_id", postId)');
    expect(published).toContain('.eq("workspace_id", postRow.workspace_id)');
  });

  it("scopes Brand Playbook reads, writes, realtime, and AI context by workspace", () => {
    const brandKit = source("src/components/pages/brand-kit-page.tsx");
    expect(brandKit).toContain("const { workspaceId } = usePipeline()");
    expect(brandKit).toContain('.eq("workspace_id", workspaceId)');
    expect(brandKit).toContain("filter: `workspace_id=eq.${workspaceId}`");
    expect(brandKit).toContain("workspace_id: workspaceId");
    expect(brandKit).not.toContain('.eq("id", "singleton")');
    expect(brandKit).not.toContain('.channel("brand-playbook-realtime")');

    const aiWorker = source("src/lib/ai/worker.ts");
    expect(aiWorker).toMatch(/\.from\("brand_playbook"\)[\s\S]{0,120}\.eq\("workspace_id", plan\.workspace_id\)/);
    expect(aiWorker).toMatch(/\.from\("brand_playbook"\)[\s\S]{0,120}\.eq\("workspace_id", post\.workspace_id\)/);

    const migration = source("supabase/migrations/0055_media_tenant_hardening.sql");
    expect(migration).toContain("brand_playbook_one_row_per_workspace_idx");
    expect(migration).toContain("ON public.brand_playbook(workspace_id)");
  });

  it("fails AI jobs closed when linked plan or post rows do not match the job workspace", () => {
    const aiWorker = source("src/lib/ai/worker.ts");
    expect(aiWorker).toContain("loadGenerateContext(sb, job.plan_row_id, job.workspace_id)");
    expect(aiWorker).toMatch(
      /from\("content_plan_rows"\)[\s\S]{0,160}\.eq\("id", planRowId\)[\s\S]{0,80}\.eq\("workspace_id", workspaceId\)/,
    );
    expect(aiWorker).toMatch(
      /from\("content_plan_rows"\)[\s\S]{0,180}\.eq\("id", job\.plan_row_id\)[\s\S]{0,80}\.eq\("workspace_id", job\.workspace_id\)/,
    );
    expect(aiWorker).toMatch(
      /from\("posts"\)[\s\S]{0,180}\.eq\("id", sourcePost\.id\)[\s\S]{0,80}\.eq\("workspace_id", job\.workspace_id\)/,
    );
    expect(aiWorker).toMatch(
      /from\("ai_generation_jobs"\)[\s\S]{0,260}\.eq\("id", jobId\)[\s\S]{0,80}\.eq\("workspace_id", job\.workspace_id\)/,
    );
    expect(aiWorker).toContain("async function failJob(sb: SupabaseClient, job: Pick<AiJobRow, \"id\" | \"workspace_id\">");
    expect(aiWorker).toMatch(
      /from\("content_plan_rows"\)[\s\S]{0,180}\.eq\("id", data\.plan_row_id\)[\s\S]{0,80}\.eq\("workspace_id", job\.workspace_id\)/,
    );
  });

  it("scopes publish queue, audit logs, and presence to the active workspace", () => {
    const migration = source("supabase/migrations/0055_media_tenant_hardening.sql");
    expect(migration).toContain("DROP VIEW IF EXISTS public.v_publish_queue");
    expect(migration).toContain("CREATE VIEW public.v_publish_queue");
    expect(migration).toContain("WITH (security_invoker = true)");
    expect(migration).toContain("public.is_active_workspace_member(j.workspace_id");
    expect(migration).toContain("RAISE EXCEPTION 'audit workspace membership required'");
    expect(migration).toContain("audit workspace does not match entity workspace");
    expect(migration).toContain("ALTER COLUMN source_vault TYPE jsonb");

    const settings = source("src/components/pages/settings-page.tsx");
    expect(settings).toContain("fetchAllAuditLogs(500, workspaceId)");
    expect(settings).toContain('.from("v_publish_queue")');
    expect(settings).toContain('.eq("workspace_id", workspaceId)');

    const audit = source("src/lib/audit.ts");
    expect(audit).toContain("fetchAllAuditLogs(limit = 100, workspaceId?: string | null)");
    expect(audit).toContain('.eq("workspace_id", workspaceId)');

    const shell = source("src/components/authenticated-app-shell.tsx");
    expect(shell).toContain("function WorkspacePresenceBoundary");
    expect(shell).toContain("<PresenceProvider workspaceId={workspaceId}>");

    const presence = source("src/lib/use-presence.tsx");
    expect(presence).toContain('.select("workspace_id, email, presence_last_seen, audit_last, auth_last_sign_in, best_known_seen")');
    expect(presence).toContain('.eq("workspace_id", wsId)');
    expect(presence).toContain("private: true");
    expect(presence).toContain("channel(`presence-${wsId}`");

    const privatePresence = source("supabase/migrations/0060_private_presence_channels.sql");
    expect(privatePresence).toContain("ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY");
    expect(privatePresence).toContain("workspace_presence_listen");
    expect(privatePresence).toContain("workspace_presence_track");
    expect(privatePresence).toContain("realtime.messages.extension = 'presence'");
    expect(privatePresence).toContain("realtime.topic()");
    expect(privatePresence).toContain("public.workspace_members");
    expect(privatePresence).toContain("wm.status = 'active'");

    const presenceDiag = source("src/app/api/presence/diag/route.ts");
    expect(presenceDiag).toContain('.select("workspace_id, role, status")');
    expect(presenceDiag).toContain('.eq("workspace_id", membership.workspace_id)');
  });
});
