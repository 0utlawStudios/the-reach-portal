import { test, expect, type Browser, type Page } from "@playwright/test";
import { createClient, type Session } from "@supabase/supabase-js";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

type Stage = "ideas" | "awaiting_approval" | "revision_needed" | "approved_scheduled" | "posted";
type Role = "editor" | "creative_director";
type Persona = {
  role: Role;
  label: string;
  email: string;
  password: string;
  userId: string;
  session: Session;
  storageStatePath: string;
};

type FixtureState = {
  runId: string;
  workspaceId: string;
  hostileWorkspaceId: string;
  personas: Record<Role, Persona>;
  postIds: Record<"ideas" | "awaiting" | "revision" | "approved" | "posted" | "hostile", string>;
  createdUserIds: string[];
  createdEmails: string[];
  createdPostIds: string[];
  createdWorkspaceIds: string[];
};

type MatrixRow = {
  id: string;
  role: string;
  transition: string;
  domStartFired: boolean;
  domEndFired: boolean;
  dragEndOutcome?: string;
  dbStage: string | null;
  uiStage: string | null;
  network: Array<{ status: number; url: string; body: string }>;
  screenshot?: string;
};

const env = loadEnv();
const SUPABASE_URL = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
const SUPABASE_ANON_KEY = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SUPABASE_SERVICE_ROLE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "https://thereach.ten80ten.com";
const PROJECT_REF = new URL(SUPABASE_URL).hostname.split(".")[0];
const AUTH_STORAGE_KEY = `sb-${PROJECT_REF}-auth-token`;
const RUN_ID = process.env.PLAYWRIGHT_RUN_ID ?? `drag-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const EVIDENCE_DIR = path.join(process.cwd(), "perf", "drag-evidence", RUN_ID);
const AUTH_DIR = path.join(process.cwd(), "e2e", ".auth");

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let state: FixtureState;
const matrixRows: MatrixRow[] = [];
const directChecks: Record<string, unknown>[] = [];
const cleanupEvidence: Record<string, unknown> = {};

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  mkdirSync(AUTH_DIR, { recursive: true });
  state = await seedFixture();
  writeJson("seed.json", {
    runId: state.runId,
    authMethod: "Supabase password sign-in, then JWT/session injection into Playwright storageState via sb-<project-ref>-auth-token localStorage.",
    workspaceId: state.workspaceId,
    hostileWorkspaceId: state.hostileWorkspaceId,
    personas: Object.fromEntries(
      Object.entries(state.personas).map(([role, persona]) => [
        role,
        { email: persona.email, userId: persona.userId, role: persona.role, storageStatePath: persona.storageStatePath },
      ]),
    ),
    postIds: state.postIds,
  });
});

test.afterAll(async () => {
  if (!state) return;
  await cleanupFixture(state);
  writeJson("matrix.json", { runId: RUN_ID, rows: matrixRows, directChecks, cleanup: cleanupEvidence });
});

test("production drag matrix records DOM, network, DB, and UI agreement", async ({ browser }) => {
  const editorPage = await openPipeline(browser, state.personas.editor);

  await runAllowedDrag({
    id: "editor-ideas-awaiting",
    page: editorPage.page,
    role: "editor",
    postId: state.postIds.ideas,
    from: "ideas",
    to: "awaiting_approval",
  });

  await runBlockedClientDrag({
    id: "editor-awaiting-approved-blocked",
    page: editorPage.page,
    role: "editor",
    postId: state.postIds.ideas,
    from: "awaiting_approval",
    to: "approved_scheduled",
    expectedOutcome: "blocked_approver_required",
  });

  await runBlockedClientDrag({
    id: "editor-posted-ideas-blocked",
    page: editorPage.page,
    role: "editor",
    postId: state.postIds.posted,
    from: "posted",
    to: "ideas",
    expectedOutcome: "blocked_posted_source",
  });

  await editorPage.context.close();

  const approverPage = await openPipeline(browser, state.personas.creative_director);

  await runAllowedDrag({
    id: "approver-awaiting-approved",
    page: approverPage.page,
    role: "creative_director",
    postId: state.postIds.awaiting,
    from: "awaiting_approval",
    to: "approved_scheduled",
  });

  await runRevisionReapprovalDrag(approverPage.page);

  await runAllowedDrag({
    id: "approver-approved-ideas",
    page: approverPage.page,
    role: "creative_director",
    postId: state.postIds.approved,
    from: "approved_scheduled",
    to: "ideas",
  });

  await approverPage.context.close();

  await runServerHostileChecks();
});

async function seedFixture(): Promise<FixtureState> {
  const stamp = RUN_ID.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 54);
  const workspaceId = randomUUID();
  const hostileWorkspaceId = randomUUID();
  const password = `Reach-${randomUUID()}-1a!`;
  const createdUserIds: string[] = [];
  const createdEmails: string[] = [];
  const createdPostIds: string[] = [];
  const createdWorkspaceIds = [workspaceId, hostileWorkspaceId];

  await must(admin.from("workspaces").insert([
    { id: workspaceId, name: `QA Drag ${stamp}`, slug: `qa-drag-${stamp}` },
    { id: hostileWorkspaceId, name: `QA Drag Hostile ${stamp}`, slug: `qa-drag-hostile-${stamp}` },
  ]), "insert temp workspaces");

  const personas: Partial<Record<Role, Persona>> = {};
  for (const role of ["editor", "creative_director"] as Role[]) {
    const email = `qa-${stamp}-${role}@example.com`;
    const label = role === "editor" ? "QA Drag Editor" : "QA Drag Creative Director";
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name: label, role },
      app_metadata: { role },
    });
    if (error || !data.user) throw new Error(`create auth user ${role}: ${formatError(error)}`);
    createdUserIds.push(data.user.id);
    createdEmails.push(email);

    await must(admin.from("team_members").insert({
      name: label,
      email,
      role,
      status: "active",
    }), `insert team member ${role}`);
    await must(admin.from("workspace_members").insert({
      workspace_id: workspaceId,
      user_id: data.user.id,
      role,
      status: "active",
    }), `insert workspace member ${role}`);

    const session = await signIn(email, password);
    const storageStatePath = path.join(AUTH_DIR, `${RUN_ID}-${role}.json`);
    writeFileSync(storageStatePath, JSON.stringify(buildStorageState(session), null, 2));
    personas[role] = { role, label, email, password, userId: data.user.id, session, storageStatePath };
  }

  const posts = [
    makePost(workspaceId, stamp, "ideas", "ideas"),
    makePost(workspaceId, stamp, "awaiting", "awaiting_approval"),
    makePost(workspaceId, stamp, "revision", "revision_needed"),
    makePost(workspaceId, stamp, "approved", "approved_scheduled"),
    makePost(workspaceId, stamp, "posted", "posted"),
    makePost(hostileWorkspaceId, stamp, "hostile", "ideas"),
  ];
  const { data: insertedPosts, error: postError } = await admin
    .from("posts")
    .insert(posts)
    .select("id, title, stage, workspace_id");
  if (postError || !insertedPosts) throw new Error(`insert posts: ${formatError(postError)}`);
  createdPostIds.push(...insertedPosts.map((post) => post.id));

  const postByLabel = Object.fromEntries(
    insertedPosts.map((post) => {
      const label = String(post.title).split(" ").at(-1) as keyof FixtureState["postIds"];
      return [label, post.id];
    }),
  ) as FixtureState["postIds"];

  return {
    runId: RUN_ID,
    workspaceId,
    hostileWorkspaceId,
    personas: personas as Record<Role, Persona>,
    postIds: postByLabel,
    createdUserIds,
    createdEmails,
    createdPostIds,
    createdWorkspaceIds,
  };
}

async function cleanupFixture(fixture: FixtureState) {
  const cleanupErrors: string[] = [];
  try {
    if (fixture.createdPostIds.length > 0) {
      await admin.from("posts").update({ stage: "revision_needed", posted_at: null }).in("id", fixture.createdPostIds);
      await admin.from("posts").delete().in("id", fixture.createdPostIds);
      await admin.from("audit_log_v2").delete().in("entity_id", fixture.createdPostIds);
    }
    if (fixture.createdUserIds.length > 0) {
      await admin.from("workspace_members").delete().in("user_id", fixture.createdUserIds);
    }
    if (fixture.createdEmails.length > 0) {
      await admin.from("team_members").delete().in("email", fixture.createdEmails);
    }
    if (fixture.createdWorkspaceIds.length > 0) {
      await admin.from("workspaces").delete().in("id", fixture.createdWorkspaceIds);
    }
    for (const userId of fixture.createdUserIds) {
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) cleanupErrors.push(`auth ${userId}: ${formatError(error)}`);
    }
  } catch (error) {
    cleanupErrors.push(formatError(error));
  }

  const [postsRemaining, auditRowsRemaining, workspaceMembersRemaining, teamMembersRemaining, workspacesRemaining] = await Promise.all([
    countRows(admin.from("posts").select("id", { count: "exact", head: true }).in("id", fixture.createdPostIds)),
    countRows(admin.from("audit_log_v2").select("id", { count: "exact", head: true }).in("entity_id", fixture.createdPostIds)),
    countRows(admin.from("workspace_members").select("user_id", { count: "exact", head: true }).in("user_id", fixture.createdUserIds)),
    countRows(admin.from("team_members").select("id", { count: "exact", head: true }).in("email", fixture.createdEmails)),
    countRows(admin.from("workspaces").select("id", { count: "exact", head: true }).in("id", fixture.createdWorkspaceIds)),
  ]);
  Object.assign(cleanupEvidence, {
    postsRemaining,
    auditRowsRemaining,
    workspaceMembersRemaining,
    teamMembersRemaining,
    workspacesRemaining,
    cleanupErrors,
  });
  expect(cleanupEvidence).toMatchObject({
    postsRemaining: 0,
    auditRowsRemaining: 0,
    workspaceMembersRemaining: 0,
    teamMembersRemaining: 0,
    workspacesRemaining: 0,
  });
  expect(cleanupErrors).toEqual([]);
}

async function openPipeline(browser: Browser, persona: Persona) {
  const context = await browser.newContext({
    storageState: persona.storageStatePath,
    viewport: { width: 1600, height: 1000 },
  });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.getByTestId("kanban-board")).toBeVisible({ timeout: 30_000 });
  await installDragRecorder(page);
  return { context, page };
}

async function runAllowedDrag(input: { id: string; page: Page; role: string; postId: string; from: Stage; to: Stage }) {
  await expectDbStage(input.postId, input.from);
  const network = attachPostPatchRecorder(input.page);
  await resetDragEvents(input.page);
  await dragCardToStage(input.page, input.postId, input.to);
  await expect.poll(() => readStage(input.postId), { timeout: 15_000 }).toBe(input.to);
  await input.page.waitForTimeout(300);
  const uiStage = await expectUiStage(input.page, input.postId, input.to);
  const events = await readDragEvents(input.page);
  const screenshot = await saveScreenshot(input.page, input.id);
  const endEvent = events.find((event) => event.type === "end");
  expect(events.some((event) => event.type === "start")).toBe(true);
  expect(endEvent?.detail).toMatchObject({
    activeId: input.postId,
    fromStage: input.from,
    targetStage: input.to,
    outcome: "move_requested",
  });
  matrixRows.push({
    id: input.id,
    role: input.role,
    transition: `${input.from}->${input.to}`,
    domStartFired: events.some((event) => event.type === "start"),
    domEndFired: !!endEvent,
    dragEndOutcome: stringValue(endEvent?.detail?.outcome),
    dbStage: input.to,
    uiStage,
    network: [...network],
    screenshot,
  });
}

async function runRevisionReapprovalDrag(page: Page) {
  const id = "approver-revision-awaiting";
  const postId = state.postIds.revision;
  await expectDbStage(postId, "revision_needed");
  const network = attachPostPatchRecorder(page);
  await resetDragEvents(page);
  await dragCardToStage(page, postId, "awaiting_approval");
  await expect(page.getByRole("dialog", { name: "Submit for Re-Approval" })).toBeVisible();
  await page.getByPlaceholder(/Detail what was fixed/i).fill("QA fixed revision and is resubmitting.");
  await page.getByRole("button", { name: "Submit Revision" }).click();
  await expect.poll(() => readStage(postId), { timeout: 15_000 }).toBe("awaiting_approval");
  await page.waitForTimeout(300);
  const uiStage = await expectUiStage(page, postId, "awaiting_approval");
  const events = await readDragEvents(page);
  const screenshot = await saveScreenshot(page, id);
  const endEvent = events.find((event) => event.type === "end");
  expect(events.some((event) => event.type === "start")).toBe(true);
  expect(endEvent?.detail).toMatchObject({
    activeId: postId,
    fromStage: "revision_needed",
    targetStage: "awaiting_approval",
    outcome: "move_requested",
  });
  matrixRows.push({
    id,
    role: "creative_director",
    transition: "revision_needed->awaiting_approval",
    domStartFired: events.some((event) => event.type === "start"),
    domEndFired: !!endEvent,
    dragEndOutcome: stringValue(endEvent?.detail?.outcome),
    dbStage: "awaiting_approval",
    uiStage,
    network: [...network],
    screenshot,
  });
}

async function runBlockedClientDrag(input: { id: string; page: Page; role: string; postId: string; from: Stage; to: Stage; expectedOutcome: string }) {
  await expectDbStage(input.postId, input.from);
  const network = attachPostPatchRecorder(input.page);
  await resetDragEvents(input.page);
  await dragCardToStage(input.page, input.postId, input.to);
  await input.page.waitForTimeout(750);
  await expectDbStage(input.postId, input.from);
  const uiStage = await expectUiStage(input.page, input.postId, input.from);
  const events = await readDragEvents(input.page);
  const screenshot = await saveScreenshot(input.page, input.id);
  const endEvent = events.find((event) => event.type === "end");
  expect(events.some((event) => event.type === "start")).toBe(true);
  expect(endEvent?.detail).toMatchObject({
    activeId: input.postId,
    fromStage: input.from,
    targetStage: input.to,
    outcome: input.expectedOutcome,
  });
  expect(network).toEqual([]);
  matrixRows.push({
    id: input.id,
    role: input.role,
    transition: `${input.from}->${input.to}`,
    domStartFired: events.some((event) => event.type === "start"),
    domEndFired: !!endEvent,
    dragEndOutcome: stringValue(endEvent?.detail?.outcome),
    dbStage: input.from,
    uiStage,
    network: [...network],
    screenshot,
  });
}

async function runServerHostileChecks() {
  const editorClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  await editorClient.auth.setSession({
    access_token: state.personas.editor.session.access_token,
    refresh_token: state.personas.editor.session.refresh_token,
  });

  const approvalBypass = await editorClient
    .from("posts")
    .update({ stage: "approved_scheduled" })
    .eq("id", state.postIds.ideas)
    .select("id, stage")
    .maybeSingle();
  expect(formatError(approvalBypass.error)).toContain("APPROVAL_LOCKDOWN");
  expect(await readStage(state.postIds.ideas)).toBe("awaiting_approval");

  const crossWorkspace = await editorClient
    .from("posts")
    .update({ stage: "revision_needed" })
    .eq("id", state.postIds.hostile)
    .select("id, stage")
    .maybeSingle();
  expect(crossWorkspace.error).toBeNull();
  expect(crossWorkspace.data).toBeNull();
  expect(await readStage(state.postIds.hostile)).toBe("ideas");

  const serviceRecovery = await admin
    .from("posts")
    .update({ stage: "ideas", posted_at: null })
    .eq("id", state.postIds.posted)
    .select("id, stage")
    .maybeSingle();
  expect(serviceRecovery.error).toBeNull();
  expect(serviceRecovery.data?.stage).toBe("ideas");
  expect(await readStage(state.postIds.posted)).toBe("ideas");

  directChecks.push(
    {
      id: "server-editor-approval-bypass",
      postId: state.postIds.ideas,
      expected: "APPROVAL_LOCKDOWN",
      error: formatError(approvalBypass.error),
      dbStage: await readStage(state.postIds.ideas),
    },
    {
      id: "server-cross-workspace-update",
      postId: state.postIds.hostile,
      expected: "zero-row RLS denial",
      status: crossWorkspace.status,
      data: crossWorkspace.data,
      dbStage: await readStage(state.postIds.hostile),
    },
    {
      id: "server-service-role-posted-recovery",
      postId: state.postIds.posted,
      expected: "service role can recover posted",
      status: serviceRecovery.status,
      data: serviceRecovery.data,
      dbStage: await readStage(state.postIds.posted),
    },
  );
}

async function dragCardToStage(page: Page, postId: string, targetStage: Stage) {
  const handle = page.getByTestId(`content-card-drag-handle-${postId}`);
  const target = page.getByTestId(`pipeline-dropzone-${targetStage}`);
  await handle.scrollIntoViewIfNeeded();
  await target.scrollIntoViewIfNeeded();
  await expect(handle).toBeVisible();
  await expect(target).toBeVisible();
  const handleBox = await handle.boundingBox();
  const targetBox = await target.boundingBox();
  if (!handleBox || !targetBox) throw new Error(`Missing drag geometry for ${postId}->${targetStage}`);
  const start = { x: handleBox.x + handleBox.width / 2, y: handleBox.y + handleBox.height / 2 };
  const end = { x: targetBox.x + targetBox.width / 2, y: targetBox.y + Math.min(160, Math.max(40, targetBox.height / 2)) };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 12, start.y + 12, { steps: 4 });
  await page.mouse.move(end.x, end.y, { steps: 24 });
  await page.mouse.up();
}

async function expectUiStage(page: Page, postId: string, stage: Stage): Promise<string | null> {
  const card = page.getByTestId(`content-card-${postId}`);
  await expect(card).toHaveAttribute("data-stage", stage, { timeout: 10_000 });
  await expect(page.getByTestId(`pipeline-column-${stage}`).getByTestId(`content-card-${postId}`)).toBeVisible();
  return card.getAttribute("data-stage");
}

async function installDragRecorder(page: Page) {
  await page.evaluate(() => {
    const w = window as typeof window & { __reachDragEvents?: Array<{ type: string; detail: unknown }> };
    w.__reachDragEvents = [];
    window.addEventListener("reach:drag-start", (event) => {
      w.__reachDragEvents?.push({ type: "start", detail: (event as CustomEvent).detail });
    });
    window.addEventListener("reach:drag-end", (event) => {
      w.__reachDragEvents?.push({ type: "end", detail: (event as CustomEvent).detail });
    });
  });
}

async function resetDragEvents(page: Page) {
  await page.evaluate(() => {
    (window as typeof window & { __reachDragEvents?: unknown[] }).__reachDragEvents = [];
  });
}

async function readDragEvents(page: Page): Promise<Array<{ type: string; detail: Record<string, unknown> }>> {
  return page.evaluate(() => {
    return ((window as typeof window & { __reachDragEvents?: Array<{ type: string; detail: Record<string, unknown> }> }).__reachDragEvents || []);
  });
}

function attachPostPatchRecorder(page: Page): Array<{ status: number; url: string; body: string }> {
  const records: Array<{ status: number; url: string; body: string }> = [];
  page.on("response", async (response) => {
    const request = response.request();
    if (request.method() !== "PATCH") return;
    if (!response.url().includes("/rest/v1/posts")) return;
    let body = "";
    try {
      body = (await response.text()).slice(0, 1000);
    } catch {
      body = "<unreadable>";
    }
    records.push({ status: response.status(), url: response.url(), body });
  });
  return records;
}

async function saveScreenshot(page: Page, id: string): Promise<string> {
  const relativePath = path.join(RUN_ID, `${id}.png`);
  const absolutePath = path.join(process.cwd(), "perf", "drag-evidence", relativePath);
  await page.screenshot({ path: absolutePath, fullPage: true });
  return `perf/drag-evidence/${relativePath}`;
}

async function readStage(postId: string): Promise<string | null> {
  const { data, error } = await admin.from("posts").select("stage").eq("id", postId).maybeSingle();
  if (error) throw new Error(`read stage ${postId}: ${formatError(error)}`);
  return data?.stage ?? null;
}

async function expectDbStage(postId: string, stage: Stage) {
  await expect.poll(() => readStage(postId), { timeout: 10_000 }).toBe(stage);
}

function makePost(workspaceId: string, stamp: string, label: string, stage: Stage) {
  const scheduledDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return {
    workspace_id: workspaceId,
    title: `QA Drag ${stamp} ${label}`,
    stage,
    platforms: ["instagram"],
    content_type: "image",
    thumbnail_url: "/the-reach-logo.png",
    scheduled_date: scheduledDate,
    scheduled_time: "09:00",
    scheduled_at: `${scheduledDate}T09:00:00.000Z`,
    caption: `QA caption for ${label}`,
    hook: "QA hook",
    checklist: [
      { id: "1", label: "Thumbnail/cover image approved", checked: true },
      { id: "2", label: "Caption proofread & hashtags added", checked: true },
      { id: "3", label: "Hook verified (first 3 seconds)", checked: true },
      { id: "4", label: "Call-to-action included", checked: true },
      { id: "5", label: "Brand guidelines followed", checked: true },
      { id: "6", label: "Scheduled date confirmed", checked: true },
    ],
    source_vault: {
      designLink: "https://example.com/qa-design",
      rawFiles: [
        {
          name: "qa-source.png",
          url: "/the-reach-logo.png",
          usageType: "master",
          mimeType: "image/png",
          uploadedAt: new Date().toISOString(),
        },
      ],
    },
    asset_source: "QA source",
    created_by: "QA Drag",
    posted_at: stage === "posted" ? new Date().toISOString() : null,
    posted_urls: stage === "posted" ? { instagram: "https://example.com/qa-live" } : null,
  };
}

async function signIn(email: string, password: string): Promise<Session> {
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`sign in ${email}: ${formatError(error)}`);
  return data.session;
}

function buildStorageState(session: Session) {
  return {
    cookies: [],
    origins: [
      {
        origin: BASE_URL,
        localStorage: [
          { name: AUTH_STORAGE_KEY, value: JSON.stringify(session) },
          { name: "pt_v2_nav_page", value: JSON.stringify("pipeline") },
          { name: "pt_v2_nav_sidebar", value: JSON.stringify(true) },
          { name: "pt_v2_nav_sidebar_pinned", value: JSON.stringify(false) },
        ],
      },
    ],
  };
}

async function must<T>(query: PromiseLike<{ data: T | null; error: unknown }>, label: string): Promise<T | null> {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${formatError(error)}`);
  return data;
}

async function countRows(query: PromiseLike<{ count: number | null; error: unknown }>): Promise<number | null> {
  const { count, error } = await query;
  if (error) throw new Error(`count rows: ${formatError(error)}`);
  return count;
}

function loadEnv(): Record<string, string> {
  const files = [".env.local"];
  const loaded: Record<string, string> = {};
  for (const file of files) {
    const fullPath = path.join(process.cwd(), file);
    let content = "";
    try {
      content = readFileSync(fullPath, "utf8");
    } catch {
      continue;
    }
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) continue;
      const key = match[1];
      let value = match[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      } else {
        value = value.replace(/\s+#.*$/, "").trim();
      }
      if (!(key in process.env)) process.env[key] = value;
      loaded[key] = process.env[key] || value;
    }
  }
  return loaded;
}

function requireEnv(key: string): string {
  const value = process.env[key] || env[key];
  if (!value) throw new Error(`Missing ${key}`);
  return value;
}

function writeJson(fileName: string, data: unknown) {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  writeFileSync(path.join(EVIDENCE_DIR, fileName), `${JSON.stringify(data, null, 2)}\n`);
}

function formatError(error: unknown): string {
  if (!error) return "";
  if (error instanceof Error) return error.message;
  if (typeof error === "object") {
    const record = error as Record<string, unknown>;
    return [record.message, record.details, record.hint, record.code]
      .filter((part): part is string => typeof part === "string" && part.length > 0)
      .join(" | ") || JSON.stringify(record);
  }
  return String(error);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
