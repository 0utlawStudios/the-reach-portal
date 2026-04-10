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

function pass(message: string, details?: any): Check { return { status: "pass", message, details }; }
function warn(message: string, details?: any): Check { return { status: "warn", message, details }; }
function fail(message: string, details?: any): Check { return { status: "fail", message, details }; }

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

  // ═══ 1. ENVIRONMENT VARIABLES ═══
  const envVars = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "GOOGLE_SERVICE_ACCOUNT_JSON",
    "GOOGLE_DRIVE_ROOT_FOLDER_ID",
    "HEALTH_CHECK_SECRET",
  ];
  const missing = envVars.filter((v) => !process.env[v]);
  checks.environment = missing.length === 0
    ? pass(`All ${envVars.length} env vars set`)
    : warn(`Missing: ${missing.join(", ")}`, { missing });

  // ═══ 2. SUPABASE CONNECTION ═══
  try {
    const start = Date.now();
    const { error } = await admin.from("team_members").select("id").limit(1);
    const latency = Date.now() - start;
    checks.supabase_connection = error
      ? fail(`DB query failed: ${error.message}`)
      : pass(`Connected (${latency}ms)`);
  } catch (e: any) {
    checks.supabase_connection = fail(`Connection error: ${e.message}`);
  }

  // ═══ 3. TABLE STATS ═══
  try {
    const tables = ["posts", "team_members", "post_audit_logs", "media_assets", "post_comments", "signup_requests"];
    const counts: Record<string, number> = {};
    for (const t of tables) {
      const { count, error } = await admin.from(t).select("*", { count: "exact", head: true });
      counts[t] = error ? -1 : (count || 0);
    }
    const failing = Object.entries(counts).filter(([, c]) => c === -1).map(([t]) => t);
    checks.table_stats = failing.length > 0
      ? warn(`Tables unreachable: ${failing.join(", ")}`, counts)
      : pass(`All tables accessible`, counts);
  } catch (e: any) {
    checks.table_stats = fail(`Table scan error: ${e.message}`);
  }

  // ═══ 4. TEAM HEALTH ═══
  try {
    const { data: members } = await admin.from("team_members").select("*");
    if (!members) throw new Error("No team data");

    const active = members.filter((m) => m.status === "active");
    const pending = members.filter((m) => m.status === "pending");
    const noName = members.filter((m) => !m.name || m.name.trim() === "");
    const noEmail = members.filter((m) => !m.email);
    const emails = members.map((m) => m.email?.toLowerCase());
    const dupes = emails.filter((e, i) => e && emails.indexOf(e) !== i);

    // Stale pending: invited > 7 days ago, still pending
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const stalePending = pending.filter((m) => m.joined_at && m.joined_at < sevenDaysAgo);

    const issues: string[] = [];
    if (noName.length > 0) issues.push(`${noName.length} member(s) without names`);
    if (noEmail.length > 0) issues.push(`${noEmail.length} member(s) without emails`);
    if (dupes.length > 0) issues.push(`Duplicate emails: ${dupes.join(", ")}`);
    if (stalePending.length > 0) issues.push(`${stalePending.length} stale pending invite(s) (>7 days): ${stalePending.map((m) => m.email).join(", ")}`);

    checks.team_health = issues.length > 0
      ? warn(issues.join("; "), { total: members.length, active: active.length, pending: pending.length, stalePending: stalePending.map((m) => m.email), duplicateEmails: dupes })
      : pass(`${active.length} active, ${pending.length} pending`, { total: members.length, active: active.length, pending: pending.length });
  } catch (e: any) {
    checks.team_health = fail(`Team check error: ${e.message}`);
  }

  // ═══ 5. POST HEALTH ═══
  try {
    const { data: posts } = await admin.from("posts").select("id, title, stage, platforms, thumbnail_url, scheduled_date, created_by, notes");
    if (!posts) throw new Error("No post data");

    const stages: Record<string, number> = {};
    posts.forEach((p) => { stages[p.stage] = (stages[p.stage] || 0) + 1; });

    const noTitle = posts.filter((p) => !p.title || p.title.trim() === "");
    const noPlatforms = posts.filter((p) => !p.platforms || p.platforms.length === 0);
    const noThumbnail = posts.filter((p) => !p.thumbnail_url);
    const noCreator = posts.filter((p) => !p.created_by);

    // Posts scheduled in the past but still in approved_scheduled
    const now = new Date().toISOString().split("T")[0];
    const overdue = posts.filter((p) => p.stage === "approved_scheduled" && p.scheduled_date && p.scheduled_date < now);

    // Posts with future dates but stuck in ideas/revision
    const futureStuck = posts.filter((p) =>
      p.scheduled_date && p.scheduled_date >= now &&
      (p.stage === "ideas" || p.stage === "revision_needed")
    );

    const issues: string[] = [];
    if (noTitle.length > 0) issues.push(`${noTitle.length} post(s) without titles`);
    if (noPlatforms.length > 0) issues.push(`${noPlatforms.length} post(s) without platforms`);
    if (noThumbnail.length > 0) issues.push(`${noThumbnail.length} post(s) without thumbnails`);
    if (noCreator.length > 0) issues.push(`${noCreator.length} post(s) without creator`);
    if (overdue.length > 0) issues.push(`${overdue.length} overdue post(s) still in approved_scheduled`);
    if (futureStuck.length > 0) issues.push(`${futureStuck.length} post(s) with future dates stuck in ideas/revision`);

    checks.post_health = issues.length > 0
      ? warn(issues.join("; "), { total: posts.length, stages, overdueIds: overdue.map((p) => p.id), futureStuckIds: futureStuck.map((p) => p.id) })
      : pass(`${posts.length} posts, all healthy`, { total: posts.length, stages });
  } catch (e: any) {
    checks.post_health = fail(`Post check error: ${e.message}`);
  }

  // ═══ 6. AUTH HEALTH ═══
  try {
    const { data: authData, error: authError } = await admin.auth.admin.listUsers({ perPage: 1000 });
    if (authError) throw authError;
    const authUsers = authData?.users || [];

    const { data: members } = await admin.from("team_members").select("email, status");
    const memberEmails = new Set((members || []).map((m) => m.email?.toLowerCase()));
    const authEmails = new Set(authUsers.map((u) => u.email?.toLowerCase()).filter(Boolean));

    // Auth users with no team_members record
    const orphanedAuth = authUsers.filter((u) => u.email && !memberEmails.has(u.email.toLowerCase())).map((u) => u.email);

    // Team members with no auth user
    const orphanedMembers = (members || []).filter((m) => m.email && !authEmails.has(m.email.toLowerCase()) && m.status === "active").map((m) => m.email);

    // Pending members who DO have auth sessions (should have been auto-activated)
    const pendingWithAuth = (members || []).filter((m) => m.status === "pending" && m.email && authEmails.has(m.email.toLowerCase())).map((m) => m.email);

    const issues: string[] = [];
    if (orphanedAuth.length > 0) issues.push(`${orphanedAuth.length} auth user(s) without team record: ${orphanedAuth.join(", ")}`);
    if (orphanedMembers.length > 0) issues.push(`${orphanedMembers.length} active member(s) without auth account: ${orphanedMembers.join(", ")}`);
    if (pendingWithAuth.length > 0) issues.push(`${pendingWithAuth.length} pending member(s) with active auth (should be auto-activated): ${pendingWithAuth.join(", ")}`);

    checks.auth_health = issues.length > 0
      ? warn(issues.join("; "), { authUsers: authUsers.length, teamMembers: (members || []).length, orphanedAuth, orphanedMembers, pendingWithAuth })
      : pass(`${authUsers.length} auth users, ${(members || []).length} team members — all matched`, { authUsers: authUsers.length, teamMembers: (members || []).length });
  } catch (e: any) {
    checks.auth_health = fail(`Auth check error: ${e.message}`);
  }

  // ═══ 7. AUDIT LOG HEALTH ═══
  try {
    const { count: totalAudit } = await admin.from("post_audit_logs").select("*", { count: "exact", head: true });

    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count: last24h } = await admin.from("post_audit_logs").select("*", { count: "exact", head: true }).gte("created_at", yesterday);

    const { data: recentActions } = await admin
      .from("post_audit_logs")
      .select("user_name, action_type")
      .order("created_at", { ascending: false })
      .limit(20);

    const actionBreakdown: Record<string, number> = {};
    (recentActions || []).forEach((a) => { actionBreakdown[a.action_type] = (actionBreakdown[a.action_type] || 0) + 1; });

    checks.audit_health = (totalAudit || 0) === 0
      ? warn("Audit log is empty — no activity tracked", { total: 0 })
      : pass(`${totalAudit} total entries, ${last24h || 0} in last 24h`, { total: totalAudit, last24h, recentActionTypes: actionBreakdown });
  } catch (e: any) {
    checks.audit_health = fail(`Audit check error: ${e.message}`);
  }

  // ═══ 8. MEDIA HEALTH ═══
  try {
    const { data: media, count } = await admin.from("media_assets").select("id, url, drive_file_id, added_by", { count: "exact" });
    const noUrl = (media || []).filter((m) => !m.url && !m.drive_file_id);
    const noOwner = (media || []).filter((m) => !m.added_by);

    const issues: string[] = [];
    if (noUrl.length > 0) issues.push(`${noUrl.length} asset(s) with no URL or Drive file ID`);
    if (noOwner.length > 0) issues.push(`${noOwner.length} asset(s) with no owner`);

    checks.media_health = issues.length > 0
      ? warn(issues.join("; "), { total: count, orphanedIds: noUrl.map((m) => m.id) })
      : pass(`${count || 0} media assets, all intact`);
  } catch (e: any) {
    checks.media_health = fail(`Media check error: ${e.message}`);
  }

  // ═══ 9. GOOGLE DRIVE ═══
  try {
    const saJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    const rootFolder = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
    if (!saJson || !rootFolder) {
      checks.google_drive = warn("Google Drive env vars not configured");
    } else {
      // Dynamic import to avoid build issues when not configured
      const { getAccessToken, getRootFolderId } = await import("@/lib/google-drive");
      const token = await getAccessToken();
      const folderId = getRootFolderId();
      const res = await fetch(
        `https://www.googleapis.com/drive/v3/files/${folderId}?fields=id,name&supportsAllDrives=true`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (res.ok) {
        const data = await res.json();
        checks.google_drive = pass(`Connected — root folder: "${data.name}"`);
      } else {
        checks.google_drive = fail(`Drive API ${res.status}: ${await res.text()}`);
      }
    }
  } catch (e: any) {
    checks.google_drive = fail(`Drive check error: ${e.message}`);
  }

  // ═══ 10. SITE AVAILABILITY ═══
  try {
    const siteUrl = "https://smm.ten80ten.com";
    const start = Date.now();
    const res = await fetch(siteUrl, { method: "HEAD", redirect: "follow" });
    const latency = Date.now() - start;
    checks.site_availability = res.ok
      ? pass(`${siteUrl} responding (${latency}ms, HTTP ${res.status})`)
      : warn(`${siteUrl} returned HTTP ${res.status} (${latency}ms)`);
  } catch (e: any) {
    checks.site_availability = fail(`Site unreachable: ${e.message}`);
  }

  // ═══ SUMMARY ═══
  const all = Object.values(checks);
  const summary = {
    total: all.length,
    passed: all.filter((c) => c.status === "pass").length,
    warnings: all.filter((c) => c.status === "warn").length,
    failures: all.filter((c) => c.status === "fail").length,
  };

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    checks,
    summary,
  });
}
