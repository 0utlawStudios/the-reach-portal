import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "node:crypto";

// ─── Auth ───

const HEALTH_SECRET = process.env.HEALTH_CHECK_SECRET;

// SEC-002: Constant-time secret comparison. A plain `!==` leaks the secret
// one byte at a time via response-timing differences.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

// ─── Types ───

type Status = "pass" | "warn" | "fail";
interface Check { status: Status; message: string; details?: unknown }

function pass(msg: string, d?: unknown): Check { return { status: "pass", message: msg, details: d }; }
function warn(msg: string, d?: unknown): Check { return { status: "warn", message: msg, details: d }; }
function fail(msg: string, d?: unknown): Check { return { status: "fail", message: msg, details: d }; }

type PostRow = {
  id?: string;
  title?: string | null;
  stage?: string | null;
  platforms?: string[] | null;
  thumbnail_url?: string | null;
  scheduled_date?: string | null;
  caption?: string | null;
  notes?: string | null;
  asset_source?: string | null;
  created_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  [key: string]: unknown;
};

type MediaRow = {
  id?: string;
  url?: string | null;
  file_id?: string | null;
  used_in?: string[] | null;
  added_by?: string | null;
};

// SEC-007: audit reads now target audit_log_v2 (migration 0009), the table
// the app actually writes to via record_audit_event(). Columns differ from
// the legacy post_audit_logs: the entity reference is `entity_id`, the verb
// is `action`, and the human actor name lives inside `metadata.user_name`.
type AuditRow = {
  id?: string;
  entity_id?: string | null;
  entity_type?: string | null;
  action?: string | null;
  actor_user_id?: string | null;
  actor_role?: string | null;
  metadata?: { user_name?: string | null } | null;
  created_at?: string | null;
};

type CommentRow = {
  id?: string;
  post_id?: string | null;
};

type TeamMemberRow = {
  id?: string;
  name?: string | null;
  email?: string | null;
  role?: string | null;
  status?: string | null;
  avatar_url?: string | null;
  phone?: string | null;
  joined_at?: string | null;
  [key: string]: unknown;
};

type AuthUser = {
  email?: string;
  email_confirmed_at?: string | null;
  last_sign_in_at?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
};

type DriveFile = {
  id?: string;
  name?: string;
  mimeType?: string;
};

type StorageBucket = {
  name?: string;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const POSTS_SELECT =
  "id, title, stage, platforms, thumbnail_url, scheduled_date, caption, notes, asset_source, created_by, created_at, updated_at";
const MEDIA_SELECT = "id, url, file_id, used_in, added_by";
const AUDIT_SELECT = "id, entity_id, entity_type, action, actor_user_id, actor_role, metadata, created_at";
const COMMENT_SELECT = "id, post_id";
const TEAM_MEMBER_SELECT = "id, name, email, role, status, avatar_url, phone, joined_at";

// ─── Helpers ───

async function timedFetch(url: string, opts?: RequestInit & { timeout?: number }): Promise<{ ok: boolean; status: number; ms: number; body?: string }> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts?.timeout || 10000);
    const res = await fetch(url, { ...opts, signal: controller.signal });
    clearTimeout(timer);
    return { ok: res.ok, status: res.status, ms: Date.now() - start };
  } catch (e: unknown) {
    return { ok: false, status: 0, ms: Date.now() - start, body: errorMessage(e) };
  }
}

// ─── Handler ───

export async function GET(req: Request) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!HEALTH_SECRET || !safeEqual(token ?? "", HEALTH_SECRET)) return unauthorized();

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

  // ═══ DATA CACHE — fetch once, reuse everywhere ═══
  let allPosts: PostRow[] = [];
  let allMedia: MediaRow[] = [];
  let allAuditLogs: AuditRow[] = [];
  let allComments: CommentRow[] = [];

  try {
    const [pRes, mRes, aRes, cRes] = await Promise.all([
      admin.from("posts").select(POSTS_SELECT),
      admin.from("media_assets").select(MEDIA_SELECT),
      // SEC-007: audit metrics read from audit_log_v2, the table the app writes to.
      admin.from("audit_log_v2").select(AUDIT_SELECT).order("created_at", { ascending: false }).limit(1000),
      admin.from("post_comments").select(COMMENT_SELECT),
    ]);
    if (pRes.error) checks["00_posts_prefetch"] = fail(`Posts prefetch failed: ${pRes.error.message}`);
    if (mRes.error) checks["00_media_prefetch"] = fail(`Media prefetch failed: ${mRes.error.message}`);
    if (aRes.error) checks["00_audit_prefetch"] = fail(`Audit prefetch failed: ${aRes.error.message}`);
    if (cRes.error) checks["00_comments_prefetch"] = fail(`Comments prefetch failed: ${cRes.error.message}`);
    allPosts = (pRes.data || []) as PostRow[];
    allMedia = (mRes.data || []) as MediaRow[];
    allAuditLogs = (aRes.data || []) as AuditRow[];
    allComments = (cRes.data || []) as CommentRow[];
  } catch {}

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
  } catch (e: unknown) {
    checks["02_supabase_connection"] = fail(`Connection error: ${errorMessage(e)}`);
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
        const folder = (await folderRes.json()) as DriveFile;

        // Count files in root folder
        const listRes = await fetch(
          `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents&fields=files(id,name,mimeType)&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true`,
          { headers: { Authorization: `Bearer ${driveToken}` } }
        );
        const listData = listRes.ok ? ((await listRes.json()) as { files?: DriveFile[] }) : { files: [] };
        const files = listData.files || [];
        const folders = files.filter((f: DriveFile) => f.mimeType === "application/vnd.google-apps.folder");
        const nonFolders = files.filter((f: DriveFile) => f.mimeType !== "application/vnd.google-apps.folder");

        checks["03_google_drive"] = pass(`Root: "${folder.name}" — ${folders.length} subfolders, ${nonFolders.length} files`, {
          rootFolder: folder.name,
          subfolders: folders.map((f: DriveFile) => f.name),
          fileCount: nonFolders.length,
        });
      }
    }
  } catch (e: unknown) {
    checks["03_google_drive"] = fail(`Drive error: ${errorMessage(e)}`);
  }

  // ═══ 4. SITE AVAILABILITY ═══
  try {
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
    const r = await timedFetch(siteUrl, { method: "HEAD" });
    checks["04_site_availability"] = r.ok
      ? r.ms > 3000 ? warn(`Responding but slow (${r.ms}ms)`) : pass(`${siteUrl} — ${r.ms}ms, HTTP ${r.status}`)
      : fail(`Unreachable — ${r.body || `HTTP ${r.status}`} (${r.ms}ms)`);
  } catch (e: unknown) {
    checks["04_site_availability"] = fail(`Site check error: ${errorMessage(e)}`);
  }

  // ═══ 5. API ENDPOINT SELF-TEST ═══
  try {
    // SEC-006: Derive the probe host from NEXT_PUBLIC_SITE_URL instead of
    // hardcoding the prod domain, so preview/staging deploys probe themselves.
    const base = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
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
  } catch (e: unknown) {
    checks["05_api_endpoints"] = fail(`API self-test error: ${errorMessage(e)}`);
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
      // Anon should NOT be able to read posts
      const { data: anonPosts, error: postsErr } = await anonClient.from("posts").select("id").limit(1);
      // Anon should NOT be able to read audit logs
      const { data: anonAudit, error: auditErr } = await anonClient.from("audit_log_v2").select("id").limit(1);

      const issues: string[] = [];
      if (!anonErr && anonMembers && anonMembers.length > 0) issues.push("CRITICAL: Anon can read team_members emails");
      if (!postsErr && anonPosts && anonPosts.length > 0) issues.push("CRITICAL: Anon can read posts data");
      if (!auditErr && anonAudit && anonAudit.length > 0) issues.push("Anon can read audit logs (may be intentional)");

      checks["06_rls_security"] = issues.some((i) => i.startsWith("CRITICAL"))
        ? fail(issues.join("; "))
        : issues.length > 0 ? warn(issues.join("; ")) : pass("RLS policies blocking anonymous access correctly");
    }
  } catch (e: unknown) {
    checks["06_rls_security"] = fail(`RLS check error: ${errorMessage(e)}`);
  }

  // ═══ 7. AUTH CONSISTENCY ═══
  let authUsers: AuthUser[] = [];
  let allMembers: TeamMemberRow[] = [];
  try {
    const { data: authData, error: authError } = await admin.auth.admin.listUsers({ perPage: 1000 });
    if (authError) throw authError;
    authUsers = (authData?.users || []) as AuthUser[];

    const { data: members } = await admin.from("team_members").select(TEAM_MEMBER_SELECT);
    allMembers = (members || []) as TeamMemberRow[];
    const memberEmails = new Set(allMembers.map((m) => m.email?.toLowerCase()));
    const authEmails = new Set(authUsers.map((u) => u.email?.toLowerCase()).filter(Boolean));

    const orphanedAuth = authUsers.filter((u) => u.email && !memberEmails.has(u.email.toLowerCase())).map((u) => u.email);
    const orphanedMembers = allMembers.filter((m) => m.email && !authEmails.has(m.email.toLowerCase()) && m.status === "active").map((m) => m.email);
    const pendingWithAuth = allMembers.filter((m) => m.status === "pending" && m.email && authEmails.has(m.email.toLowerCase())).map((m) => m.email);

    // Check for users who haven't confirmed email
    const unconfirmed = authUsers.filter((u) => !u.email_confirmed_at).map((u) => u.email);

    // Check last sign-in — users with auth but never logged in
    const neverLoggedIn = authUsers.filter((u) => !u.last_sign_in_at && u.email && memberEmails.has(u.email.toLowerCase())).map((u) => u.email);

    // SEC-003: Report counts only — raw email lists are PII and must not
    // land in the response body or in joined message strings.
    const issues: string[] = [];
    if (orphanedAuth.length > 0) issues.push(`${orphanedAuth.length} auth user(s) without team record`);
    if (orphanedMembers.length > 0) issues.push(`${orphanedMembers.length} active member(s) without auth`);
    if (pendingWithAuth.length > 0) issues.push(`${pendingWithAuth.length} pending with auth session`);
    if (unconfirmed.length > 0) issues.push(`${unconfirmed.length} unconfirmed email(s)`);
    if (neverLoggedIn.length > 0) issues.push(`${neverLoggedIn.length} never logged in`);

    checks["07_auth_consistency"] = issues.length > 0
      ? warn(issues.join("; "), { authUsers: authUsers.length, teamMembers: allMembers.length, orphanedAuthCount: orphanedAuth.length, orphanedMembersCount: orphanedMembers.length, pendingWithAuthCount: pendingWithAuth.length, unconfirmedCount: unconfirmed.length, neverLoggedInCount: neverLoggedIn.length })
      : pass(`${authUsers.length} auth users, ${allMembers.length} team members — all synced`);
  } catch (e: unknown) {
    checks["07_auth_consistency"] = fail(`Auth check error: ${errorMessage(e)}`);
  }

  // ═══ 8. SECRETS SCAN ═══
  try {
    const posts = allPosts;
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
      if (p.id && secretPatterns.some((rx) => rx.test(text))) exposedPosts.push(p.id);
    });
    checks["08_secrets_scan"] = exposedPosts.length > 0
      ? fail(`${exposedPosts.length} post(s) may contain exposed secrets/tokens`, { postIds: exposedPosts })
      : pass(`${(posts || []).length} posts scanned — no secrets found`);
  } catch (e: unknown) {
    checks["08_secrets_scan"] = fail(`Secrets scan error: ${errorMessage(e)}`);
  }

  // ╔══════════════════════════════════════════════════════════════╗
  // ║  DATA INTEGRITY                                              ║
  // ╚══════════════════════════════════════════════════════════════╝

  // ═══ 9. TABLE STATS ═══
  const tableCounts: Record<string, number> = {};
  try {
    const tables = ["posts", "team_members", "audit_log_v2", "media_assets", "post_comments", "signup_requests"];
    for (const t of tables) {
      const { count, error } = await admin.from(t).select("id", { count: "exact", head: true });
      tableCounts[t] = error ? -1 : (count || 0);
    }
    const failing = Object.entries(tableCounts).filter(([, c]) => c === -1).map(([t]) => t);
    checks["09_table_stats"] = failing.length > 0
      ? warn(`Unreachable: ${failing.join(", ")}`, tableCounts)
      : pass(`All ${tables.length} tables accessible`, tableCounts);
  } catch (e: unknown) {
    checks["09_table_stats"] = fail(`Table scan error: ${errorMessage(e)}`);
  }

  // ═══ 10. CROSS-TABLE INTEGRITY ═══
  try {
    const posts = allPosts;
    const memberNames = new Set(allMembers.map((m) => m.name));

    // Posts created by people not in team
    const unknownCreators = (posts || []).filter((p) => p.created_by && !memberNames.has(p.created_by));
    const uniqueUnknown = [...new Set(unknownCreators.map((p) => p.created_by))];

    // Media assets referencing non-existent posts
    const media = allMedia;
    const postIds = new Set((posts || []).map((p) => p.id));
    const orphanedMedia = (media || []).filter((m) => (m.used_in || []).some((postId) => postId && !postIds.has(postId)));

    // Audit logs referencing non-existent posts.
    // SEC-007: audit_log_v2 uses entity_id (scoped to entity_type 'post').
    // IRON-LAW: migration 0015 intentionally writes `post_hard_deleted`
    // BEFORE a post row is removed. Once that delete audit exists, older audit
    // rows for the same post are expected historical evidence, not orphaned
    // corruption.
    const deletedPostAuditIds = new Set(
      allAuditLogs
        .filter((a) => a.entity_type === "post" && a.entity_id && a.action === "post_hard_deleted")
        .map((a) => a.entity_id),
    );
    const auditSample = allAuditLogs.slice(0, 200);
    const orphanedAudits = (auditSample || []).filter(
      (a) => a.entity_type === "post" && a.entity_id && !postIds.has(a.entity_id) && !deletedPostAuditIds.has(a.entity_id),
    );
    const expectedDeletedPostAudits = (auditSample || []).filter(
      (a) => a.entity_type === "post" && a.entity_id && !postIds.has(a.entity_id) && deletedPostAuditIds.has(a.entity_id),
    );

    const issues: string[] = [];
    if (uniqueUnknown.length > 0) issues.push(`${uniqueUnknown.length} unknown creator(s): ${uniqueUnknown.join(", ")}`);
    if (orphanedMedia.length > 0) issues.push(`${orphanedMedia.length} media asset(s) referencing deleted posts`);
    if (orphanedAudits.length > 0) issues.push(`${orphanedAudits.length} audit entries referencing deleted posts (sampled 200)`);

    checks["10_cross_table_integrity"] = issues.length > 0
      ? warn(issues.join("; "), { unknownCreators: uniqueUnknown, orphanedMedia: orphanedMedia.length, orphanedAudits: orphanedAudits.length, expectedDeletedPostAudits: expectedDeletedPostAudits.length })
      : pass("All cross-table references valid", { expectedDeletedPostAudits: expectedDeletedPostAudits.length });
  } catch (e: unknown) {
    checks["10_cross_table_integrity"] = fail(`Integrity check error: ${errorMessage(e)}`);
  }

  // ═══ 11. TIMESTAMP SANITY ═══
  try {
    const issues: string[] = [];
    // Posts with created_at in the future
    const futurePosts = allPosts.filter(p => p.created_at && p.created_at > now.toISOString());
    if (futurePosts.length > 0) issues.push(`${futurePosts.length} post(s) with future created_at`);

    // Team members with future joined_at
    const { data: futureMembers } = await admin.from("team_members").select("id, email").gt("joined_at", now.toISOString());
    if ((futureMembers || []).length > 0) issues.push(`${futureMembers!.length} member(s) with future joined_at`);

    // Posts with invalid scheduled dates (format check)
    const postsWithDates = allPosts.filter(p => p.scheduled_date != null);
    const badDates = postsWithDates.filter((p) => p.scheduled_date && !/^\d{4}-\d{2}-\d{2}$/.test(p.scheduled_date));
    if (badDates.length > 0) issues.push(`${badDates.length} post(s) with malformed scheduled_date`);

    checks["11_timestamp_sanity"] = issues.length > 0
      ? warn(issues.join("; "), { futurePosts: futurePosts.length, futureMembers: (futureMembers || []).length, badDates: badDates.length })
      : pass("All timestamps valid");
  } catch (e: unknown) {
    checks["11_timestamp_sanity"] = fail(`Timestamp check error: ${errorMessage(e)}`);
  }

  // ═══ 12. NULL / EMPTY FIELD AUDIT ═══
  try {
    const posts = allPosts;
    const members = allMembers;

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
  } catch (e: unknown) {
    checks["12_field_audit"] = fail(`Field audit error: ${errorMessage(e)}`);
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

    // SEC-003: Count-only — no raw emails/names in the message or details.
    const issues: string[] = [];
    if (stalePending.length > 0) issues.push(`${stalePending.length} stale invite(s) >7 days`);
    if (noAvatar.length > 0) issues.push(`${noAvatar.length} active member(s) without avatar`);
    if (active.length === 0) issues.push("CRITICAL: Zero active team members");

    checks["13_team_health"] = issues.some((i) => i.startsWith("CRITICAL"))
      ? fail(issues.join("; "), { active: active.length, pending: pending.length })
      : issues.length > 0
        ? warn(issues.join("; "), { active: active.length, pending: pending.length, stalePendingCount: stalePending.length, noAvatarCount: noAvatar.length })
        : pass(`${active.length} active, ${pending.length} pending — all healthy`, { active: active.length, pending: pending.length });
  } catch (e: unknown) {
    checks["13_team_health"] = fail(`Team health error: ${errorMessage(e)}`);
  }

  // ═══ 14. USER ACTIVITY ANALYSIS ═══
  try {
    // Last login per auth user
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const inactive = authUsers.filter((u) => u.last_sign_in_at && u.last_sign_in_at < thirtyDaysAgo && u.email);
    const neverSignedIn = authUsers.filter((u) => !u.last_sign_in_at && u.email);

    // Most active users by audit log (last 7 days)
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const weekLogs = allAuditLogs.filter(a => a.created_at && a.created_at >= weekAgo);
    const activityMap: Record<string, number> = {};
    (weekLogs || []).forEach((l) => {
      // SEC-007: audit_log_v2 stores the actor name in metadata.user_name.
      const userName = l.metadata?.user_name || "unknown";
      activityMap[userName] = (activityMap[userName] || 0) + 1;
    });
    const topUsers = Object.entries(activityMap).sort(([, a], [, b]) => b - a).slice(0, 5);

    // Members with zero audit entries ever
    const allAuditNames = allAuditLogs;
    const auditNames = new Set((allAuditNames || []).map((a) => a.metadata?.user_name));
    const ghostMembers = allMembers.filter((m) => m.status === "active" && !auditNames.has(m.name)).map((m) => m.name);

    // SEC-003: Counts only — inactive/never-signed-in emails and ghost-member
    // names are PII and stay out of the response.
    const issues: string[] = [];
    if (inactive.length > 0) issues.push(`${inactive.length} user(s) inactive >30 days`);
    if (neverSignedIn.length > 0) issues.push(`${neverSignedIn.length} user(s) never logged in`);
    if (ghostMembers.length > 0) issues.push(`${ghostMembers.length} active member(s) with zero activity`);

    checks["14_user_activity"] = issues.length > 0
      ? warn(issues.join("; "), { inactiveCount: inactive.length, neverSignedInCount: neverSignedIn.length, ghostMembersCount: ghostMembers.length, topUsersThisWeek: topUsers })
      : pass(`All users active, top this week: ${topUsers.map(([n, c]) => `${n} (${c})`).join(", ")}`, { topUsersThisWeek: topUsers });
  } catch (e: unknown) {
    checks["14_user_activity"] = fail(`Activity analysis error: ${errorMessage(e)}`);
  }

  // ╔══════════════════════════════════════════════════════════════╗
  // ║  CONTENT & PIPELINE                                          ║
  // ╚══════════════════════════════════════════════════════════════╝

  // ═══ 15. PIPELINE FLOW ANALYSIS ═══
  try {
    const posts = allPosts;
    if (!posts) throw new Error("No posts");

    const stages: Record<string, number> = {};
    posts.forEach((p) => {
      const stage = p.stage || "unknown";
      stages[stage] = (stages[stage] || 0) + 1;
    });

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

    // Planned drafts/revisions are valid in this app because Create Post captures
    // schedule fields before a card reaches approval.
    const futureDraftTargets = posts.filter((p) =>
      p.scheduled_date && p.scheduled_date >= todayStr &&
      (p.stage === "ideas" || p.stage === "revision_needed")
    );

    const issues: string[] = [];
    if (overdue.length > 0) issues.push(`${overdue.length} overdue scheduled post(s)`);
    if (stuck.length > 0) issues.push(`${stuck.length} post(s) stuck in ideas/revision >14 days`);
    if (bottleneck && bottleneck[1] > 10) issues.push(`Content Engine bottleneck: ${bottleneck[1]} posts in "${bottleneck[0]}"`);

    checks["15_pipeline_flow"] = issues.length > 0
      ? warn(issues.join("; "), { stages, overdue: overdue.length, stuck: stuck.length, futureDraftTargets: futureDraftTargets.length, bottleneck: bottleneck ? { stage: bottleneck[0], count: bottleneck[1] } : null })
      : pass(`Content Engine healthy — ${posts.length} total posts`, { stages, futureDraftTargets: futureDraftTargets.length, bottleneck: bottleneck ? { stage: bottleneck[0], count: bottleneck[1] } : null });
  } catch (e: unknown) {
    checks["15_pipeline_flow"] = fail(`Content Engine analysis error: ${errorMessage(e)}`);
  }

  // ═══ 16. CONTENT QUALITY ═══
  try {
    const posts = allPosts;
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
  } catch (e: unknown) {
    checks["16_content_quality"] = fail(`Content quality error: ${errorMessage(e)}`);
  }

  // ═══ 17. THUMBNAIL SPOT-CHECK ═══
  try {
    const thumbPosts = allPosts.filter(p => p.thumbnail_url).slice(0, 10);
    let broken = 0;
    let checked = 0;
    for (const p of thumbPosts) {
      checked++;
      // Skip Drive stream URLs (they require auth, HEAD will always fail)
      const thumbnailUrl = p.thumbnail_url;
      if (!thumbnailUrl) continue;
      if (thumbnailUrl.includes('/api/drive/stream') || thumbnailUrl.includes('googleapis.com')) continue;
      const r = await timedFetch(thumbnailUrl, { method: "HEAD", timeout: 5000 });
      if (!r.ok) broken++;
    }
    checks["17_thumbnail_check"] = broken > 0
      ? warn(`${broken}/${checked} sampled thumbnails returned errors`, { checked, broken })
      : pass(`${checked} thumbnails spot-checked — all reachable or Drive-hosted`);
  } catch (e: unknown) {
    checks["17_thumbnail_check"] = fail(`Thumbnail check error: ${errorMessage(e)}`);
  }

  // ═══ 18. MEDIA HEALTH ═══
  try {
    const media = allMedia;
    const count = allMedia.length;
    const noUrl = (media || []).filter((m) => !m.url && !m.file_id);
    const noOwner = (media || []).filter((m) => !m.added_by);
    const noUsage = (media || []).filter((m) => !m.used_in || m.used_in.length === 0);

    const issues: string[] = [];
    if (noUrl.length > 0) issues.push(`${noUrl.length} asset(s) with no URL or Drive file`);
    if (noOwner.length > 0) issues.push(`${noOwner.length} asset(s) with no owner`);
    if (noUsage.length > 0) issues.push(`${noUsage.length} unlinked asset(s) (no used_in)`);

    checks["18_media_health"] = issues.length > 0
      ? warn(issues.join("; "), { total: count, noUrl: noUrl.length, noOwner: noOwner.length, noUsage: noUsage.length })
      : pass(`${count || 0} media assets — all linked and intact`);
  } catch (e: unknown) {
    checks["18_media_health"] = fail(`Media check error: ${errorMessage(e)}`);
  }

  // ╔══════════════════════════════════════════════════════════════╗
  // ║  OBSERVABILITY                                               ║
  // ╚══════════════════════════════════════════════════════════════╝

  // ═══ 19. AUDIT LOG COMPLETENESS ═══
  try {
    const totalAudit = allAuditLogs.length;
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const last24h = allAuditLogs.filter(a => a.created_at && a.created_at >= yesterday).length;
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const lastWeek = allAuditLogs.filter(a => a.created_at && a.created_at >= weekAgo).length;

    // Action type breakdown this week
    // SEC-007: audit_log_v2's verb column is `action`, not `action_type`.
    const weekActions = allAuditLogs.filter(a => a.created_at && a.created_at >= weekAgo);
    const breakdown: Record<string, number> = {};
    (weekActions || []).forEach((a) => {
      const actionType = a.action || "unknown";
      breakdown[actionType] = (breakdown[actionType] || 0) + 1;
    });

    const avgDaily = lastWeek ? Math.round((lastWeek || 0) / 7) : 0;

    checks["19_audit_completeness"] = totalAudit === 0
      ? warn("Audit log empty — no activity tracked")
      : pass(`${totalAudit} total, ${last24h} today, ~${avgDaily}/day avg`, { total: totalAudit, last24h, lastWeek, avgDaily, weeklyBreakdown: breakdown });
  } catch (e: unknown) {
    checks["19_audit_completeness"] = fail(`Audit check error: ${errorMessage(e)}`);
  }

  // ═══ 20. GROWTH METRICS ═══
  try {
    // Posts created per day this week
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const recentPosts = allPosts.filter(p => p.created_at && p.created_at >= weekAgo);
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
  } catch (e: unknown) {
    checks["20_growth_metrics"] = fail(`Growth metrics error: ${errorMessage(e)}`);
  }

  // ═══ 21. SUPABASE STORAGE ═══
  try {
    const { data: buckets, error: bucketsErr } = await admin.storage.listBuckets();
    if (bucketsErr) throw bucketsErr;
    checks["21_supabase_storage"] = pass(`Storage accessible — ${(buckets || []).length} bucket(s)`, { buckets: ((buckets || []) as StorageBucket[]).map((b) => b.name) });
  } catch (e: unknown) {
    checks["21_supabase_storage"] = fail(`Storage inaccessible: ${errorMessage(e)}`);
  }

  // ═══ 22. TABLE LATENCY ═══
  try {
    const latencyTables = ["posts", "team_members", "audit_log_v2"];
    const latencies: Record<string, number> = {};
    for (const t of latencyTables) {
      const s = Date.now();
      await admin.from(t).select("id").limit(1);
      latencies[t] = Date.now() - s;
    }
    const slowTables = Object.entries(latencies).filter(([, ms]) => ms > 2000);
    checks["22_table_latency"] = slowTables.length > 0
      ? warn(`Slow tables (>2000ms): ${slowTables.map(([t, ms]) => `${t}=${ms}ms`).join(", ")}`, latencies)
      : pass(`All table queries fast — ${Object.entries(latencies).map(([t, ms]) => `${t}=${ms}ms`).join(", ")}`, latencies);
  } catch (e: unknown) {
    checks["22_table_latency"] = fail(`Latency check error: ${errorMessage(e)}`);
  }

  // ═══ 23. SUPERADMIN CHECK ═══
  try {
    const superadmins = allMembers.filter((m) => m.role === "superadmin" && m.status === "active");
    checks["23_superadmin_check"] = superadmins.length === 0
      ? fail("No active superadmin found — system has no top-level admin", { count: 0 })
      : pass(`${superadmins.length} active superadmin(s)`, { superadmins: superadmins.map((m) => m.email) });
  } catch (e: unknown) {
    checks["23_superadmin_check"] = fail(`Superadmin check error: ${errorMessage(e)}`);
  }

  // ═══ 24. PASSWORD AGE ═══
  try {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const memberEmails = new Set(allMembers.filter((m) => m.status === "active").map((m) => m.email?.toLowerCase()));
    const staleAccounts = authUsers.filter((u) => {
      if (!u.email || !memberEmails.has(u.email.toLowerCase())) return false;
      const lastUpdate = u.updated_at || u.created_at;
      return lastUpdate && lastUpdate < ninetyDaysAgo;
    });
    // SEC-003: Count only — stale-account emails are PII.
    checks["24_password_age"] = staleAccounts.length > 0
      ? warn(`${staleAccounts.length} active user(s) haven't updated account in 90+ days`, { staleCount: staleAccounts.length })
      : pass("All active users have recent account updates");
  } catch (e: unknown) {
    checks["24_password_age"] = fail(`Password age check error: ${errorMessage(e)}`);
  }

  // ═══ 25. SESSION ANALYSIS ═══
  try {
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const monthStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const signedInToday = authUsers.filter((u) => u.last_sign_in_at && u.last_sign_in_at >= todayStart).length;
    const signedInWeek = authUsers.filter((u) => u.last_sign_in_at && u.last_sign_in_at >= weekStart).length;
    const signedInMonth = authUsers.filter((u) => u.last_sign_in_at && u.last_sign_in_at >= monthStart).length;

    checks["25_session_analysis"] = pass(
      `Sign-ins: ${signedInToday} today, ${signedInWeek} this week, ${signedInMonth} this month`,
      { today: signedInToday, thisWeek: signedInWeek, thisMonth: signedInMonth, totalAuthUsers: authUsers.length }
    );
  } catch (e: unknown) {
    checks["25_session_analysis"] = fail(`Session analysis error: ${errorMessage(e)}`);
  }

  // ═══ 26. DUPLICATE POSTS ═══
  try {
    const allPostTitles = allPosts;
    const titleMap: Record<string, string[]> = {};
    (allPostTitles || []).forEach((p) => {
      const t = (p.title || "").trim().toLowerCase();
      if (t) {
        if (!titleMap[t]) titleMap[t] = [];
        if (p.id) titleMap[t].push(p.id);
      }
    });
    const dupes = Object.entries(titleMap).filter(([, ids]) => ids.length > 1);
    checks["26_duplicate_posts"] = dupes.length > 0
      ? warn(`${dupes.length} duplicate title(s) found`, { duplicates: dupes.map(([title, ids]) => ({ title, count: ids.length })) })
      : pass(`No duplicate post titles found across ${(allPostTitles || []).length} posts`);
  } catch (e: unknown) {
    checks["26_duplicate_posts"] = fail(`Duplicate check error: ${errorMessage(e)}`);
  }

  // ═══ 27. STAGE VALIDITY ═══
  try {
    const validStages = ["ideas", "awaiting_approval", "revision_needed", "approved_scheduled", "posted"];
    const allPostStages = allPosts;
    const invalidStage = (allPostStages || []).filter((p) => !p.stage || !validStages.includes(p.stage));
    checks["27_stage_validity"] = invalidStage.length > 0
      ? fail(`${invalidStage.length} post(s) with invalid stage`, { invalid: invalidStage.map((p) => ({ id: p.id, stage: p.stage })), validStages })
      : pass(`All ${(allPostStages || []).length} posts have valid stages`, { validStages });
  } catch (e: unknown) {
    checks["27_stage_validity"] = fail(`Stage validity error: ${errorMessage(e)}`);
  }

  // ═══ 28. PLATFORM VALIDITY ═══
  try {
    const validPlatforms = ["instagram", "facebook", "tiktok", "youtube", "linkedin"];
    const allPostPlats = allPosts;
    const unknownPlatforms: { id: string; unknown: string[] }[] = [];
    (allPostPlats || []).forEach((p) => {
      const bad = (p.platforms || []).filter((pl: string) => !validPlatforms.includes(pl));
      if (bad.length > 0) unknownPlatforms.push({ id: p.id || "unknown", unknown: bad });
    });
    checks["28_platform_validity"] = unknownPlatforms.length > 0
      ? warn(`${unknownPlatforms.length} post(s) with unknown platforms`, { posts: unknownPlatforms, validPlatforms })
      : pass(`All platforms valid across ${(allPostPlats || []).length} posts`, { validPlatforms });
  } catch (e: unknown) {
    checks["28_platform_validity"] = fail(`Platform validity error: ${errorMessage(e)}`);
  }

  // ═══ 29. ORPHANED COMMENTS ═══
  try {
    const comments = allComments;
    const validPostIds = new Set(allPosts.map((p) => p.id));
    const orphaned = (comments || []).filter((c) => c.post_id && !validPostIds.has(c.post_id));
    checks["29_orphaned_comments"] = orphaned.length > 0
      ? warn(`${orphaned.length} comment(s) referencing deleted posts`, { orphanedCount: orphaned.length, sampleIds: orphaned.slice(0, 5).map((c) => c.id) })
      : pass(`All ${(comments || []).length} comments reference valid posts`);
  } catch (e: unknown) {
    checks["29_orphaned_comments"] = fail(`Orphaned comments check error: ${errorMessage(e)}`);
  }

  // ═══ 30. DATA FRESHNESS ═══
  try {
    const sortedPosts = [...allPosts].sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const lastPostDate = sortedPosts[0]?.created_at || null;
    const lastAuditDate = allAuditLogs[0]?.created_at || null;
    const postStale = lastPostDate && lastPostDate < sevenDaysAgo;
    const auditStale = lastAuditDate && lastAuditDate < sevenDaysAgo;

    const issues: string[] = [];
    if (!lastPostDate) issues.push("No posts found");
    else if (postStale) issues.push(`Last post created ${lastPostDate.split("T")[0]} (>7 days ago)`);
    if (!lastAuditDate) issues.push("No audit logs found");
    else if (auditStale) issues.push(`Last audit entry ${lastAuditDate.split("T")[0]} (>7 days ago)`);

    checks["30_data_freshness"] = issues.length > 0
      ? warn(issues.join("; "), { lastPost: lastPostDate, lastAudit: lastAuditDate })
      : pass(`Data fresh — last post ${lastPostDate?.split("T")[0]}, last audit ${lastAuditDate?.split("T")[0]}`, { lastPost: lastPostDate, lastAudit: lastAuditDate });
  } catch (e: unknown) {
    checks["30_data_freshness"] = fail(`Freshness check error: ${errorMessage(e)}`);
  }

  // ═══ 31. ROLE DISTRIBUTION ═══
  try {
    const roleCounts: Record<string, number> = {};
    allMembers.forEach((m) => { roleCounts[m.role || "unknown"] = (roleCounts[m.role || "unknown"] || 0) + 1; });
    const emptyRoles = Object.entries(roleCounts).filter(([, c]) => c === 0);
    checks["31_role_distribution"] = emptyRoles.length > 0
      ? warn(`Role(s) with zero members: ${emptyRoles.map(([r]) => r).join(", ")}`, roleCounts)
      : pass(`Role distribution: ${Object.entries(roleCounts).map(([r, c]) => `${r}=${c}`).join(", ")}`, roleCounts);
  } catch (e: unknown) {
    checks["31_role_distribution"] = fail(`Role distribution error: ${errorMessage(e)}`);
  }

  // ═══ 32. MEMBER COMPLETENESS ═══
  try {
    const activeMembers = allMembers.filter((m) => m.status === "active");
    const requiredFields = ["name", "email", "role", "avatar_url", "phone"];
    const incomplete = activeMembers.filter((m) => requiredFields.some((f) => !m[f]));
    const completeCount = activeMembers.length - incomplete.length;
    const pct = activeMembers.length > 0 ? Math.round((completeCount / activeMembers.length) * 100) : 0;

    // SEC-003: Report the count of incomplete profiles, not member names.
    checks["32_member_completeness"] = pct < 100
      ? warn(`${pct}% complete profiles (${completeCount}/${activeMembers.length})`, {
          percentage: pct,
          incompleteCount: incomplete.length,
        })
      : pass(`100% complete profiles (${activeMembers.length}/${activeMembers.length})`, { percentage: 100 });
  } catch (e: unknown) {
    checks["32_member_completeness"] = fail(`Member completeness error: ${errorMessage(e)}`);
  }

  // ═══ 33. INVITE CONVERSION ═══
  try {
    const active = allMembers.filter((m) => m.status === "active").length;
    const pending = allMembers.filter((m) => m.status === "pending").length;
    const total = active + pending;
    const rate = total > 0 ? Math.round((active / total) * 100) : 100;
    checks["33_invite_conversion"] = rate < 50
      ? warn(`Low invite conversion: ${rate}% (${active} active / ${total} total)`, { active, pending, rate })
      : pass(`Invite conversion: ${rate}% (${active} active, ${pending} pending)`, { active, pending, rate });
  } catch (e: unknown) {
    checks["33_invite_conversion"] = fail(`Invite conversion error: ${errorMessage(e)}`);
  }

  // ═══ 34. CAPTION QUALITY ═══
  try {
    const captionPosts = allPosts.filter(p => p.stage === "approved_scheduled" || p.stage === "awaiting_approval");
    const tooShort = (captionPosts || []).filter((p) => p.caption && p.caption.trim().length < 20);
    const tooLong = (captionPosts || []).filter((p) => p.caption && p.caption.trim().length > 2000);
    const issues: string[] = [];
    if (tooShort.length > 0) issues.push(`${tooShort.length} post(s) with captions <20 chars`);
    if (tooLong.length > 0) issues.push(`${tooLong.length} post(s) with captions >2000 chars`);
    checks["34_caption_quality"] = issues.length > 0
      ? warn(issues.join("; "), { tooShort: tooShort.map((p) => p.title), tooLong: tooLong.map((p) => p.title) })
      : pass(`All ${(captionPosts || []).length} approved/scheduled post captions within range`);
  } catch (e: unknown) {
    checks["34_caption_quality"] = fail(`Caption quality error: ${errorMessage(e)}`);
  }

  // ═══ 35. SOURCE VAULT CHECK ═══
  try {
    const approvedPosts = allPosts.filter(p => p.stage === "approved_scheduled" || p.stage === "posted");
    const missingSource = (approvedPosts || []).filter((p) => !p.asset_source);
    checks["35_source_vault_check"] = missingSource.length > 0
      ? warn(`${missingSource.length} approved/posted post(s) missing asset_source (compliance risk)`, {
          count: missingSource.length,
          posts: missingSource.slice(0, 10).map((p) => p.title),
        })
      : pass(`All ${(approvedPosts || []).length} approved/posted posts have asset_source`);
  } catch (e: unknown) {
    checks["35_source_vault_check"] = fail(`Source vault check error: ${errorMessage(e)}`);
  }

  // ═══ 36. REVISION CYCLES ═══
  try {
    const notePosts = allPosts;
    const highRevision = (notePosts || []).filter((p) => {
      if (!p.notes) return false;
      const revisionMarkers = (p.notes.match(/revision|revise|redo|change|update/gi) || []).length;
      return revisionMarkers >= 3;
    });
    checks["36_revision_cycles"] = highRevision.length > 0
      ? warn(`${highRevision.length} post(s) with 3+ revision indicators in notes (quality concern)`, {
          posts: highRevision.map((p) => p.title),
        })
      : pass(`No posts with excessive revision cycles`);
  } catch (e: unknown) {
    checks["36_revision_cycles"] = fail(`Revision cycles error: ${errorMessage(e)}`);
  }

  // ═══ 37. SCHEDULED READINESS ═══
  try {
    const scheduledPosts = allPosts.filter(p => p.stage === "approved_scheduled");
    const requiredFields37 = ["title", "caption", "platforms", "thumbnail_url", "scheduled_date"];
    const incomplete = (scheduledPosts || []).filter((p) => {
      return !p.title?.trim() || !p.caption?.trim() || !p.platforms || p.platforms.length === 0 || !p.thumbnail_url || !p.scheduled_date;
    });
    checks["37_scheduled_readiness"] = incomplete.length > 0
      ? warn(`${incomplete.length} scheduled post(s) missing required fields`, {
          incomplete: incomplete.map((p) => ({
            title: p.title,
            missing: requiredFields37.filter((f) => {
              if (f === "platforms") return !p.platforms || p.platforms.length === 0;
              return !p[f] || (typeof p[f] === "string" && !p[f].trim());
            }),
          })),
        })
      : pass(`All ${(scheduledPosts || []).length} scheduled posts are ready to publish`);
  } catch (e: unknown) {
    checks["37_scheduled_readiness"] = fail(`Scheduled readiness error: ${errorMessage(e)}`);
  }

  // ═══ 38. PLATFORM DISTRIBUTION ═══
  try {
    const platPosts = allPosts;
    const platUsage: Record<string, number> = {};
    let totalUsage = 0;
    (platPosts || []).forEach((p) => {
      (p.platforms || []).forEach((pl: string) => {
        platUsage[pl] = (platUsage[pl] || 0) + 1;
        totalUsage++;
      });
    });
    const underused = Object.entries(platUsage).filter(([, c]) => totalUsage > 0 && (c / totalUsage) * 100 < 10);
    checks["38_platform_distribution"] = underused.length > 0
      ? warn(`Underutilized platforms (<10%): ${underused.map(([p, c]) => `${p} (${Math.round((c / totalUsage) * 100)}%)`).join(", ")}`, {
          distribution: Object.fromEntries(Object.entries(platUsage).map(([p, c]) => [p, `${c} (${Math.round((c / totalUsage) * 100)}%)`])),
          totalUsage,
        })
      : pass(`Platform usage balanced across ${Object.keys(platUsage).length} platforms`, {
          distribution: Object.fromEntries(Object.entries(platUsage).map(([p, c]) => [p, `${c} (${Math.round((c / totalUsage) * 100)}%)`])),
          totalUsage,
        });
  } catch (e: unknown) {
    checks["38_platform_distribution"] = fail(`Platform distribution error: ${errorMessage(e)}`);
  }

  // ═══ 39. AUDIT COVERAGE ═══
  try {
    // SEC-007: audit_log_v2 keeps the actor name in metadata.user_name.
    const allAuditEntries = allAuditLogs;
    const auditedNames = new Set((allAuditEntries || []).map((a) => a.metadata?.user_name));
    const activeMembersForAudit = allMembers.filter((m) => m.status === "active");
    const uncovered = activeMembersForAudit.filter((m) => !auditedNames.has(m.name));
    checks["39_audit_coverage"] = uncovered.length > 0
      ? warn(`${uncovered.length} active member(s) with zero audit log entries`, { members: uncovered.map((m) => m.name) })
      : pass(`All ${activeMembersForAudit.length} active members have audit trail`);
  } catch (e: unknown) {
    checks["39_audit_coverage"] = fail(`Audit coverage error: ${errorMessage(e)}`);
  }

  // ═══ 40. HEALTH SCORE ═══
  try {
    const categoryChecks: Record<string, string[]> = {
      infrastructure: ["01_environment", "02_supabase_connection", "03_google_drive", "04_site_availability", "05_api_endpoints", "21_supabase_storage", "22_table_latency"],
      security: ["06_rls_security", "07_auth_consistency", "08_secrets_scan", "23_superadmin_check", "24_password_age", "25_session_analysis"],
      data_integrity: ["09_table_stats", "10_cross_table_integrity", "11_timestamp_sanity", "12_field_audit", "26_duplicate_posts", "27_stage_validity", "28_platform_validity", "29_orphaned_comments", "30_data_freshness"],
      team: ["13_team_health", "14_user_activity", "31_role_distribution", "32_member_completeness", "33_invite_conversion"],
      content: ["15_pipeline_flow", "16_content_quality", "17_thumbnail_check", "18_media_health", "34_caption_quality", "35_source_vault_check", "36_revision_cycles", "37_scheduled_readiness", "38_platform_distribution"],
      observability: ["19_audit_completeness", "20_growth_metrics", "39_audit_coverage"],
    };
    const weights: Record<string, number> = { infrastructure: 0.25, security: 0.20, data_integrity: 0.20, team: 0.10, content: 0.15, observability: 0.10 };

    const categoryScores: Record<string, { score: number; pass: number; warn: number; fail: number }> = {};
    let compositeScore = 0;
    for (const [cat, checkKeys] of Object.entries(categoryChecks)) {
      let catPass = 0, catWarn = 0, catFail = 0;
      for (const key of checkKeys) {
        const c = checks[key];
        if (!c) continue;
        if (c.status === "pass") catPass++;
        else if (c.status === "warn") catWarn++;
        else catFail++;
      }
      const total = catPass + catWarn + catFail;
      const score = total > 0 ? Math.round(((catPass * 1 + catWarn * 0.5) / total) * 100) : 0;
      categoryScores[cat] = { score, pass: catPass, warn: catWarn, fail: catFail };
      compositeScore += score * (weights[cat] || 0);
    }
    const finalScore = Math.round(compositeScore);

    checks["40_health_score"] = finalScore >= 80
      ? pass(`Health score: ${finalScore}/100`, { score: finalScore, categories: categoryScores })
      : finalScore >= 50
        ? warn(`Health score: ${finalScore}/100 — needs improvement`, { score: finalScore, categories: categoryScores })
        : fail(`Health score: ${finalScore}/100 — critical`, { score: finalScore, categories: categoryScores });
  } catch (e: unknown) {
    checks["40_health_score"] = fail(`Health score error: ${errorMessage(e)}`);
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
