import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// ─── Auth ───

const HEALTH_SECRET = process.env.HEALTH_CHECK_SECRET;

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

// ─── Types ───

type Status = "pass" | "warn" | "fail";
interface Check { status: Status; message: string; details?: any }

function pass(msg: string, d?: any): Check { return { status: "pass", message: msg, details: d }; }
function warn(msg: string, d?: any): Check { return { status: "warn", message: msg, details: d }; }
function fail(msg: string, d?: any): Check { return { status: "fail", message: msg, details: d }; }

// ─── Helpers ───

async function timedFetch(url: string, opts?: RequestInit & { timeout?: number }): Promise<{ ok: boolean; status: number; ms: number; body?: string }> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts?.timeout || 10000);
    const res = await fetch(url, { ...opts, signal: controller.signal });
    clearTimeout(timer);
    return { ok: res.ok, status: res.status, ms: Date.now() - start };
  } catch (e: any) {
    return { ok: false, status: 0, ms: Date.now() - start, body: e.message };
  }
}

// ─── Handler ───

export async function GET(req: Request) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!HEALTH_SECRET || token !== HEALTH_SECRET) return unauthorized();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    return NextResponse.json({
      timestamp: new Date().toISOString(),
      checks: { environment: fail("Missing SUPABASE_URL or SERVICE_ROLE_KEY") },
      summary: { total: 1, passed: 0, warnings: 0, failures: 1 },
    });
  }

  const admin = createClient(url, serviceKey);
  const checks: Record<string, Check> = {};
  const now = new Date();
  const todayStr = now.toISOString().split("T")[0];

  // ╔══════════════════════════════════════════════════════════════╗
  // ║  INFRASTRUCTURE                                             ║
  // ╚══════════════════════════════════════════════════════════════╝

  // ═══ 1. ENVIRONMENT VARIABLES ═══
  const envVars: Record<string, string[]> = {
    critical: ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"],
    integrations: ["GOOGLE_SERVICE_ACCOUNT_JSON", "GOOGLE_DRIVE_ROOT_FOLDER_ID"],
    monitoring: ["HEALTH_CHECK_SECRET"],
  };
  const allVars = Object.values(envVars).flat();
  const missing = allVars.filter((v) => !process.env[v]);
  const criticalMissing = envVars.critical.filter((v) => !process.env[v]);
  checks["01_environment"] = criticalMissing.length > 0
    ? fail(`Critical vars missing: ${criticalMissing.join(", ")}`, { missing })
    : missing.length > 0
      ? warn(`Non-critical missing: ${missing.join(", ")}`, { missing })
      : pass(`All ${allVars.length} env vars set`);

  // ═══ 2. SUPABASE CONNECTION + LATENCY ═══
  try {
    const times: number[] = [];
    for (let i = 0; i < 3; i++) {
      const s = Date.now();
      await admin.from("team_members").select("id").limit(1);
      times.push(Date.now() - s);
    }
    const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
    const max = Math.max(...times);
    checks["02_supabase_connection"] = max > 3000
      ? warn(`Connected but slow — avg ${avg}ms, max ${max}ms`, { times, avg, max })
      : pass(`Connected — avg ${avg}ms`, { times, avg, max });
  } catch (e: any) {
    checks["02_supabase_connection"] = fail(`Connection error: ${e.message}`);
  }

  // ═══ 3. GOOGLE DRIVE ═══
  try {
    const saJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    const rootFolder = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
    if (!saJson || !rootFolder) {
      checks["03_google_drive"] = warn("Drive env vars not configured");
    } else {
      const { getAccessToken, getRootFolderId } = await import("@/lib/google-drive");
      const driveToken = await getAccessToken();
      const folderId = getRootFolderId();

      // Check root folder accessible
      const folderRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${folderId}?fields=id,name&supportsAllDrives=true`,
        { headers: { Authorization: `Bearer ${driveToken}` } }
      );

      if (!folderRes.ok) {
        checks["03_google_drive"] = fail(`Root folder inaccessible — HTTP ${folderRes.status}`);
      } else {
        const folder = await folderRes.json();

        // Count files in root folder
        const listRes = await fetch(
          `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents&fields=files(id,name,mimeType)&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true`,
          { headers: { Authorization: `Bearer ${driveToken}` } }
        );
        const listData = listRes.ok ? await listRes.json() : { files: [] };
        const files = listData.files || [];
        const folders = files.filter((f: any) => f.mimeType === "application/vnd.google-apps.folder");
        const nonFolders = files.filter((f: any) => f.mimeType !== "application/vnd.google-apps.folder");

        checks["03_google_drive"] = pass(`Root: "${folder.name}" — ${folders.length} subfolders, ${nonFolders.length} files`, {
          rootFolder: folder.name,
          subfolders: folders.map((f: any) => f.name),
          fileCount: nonFolders.length,
        });
      }
    }
  } catch (e: any) {
    checks["03_google_drive"] = fail(`Drive error: ${e.message}`);
  }

  // ═══ 4. SITE AVAILABILITY ═══
  try {
    const siteUrl = "https://smm.ten80ten.com";
    const r = await timedFetch(siteUrl, { method: "HEAD" });
    checks["04_site_availability"] = r.ok
      ? r.ms > 3000 ? warn(`Responding but slow (${r.ms}ms)`) : pass(`${siteUrl} — ${r.ms}ms, HTTP ${r.status}`)
      : fail(`Unreachable — ${r.body || `HTTP ${r.status}`} (${r.ms}ms)`);
  } catch (e: any) {
    checks["04_site_availability"] = fail(`Site check error: ${e.message}`);
  }

  // ═══ 5. API ENDPOINT SELF-TEST ═══
  try {
    const base = "https://smm.ten80ten.com";
    const endpoints = ["/api/team/invite", "/api/notifications/mention", "/api/notifications/revision"];
    const results: Record<string, string> = {};
    for (const ep of endpoints) {
      const r = await timedFetch(`${base}${ep}`, { method: "POST", timeout: 8000, headers: { "Content-Type": "application/json" }, body: "{}" });
      // We expect 400/401/405 (not 500/502/503) — endpoint is alive and rejecting bad input
      results[ep] = r.status >= 500 ? `DEAD (${r.status})` : `alive (${r.status}, ${r.ms}ms)`;
    }
    const dead = Object.entries(results).filter(([, v]) => v.startsWith("DEAD"));
    checks["05_api_endpoints"] = dead.length > 0
      ? fail(`${dead.length} endpoint(s) down: ${dead.map(([k]) => k).join(", ")}`, results)
      : pass(`All ${endpoints.length} API endpoints responding`, results);
  } catch (e: any) {
    checks["05_api_endpoints"] = fail(`API self-test error: ${e.message}`);
  }

  // ╔══════════════════════════════════════════════════════════════╗
  // ║  SECURITY                                                    ║
  // ╚══════════════════════════════════════════════════════════════╝

  // ═══ 6. ROW-LEVEL SECURITY ═══
  try {
    if (!anonKey) {
      checks["06_rls_security"] = warn("Anon key not available — cannot test RLS");
    } else {
      const anonClient = createClient(url, anonKey);
      // Anon should NOT be able to list all team members without auth
      const { data: anonMembers, error: anonErr } = await anonClient.from("team_members").select("email").limit(5);
      // Anon should NOT be able to delete posts
      const { error: deleteErr } = await anonClient.from("posts").delete().eq("id", "00000000-0000-0000-0000-000000000000");
      // Anon should NOT be able to read audit logs
      const { data: anonAudit, error: auditErr } = await anonClient.from("post_audit_logs").select("id").limit(1);

      const issues: string[] = [];
      if (!anonErr && anonMembers && anonMembers.length > 0) issues.push("CRITICAL: Anon can read team_members emails");
      if (!deleteErr) issues.push("CRITICAL: Anon delete on posts did not error");
      if (!auditErr && anonAudit && anonAudit.length > 0) issues.push("Anon can read audit logs (may be intentional)");

      checks["06_rls_security"] = issues.some((i) => i.startsWith("CRITICAL"))
        ? fail(issues.join("; "))
        : issues.length > 0 ? warn(issues.join("; ")) : pass("RLS policies blocking anonymous access correctly");
    }
  } catch (e: any) {
    checks["06_rls_security"] = fail(`RLS check error: ${e.message}`);
  }

  // ═══ 7. AUTH CONSISTENCY ═══
  let authUsers: any[] = [];
  let allMembers: any[] = [];
  try {
    const { data: authData, error: authError } = await admin.auth.admin.listUsers({ perPage: 1000 });
    if (authError) throw authError;
    authUsers = authData?.users || [];

    const { data: members } = await admin.from("team_members").select("*");
    allMembers = members || [];
    const memberEmails = new Set(allMembers.map((m) => m.email?.toLowerCase()));
    const authEmails = new Set(authUsers.map((u) => u.email?.toLowerCase()).filter(Boolean));

    const orphanedAuth = authUsers.filter((u) => u.email && !memberEmails.has(u.email.toLowerCase())).map((u) => u.email);
    const orphanedMembers = allMembers.filter((m) => m.email && !authEmails.has(m.email.toLowerCase()) && m.status === "active").map((m) => m.email);
    const pendingWithAuth = allMembers.filter((m) => m.status === "pending" && m.email && authEmails.has(m.email.toLowerCase())).map((m) => m.email);

    // Check for users who haven't confirmed email
    const unconfirmed = authUsers.filter((u) => !u.email_confirmed_at).map((u) => u.email);

    // Check last sign-in — users with auth but never logged in
    const neverLoggedIn = authUsers.filter((u) => !u.last_sign_in_at && u.email && memberEmails.has(u.email.toLowerCase())).map((u) => u.email);

    const issues: string[] = [];
    if (orphanedAuth.length > 0) issues.push(`${orphanedAuth.length} auth user(s) without team record: ${orphanedAuth.join(", ")}`);
    if (orphanedMembers.length > 0) issues.push(`${orphanedMembers.length} active member(s) without auth: ${orphanedMembers.join(", ")}`);
    if (pendingWithAuth.length > 0) issues.push(`${pendingWithAuth.length} pending with auth session: ${pendingWithAuth.join(", ")}`);
    if (unconfirmed.length > 0) issues.push(`${unconfirmed.length} unconfirmed email(s): ${unconfirmed.join(", ")}`);
    if (neverLoggedIn.length > 0) issues.push(`${neverLoggedIn.length} never logged in: ${neverLoggedIn.join(", ")}`);

    checks["07_auth_consistency"] = issues.length > 0
      ? warn(issues.join("; "), { authUsers: authUsers.length, teamMembers: allMembers.length, orphanedAuth, orphanedMembers, pendingWithAuth, unconfirmed, neverLoggedIn })
      : pass(`${authUsers.length} auth users, ${allMembers.length} team members — all synced`);
  } catch (e: any) {
    checks["07_auth_consistency"] = fail(`Auth check error: ${e.message}`);
  }

  // ═══ 8. SECRETS SCAN ═══
  try {
    const { data: posts } = await admin.from("posts").select("id, title, notes, caption");
    const secretPatterns = [
      /sk[-_]live[-_]\w+/i, /sk[-_]test[-_]\w+/i, // Stripe keys
      /eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}/,  // JWT tokens
      /supabase.*key.*[:=]\s*\S{30}/i, // Supabase keys
      /password\s*[:=]\s*\S{6,}/i, // Passwords in plain text
      /AKIA[0-9A-Z]{16}/, // AWS keys
      /ghp_[a-zA-Z0-9]{36}/, // GitHub tokens
    ];
    const exposedPosts: string[] = [];
    (posts || []).forEach((p) => {
      const text = `${p.title || ""} ${p.notes || ""} ${p.caption || ""}`;
      if (secretPatterns.some((rx) => rx.test(text))) exposedPosts.push(p.id);
    });
    checks["08_secrets_scan"] = exposedPosts.length > 0
      ? fail(`${exposedPosts.length} post(s) may contain exposed secrets/tokens`, { postIds: exposedPosts })
      : pass(`${(posts || []).length} posts scanned — no secrets found`);
  } catch (e: any) {
    checks["08_secrets_scan"] = fail(`Secrets scan error: ${e.message}`);
  }

  // ╔══════════════════════════════════════════════════════════════╗
  // ║  DATA INTEGRITY                                              ║
  // ╚══════════════════════════════════════════════════════════════╝

  // ═══ 9. TABLE STATS ═══
  let tableCounts: Record<string, number> = {};
  try {
    const tables = ["posts", "team_members", "post_audit_logs", "media_assets", "post_comments", "signup_requests"];
    for (const t of tables) {
      const { count, error } = await admin.from(t).select("*", { count: "exact", head: true });
      tableCounts[t] = error ? -1 : (count || 0);
    }
    const failing = Object.entries(tableCounts).filter(([, c]) => c === -1).map(([t]) => t);
    checks["09_table_stats"] = failing.length > 0
      ? warn(`Unreachable: ${failing.join(", ")}`, tableCounts)
      : pass(`All ${tables.length} tables accessible`, tableCounts);
  } catch (e: any) {
    checks["09_table_stats"] = fail(`Table scan error: ${e.message}`);
  }

  // ═══ 10. CROSS-TABLE INTEGRITY ═══
  try {
    const { data: posts } = await admin.from("posts").select("id, created_by, thumbnail_url");
    const memberNames = new Set(allMembers.map((m) => m.name));

    // Posts created by people not in team
    const unknownCreators = (posts || []).filter((p) => p.created_by && !memberNames.has(p.created_by));
    const uniqueUnknown = [...new Set(unknownCreators.map((p) => p.created_by))];

    // Media assets referencing non-existent posts
    const { data: media } = await admin.from("media_assets").select("id, post_id");
    const postIds = new Set((posts || []).map((p) => p.id));
    const orphanedMedia = (media || []).filter((m) => m.post_id && !postIds.has(m.post_id));

    // Audit logs referencing non-existent posts
    const { data: auditSample } = await admin.from("post_audit_logs").select("id, post_id").limit(200);
    const orphanedAudits = (auditSample || []).filter((a) => a.post_id && !postIds.has(a.post_id));

    const issues: string[] = [];
    if (uniqueUnknown.length > 0) issues.push(`${uniqueUnknown.length} unknown creator(s): ${uniqueUnknown.join(", ")}`);
    if (orphanedMedia.length > 0) issues.push(`${orphanedMedia.length} media asset(s) referencing deleted posts`);
    if (orphanedAudits.length > 0) issues.push(`${orphanedAudits.length} audit entries referencing deleted posts (sampled 200)`);

    checks["10_cross_table_integrity"] = issues.length > 0
      ? warn(issues.join("; "), { unknownCreators: uniqueUnknown, orphanedMedia: orphanedMedia.length, orphanedAudits: orphanedAudits.length })
      : pass("All cross-table references valid");
  } catch (e: any) {
    checks["10_cross_table_integrity"] = fail(`Integrity check error: ${e.message}`);
  }

  // ═══ 11. TIMESTAMP SANITY ═══
  try {
    const issues: string[] = [];
    // Posts with created_at in the future
    const { data: futurePosts } = await admin.from("posts").select("id").gt("created_at", now.toISOString());
    if ((futurePosts || []).length > 0) issues.push(`${futurePosts!.length} post(s) with future created_at`);

    // Team members with future joined_at
    const { data: futureMembers } = await admin.from("team_members").select("id, email").gt("joined_at", now.toISOString());
    if ((futureMembers || []).length > 0) issues.push(`${futureMembers!.length} member(s) with future joined_at`);

    // Posts with invalid scheduled dates (format check)
    const { data: allPosts } = await admin.from("posts").select("id, scheduled_date").not("scheduled_date", "is", null);
    const badDates = (allPosts || []).filter((p) => p.scheduled_date && !/^\d{4}-\d{2}-\d{2}$/.test(p.scheduled_date));
    if (badDates.length > 0) issues.push(`${badDates.length} post(s) with malformed scheduled_date`);

    checks["11_timestamp_sanity"] = issues.length > 0
      ? warn(issues.join("; "), { futurePosts: (futurePosts || []).length, futureMembers: (futureMembers || []).length, badDates: badDates.length })
      : pass("All timestamps valid");
  } catch (e: any) {
    checks["11_timestamp_sanity"] = fail(`Timestamp check error: ${e.message}`);
  }

  // ═══ 12. NULL / EMPTY FIELD AUDIT ═══
  try {
    const { data: posts } = await admin.from("posts").select("id, title, stage, platforms, created_by");
    const { data: members } = await admin.from("team_members").select("id, name, email, role, status");

    const postIssues: string[] = [];
    const noTitle = (posts || []).filter((p) => !p.title?.trim());
    const noStage = (posts || []).filter((p) => !p.stage);
    const noPlatforms = (posts || []).filter((p) => !p.platforms || p.platforms.length === 0);
    const noCreator = (posts || []).filter((p) => !p.created_by);
    if (noTitle.length) postIssues.push(`${noTitle.length} without title`);
    if (noStage.length) postIssues.push(`${noStage.length} without stage`);
    if (noPlatforms.length) postIssues.push(`${noPlatforms.length} without platforms`);
    if (noCreator.length) postIssues.push(`${noCreator.length} without creator`);

    const memberIssues: string[] = [];
    const noName = (members || []).filter((m) => !m.name?.trim());
    const noEmail = (members || []).filter((m) => !m.email?.trim());
    const noRole = (members || []).filter((m) => !m.role);
    const dupeEmails = (members || []).map((m) => m.email?.toLowerCase()).filter((e, i, arr) => e && arr.indexOf(e) !== i);
    if (noName.length) memberIssues.push(`${noName.length} without name`);
    if (noEmail.length) memberIssues.push(`${noEmail.length} without email`);
    if (noRole.length) memberIssues.push(`${noRole.length} without role`);
    if (dupeEmails.length) memberIssues.push(`Duplicate emails: ${[...new Set(dupeEmails)].join(", ")}`);

    const allIssues = [...postIssues.map((i) => `Posts: ${i}`), ...memberIssues.map((i) => `Members: ${i}`)];
    checks["12_field_audit"] = allIssues.length > 0
      ? warn(allIssues.join("; "), { posts: postIssues, members: memberIssues })
      : pass(`All required fields populated across ${(posts || []).length} posts and ${(members || []).length} members`);
  } catch (e: any) {
    checks["12_field_audit"] = fail(`Field audit error: ${e.message}`);
  }

  // ╔══════════════════════════════════════════════════════════════╗
  // ║  TEAM HEALTH                                                 ║
  // ╚══════════════════════════════════════════════════════════════╝

  // ═══ 13. TEAM MEMBER HEALTH ═══
  try {
    const active = allMembers.filter((m) => m.status === "active");
    const pending = allMembers.filter((m) => m.status === "pending");
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const stalePending = pending.filter((m) => m.joined_at && m.joined_at < sevenDaysAgo);
    const noAvatar = active.filter((m) => !m.avatar_url);

    const issues: string[] = [];
    if (stalePending.length > 0) issues.push(`${stalePending.length} stale invite(s) >7 days: ${stalePending.map((m) => m.email).join(", ")}`);
    if (noAvatar.length > 0) issues.push(`${noAvatar.length} active member(s) without avatar`);
    if (active.length === 0) issues.push("CRITICAL: Zero active team members");

    checks["13_team_health"] = issues.some((i) => i.startsWith("CRITICAL"))
      ? fail(issues.join("; "), { active: active.length, pending: pending.length })
      : issues.length > 0
        ? warn(issues.join("; "), { active: active.length, pending: pending.length, stalePending: stalePending.map((m) => m.email), noAvatar: noAvatar.map((m) => m.name) })
        : pass(`${active.length} active, ${pending.length} pending — all healthy`, { active: active.length, pending: pending.length });
  } catch (e: any) {
    checks["13_team_health"] = fail(`Team health error: ${e.message}`);
  }

  // ═══ 14. USER ACTIVITY ANALYSIS ═══
  try {
    // Last login per auth user
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const inactive = authUsers.filter((u) => u.last_sign_in_at && u.last_sign_in_at < thirtyDaysAgo && u.email);
    const neverSignedIn = authUsers.filter((u) => !u.last_sign_in_at && u.email);

    // Most active users by audit log (last 7 days)
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: weekLogs } = await admin.from("post_audit_logs").select("user_name").gte("created_at", weekAgo);
    const activityMap: Record<string, number> = {};
    (weekLogs || []).forEach((l) => { activityMap[l.user_name] = (activityMap[l.user_name] || 0) + 1; });
    const topUsers = Object.entries(activityMap).sort(([, a], [, b]) => b - a).slice(0, 5);

    // Members with zero audit entries ever
    const { data: allAuditNames } = await admin.from("post_audit_logs").select("user_name");
    const auditNames = new Set((allAuditNames || []).map((a) => a.user_name));
    const ghostMembers = allMembers.filter((m) => m.status === "active" && !auditNames.has(m.name)).map((m) => m.name);

    const issues: string[] = [];
    if (inactive.length > 0) issues.push(`${inactive.length} user(s) inactive >30 days: ${inactive.map((u) => u.email).join(", ")}`);
    if (neverSignedIn.length > 0) issues.push(`${neverSignedIn.length} user(s) never logged in: ${neverSignedIn.map((u) => u.email).join(", ")}`);
    if (ghostMembers.length > 0) issues.push(`${ghostMembers.length} active member(s) with zero activity: ${ghostMembers.join(", ")}`);

    checks["14_user_activity"] = issues.length > 0
      ? warn(issues.join("; "), { inactive: inactive.map((u) => u.email), neverSignedIn: neverSignedIn.map((u) => u.email), ghostMembers, topUsersThisWeek: topUsers })
      : pass(`All users active, top this week: ${topUsers.map(([n, c]) => `${n} (${c})`).join(", ")}`, { topUsersThisWeek: topUsers });
  } catch (e: any) {
    checks["14_user_activity"] = fail(`Activity analysis error: ${e.message}`);
  }

  // ╔══════════════════════════════════════════════════════════════╗
  // ║  CONTENT & PIPELINE                                          ║
  // ╚══════════════════════════════════════════════════════════════╝

  // ═══ 15. PIPELINE FLOW ANALYSIS ═══
  try {
    const { data: posts } = await admin.from("posts").select("id, stage, scheduled_date, created_at, updated_at");
    if (!posts) throw new Error("No posts");

    const stages: Record<string, number> = {};
    posts.forEach((p) => { stages[p.stage] = (stages[p.stage] || 0) + 1; });

    // Bottleneck: which stage has the most posts (excluding "posted")
    const activeStages = Object.entries(stages).filter(([k]) => k !== "posted");
    const bottleneck = activeStages.sort(([, a], [, b]) => b - a)[0];

    // Overdue: scheduled in the past, still in approved_scheduled
    const overdue = posts.filter((p) => p.stage === "approved_scheduled" && p.scheduled_date && p.scheduled_date < todayStr);

    // Stuck: in ideas/revision for >14 days
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const stuck = posts.filter((p) =>
      (p.stage === "ideas" || p.stage === "revision_needed") &&
      p.updated_at && p.updated_at < fourteenDaysAgo
    );

    // Future-dated but in wrong stage
    const futureWrongStage = posts.filter((p) =>
      p.scheduled_date && p.scheduled_date >= todayStr &&
      (p.stage === "ideas" || p.stage === "revision_needed")
    );

    const issues: string[] = [];
    if (overdue.length > 0) issues.push(`${overdue.length} overdue scheduled post(s)`);
    if (stuck.length > 0) issues.push(`${stuck.length} post(s) stuck in ideas/revision >14 days`);
    if (futureWrongStage.length > 0) issues.push(`${futureWrongStage.length} future-dated post(s) in wrong stage`);
    if (bottleneck && bottleneck[1] > 10) issues.push(`Pipeline bottleneck: ${bottleneck[1]} posts in "${bottleneck[0]}"`);

    checks["15_pipeline_flow"] = issues.length > 0
      ? warn(issues.join("; "), { stages, overdue: overdue.length, stuck: stuck.length, bottleneck: bottleneck ? { stage: bottleneck[0], count: bottleneck[1] } : null })
      : pass(`Pipeline healthy — ${posts.length} total posts`, { stages, bottleneck: bottleneck ? { stage: bottleneck[0], count: bottleneck[1] } : null });
  } catch (e: any) {
    checks["15_pipeline_flow"] = fail(`Pipeline analysis error: ${e.message}`);
  }

  // ═══ 16. CONTENT QUALITY ═══
  try {
    const { data: posts } = await admin.from("posts").select("id, title, caption, platforms, thumbnail_url, scheduled_date, stage");
    const issues: string[] = [];

    // Very short titles
    const shortTitles = (posts || []).filter((p) => p.title && p.title.trim().length < 5 && p.title.trim().length > 0);
    if (shortTitles.length > 0) issues.push(`${shortTitles.length} post(s) with very short titles (<5 chars)`);

    // No caption for scheduled/approved posts
    const noCaptions = (posts || []).filter((p) =>
      (p.stage === "approved_scheduled" || p.stage === "awaiting_approval") && (!p.caption || p.caption.trim() === "")
    );
    if (noCaptions.length > 0) issues.push(`${noCaptions.length} approved/scheduled post(s) without captions`);

    // Platform distribution
    const platCounts: Record<string, number> = {};
    (posts || []).forEach((p) => (p.platforms || []).forEach((pl: string) => { platCounts[pl] = (platCounts[pl] || 0) + 1; }));

    // Posts scheduled for today with no thumbnail
    const todayNoThumb = (posts || []).filter((p) => p.scheduled_date === todayStr && !p.thumbnail_url);
    if (todayNoThumb.length > 0) issues.push(`${todayNoThumb.length} post(s) scheduled TODAY without thumbnail`);

    checks["16_content_quality"] = issues.length > 0
      ? warn(issues.join("; "), { shortTitles: shortTitles.length, noCaptions: noCaptions.length, platformDistribution: platCounts, todayNoThumbnail: todayNoThumb.length })
      : pass(`Content quality good across ${(posts || []).length} posts`, { platformDistribution: platCounts });
  } catch (e: any) {
    checks["16_content_quality"] = fail(`Content quality error: ${e.message}`);
  }

  // ═══ 17. THUMBNAIL SPOT-CHECK ═══
  try {
    const { data: posts } = await admin.from("posts").select("id, thumbnail_url").not("thumbnail_url", "is", null).limit(10);
    let broken = 0;
    let checked = 0;
    for (const p of (posts || []).slice(0, 10)) {
      if (!p.thumbnail_url) continue;
      checked++;
      const r = await timedFetch(p.thumbnail_url, { method: "HEAD", timeout: 5000 });
      if (!r.ok) broken++;
    }
    checks["17_thumbnail_check"] = broken > 0
      ? warn(`${broken}/${checked} sampled thumbnails returned errors`, { checked, broken })
      : pass(`${checked} thumbnails spot-checked — all reachable`);
  } catch (e: any) {
    checks["17_thumbnail_check"] = fail(`Thumbnail check error: ${e.message}`);
  }

  // ═══ 18. MEDIA HEALTH ═══
  try {
    const { data: media, count } = await admin.from("media_assets").select("id, url, drive_file_id, added_by, post_id", { count: "exact" });
    const noUrl = (media || []).filter((m) => !m.url && !m.drive_file_id);
    const noOwner = (media || []).filter((m) => !m.added_by);
    const noPost = (media || []).filter((m) => !m.post_id);

    const issues: string[] = [];
    if (noUrl.length > 0) issues.push(`${noUrl.length} asset(s) with no URL or Drive file`);
    if (noOwner.length > 0) issues.push(`${noOwner.length} asset(s) with no owner`);
    if (noPost.length > 0) issues.push(`${noPost.length} unlinked asset(s) (no post_id)`);

    checks["18_media_health"] = issues.length > 0
      ? warn(issues.join("; "), { total: count, noUrl: noUrl.length, noOwner: noOwner.length, noPost: noPost.length })
      : pass(`${count || 0} media assets — all linked and intact`);
  } catch (e: any) {
    checks["18_media_health"] = fail(`Media check error: ${e.message}`);
  }

  // ╔══════════════════════════════════════════════════════════════╗
  // ║  OBSERVABILITY                                               ║
  // ╚══════════════════════════════════════════════════════════════╝

  // ═══ 19. AUDIT LOG COMPLETENESS ═══
  try {
    const { count: total } = await admin.from("post_audit_logs").select("*", { count: "exact", head: true });
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count: last24h } = await admin.from("post_audit_logs").select("*", { count: "exact", head: true }).gte("created_at", yesterday);
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { count: lastWeek } = await admin.from("post_audit_logs").select("*", { count: "exact", head: true }).gte("created_at", weekAgo);

    // Action type breakdown this week
    const { data: weekActions } = await admin.from("post_audit_logs").select("action_type").gte("created_at", weekAgo);
    const breakdown: Record<string, number> = {};
    (weekActions || []).forEach((a) => { breakdown[a.action_type] = (breakdown[a.action_type] || 0) + 1; });

    const avgDaily = lastWeek ? Math.round((lastWeek || 0) / 7) : 0;

    checks["19_audit_completeness"] = (total || 0) === 0
      ? warn("Audit log empty — no activity tracked")
      : pass(`${total} total, ${last24h || 0} today, ~${avgDaily}/day avg`, { total, last24h, lastWeek, avgDaily, weeklyBreakdown: breakdown });
  } catch (e: any) {
    checks["19_audit_completeness"] = fail(`Audit check error: ${e.message}`);
  }

  // ═══ 20. GROWTH METRICS ═══
  try {
    // Posts created per day this week
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: recentPosts } = await admin.from("posts").select("created_at").gte("created_at", weekAgo);
    const dailyPosts: Record<string, number> = {};
    (recentPosts || []).forEach((p) => {
      const day = p.created_at?.split("T")[0] || "unknown";
      dailyPosts[day] = (dailyPosts[day] || 0) + 1;
    });

    // Team growth
    const { data: recentMembers } = await admin.from("team_members").select("joined_at, status").gte("joined_at", weekAgo);
    const newMembers = (recentMembers || []).length;

    // Posts per active member
    const activeCount = allMembers.filter((m) => m.status === "active").length;
    const postsPerMember = activeCount > 0 ? Math.round(tableCounts.posts / activeCount) : 0;

    checks["20_growth_metrics"] = pass(
      `${(recentPosts || []).length} posts this week, ${newMembers} new member(s), ${postsPerMember} posts/member`,
      { postsThisWeek: (recentPosts || []).length, dailyBreakdown: dailyPosts, newMembers, postsPerActiveMember: postsPerMember }
    );
  } catch (e: any) {
    checks["20_growth_metrics"] = fail(`Growth metrics error: ${e.message}`);
  }

  // ═══ SUMMARY ═══
  const all = Object.values(checks);
  const summary = {
    total: all.length,
    passed: all.filter((c) => c.status === "pass").length,
    warnings: all.filter((c) => c.status === "warn").length,
    failures: all.filter((c) => c.status === "fail").length,
    grade: "",
  };
  summary.grade = summary.failures > 0 ? "CRITICAL" : summary.warnings > 3 ? "NEEDS ATTENTION" : summary.warnings > 0 ? "MOSTLY HEALTHY" : "ALL CLEAR";

  return NextResponse.json({ timestamp: now.toISOString(), grade: summary.grade, checks, summary });
}
