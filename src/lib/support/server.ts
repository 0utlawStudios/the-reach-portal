// Server-side helpers for the Support Center API routes.
//
// Service-role only. Never import this module from a client component — it
// pulls in nodemailer and the service-role key. Client code imports only
// ./types and ./format, which are pure.
//
// Attachments use a staged direct-to-storage flow: the browser asks for a
// one-shot signed upload URL (createUploadTargets), uploads the file straight
// to Supabase Storage, then submits only the storage keys. This keeps large
// files (video) off Vercel's 4.5 MB function body limit.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import {
  getTransporter,
  getFromAddress,
  getSiteUrl,
  isValidEmail,
  safeSubject,
  buildSupportTicketEmailHtml,
  buildSupportReplyEmailHtml,
} from "@/lib/email-utils";
import { withStorageControlTimeout } from "@/lib/storage-upload-timeout";
import { pingTelegram, tgEscape } from "./telegram";
import {
  attachmentKind,
  categoryLabel,
  isAllowedSupportMime,
  threadShortCode,
  SUPPORT_MAX_FILE_BYTES,
  SUPPORT_MAX_FILES,
} from "./format";
import type { SupportAttachment, SupportThreadRow } from "./types";

const BASELINE_WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const BUCKET = "support-attachments";
const ADMIN_PING_DEBOUNCE_MS = 5 * 60 * 1000;
const USER_EMAIL_DEBOUNCE_MS = 10 * 60 * 1000;
const WORKSPACE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Thrown for caller-fixable input problems. Routes map this to HTTP 400. */
export class SupportValidationError extends Error {}

// ─── clients & identity ───

export function getSupportAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase admin credentials not configured");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export function supportThreadUrl(threadId: string): string {
  return `${getSiteUrl()}/?support=${threadId}`;
}

/** The active workspace for a user; baseline workspace if none is found. */
export function workspaceIdFromHeaders(headers: Headers): string | null {
  const value = headers.get("x-workspace-id") || headers.get("x-reach-workspace-id");
  if (!value) return null;
  const workspaceId = value.trim();
  return WORKSPACE_ID_RE.test(workspaceId) ? workspaceId : null;
}

export async function resolveWorkspaceId(admin: SupabaseClient, userId: string, requestedWorkspaceId?: string | null): Promise<string | null> {
  const query = admin
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", userId)
    .eq("status", "active");
  if (requestedWorkspaceId) {
    if (!WORKSPACE_ID_RE.test(requestedWorkspaceId)) return null;
    const { data } = await query.eq("workspace_id", requestedWorkspaceId).maybeSingle();
    return (data?.workspace_id as string | undefined) || null;
  }
  const { data } = await query.limit(2);
  if (!data || data.length === 0) return BASELINE_WORKSPACE_ID;
  if (data.length > 1) return null;
  return (data[0]?.workspace_id as string | undefined) || BASELINE_WORKSPACE_ID;
}

/**
 * Strict support access for user-facing support routes.
 * A valid Auth session is not enough: the caller must be an active workspace
 * member and have an active team profile whose email matches Auth.
 */
export async function resolveActiveSupportWorkspace(
  admin: SupabaseClient,
  userId: string,
  email: string,
  requestedWorkspaceId?: string | null,
): Promise<string | null> {
  const lower = (email || "").toLowerCase();
  if (!userId || !lower) return null;

  const workspaceQuery = admin
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", userId)
    .eq("status", "active");
  let workspaceId: string | undefined;
  if (requestedWorkspaceId) {
    if (!WORKSPACE_ID_RE.test(requestedWorkspaceId)) return null;
    const { data: workspaceMember } = await workspaceQuery.eq("workspace_id", requestedWorkspaceId).maybeSingle();
    workspaceId = workspaceMember?.workspace_id as string | undefined;
  } else {
    const { data: memberships } = await workspaceQuery.limit(2);
    if (!memberships || memberships.length === 0 || memberships.length > 1) return null;
    workspaceId = memberships[0]?.workspace_id as string | undefined;
  }
  if (!workspaceId) return null;

  const { data: teamMember } = await admin
    .from("team_members")
    .select("status")
    .eq("workspace_id", workspaceId)
    .eq("email", lower)
    .maybeSingle();
  if ((teamMember as { status?: string } | null)?.status !== "active") return null;

  return workspaceId;
}

/** The caller's active team role (lowercased), or null. Used to detect the superadmin. */
export async function getTeamRole(admin: SupabaseClient, email: string, userId?: string, workspaceIdHint?: string | null): Promise<string | null> {
  const lower = (email || "").toLowerCase();
  if (!lower) return null;
  let workspaceId: string | null = workspaceIdHint || null;
  if (userId) {
    const workspaceQuery = admin
      .from("workspace_members")
      .select("workspace_id")
      .eq("user_id", userId)
      .eq("status", "active");
    if (workspaceId) {
      if (!WORKSPACE_ID_RE.test(workspaceId)) return null;
      const { data: workspaceMember } = await workspaceQuery.eq("workspace_id", workspaceId).maybeSingle();
      if (!workspaceMember) return null;
      workspaceId = workspaceMember.workspace_id as string;
    } else {
      const { data: memberships } = await workspaceQuery.limit(2);
      if (!memberships || memberships.length === 0 || memberships.length > 1) return null;
      workspaceId = memberships[0].workspace_id as string;
    }
  }

  const { data } = await admin
    .from("team_members")
    .select("role, status")
    .eq("workspace_id", workspaceId || BASELINE_WORKSPACE_ID)
    .eq("email", lower)
    .maybeSingle();
  const team = data as { role?: string | null; status?: string | null } | null;
  if (team?.status !== "active") return null;

  const role = team?.role || "";
  return role ? role.toLowerCase() : null;
}

/** Display name for a user, from team_members; falls back to the email local part. */
export async function resolveUserName(admin: SupabaseClient, email: string, workspaceId?: string): Promise<string> {
  const lower = (email || "").toLowerCase();
  let query = admin.from("team_members").select("name").eq("email", lower);
  if (workspaceId) query = query.eq("workspace_id", workspaceId);
  const { data } = await query.maybeSingle();
  const name = data?.name as string | undefined;
  return name || lower.split("@")[0] || "Team member";
}

// ─── live-chat threads ───

/** Find a user's single live-chat thread in a workspace, or null. */
export async function findChatThread(
  admin: SupabaseClient,
  ownerUserId: string,
  workspaceId: string,
): Promise<SupportThreadRow | null> {
  const { data } = await admin
    .from("support_threads")
    .select("*")
    .eq("created_by", ownerUserId)
    .eq("workspace_id", workspaceId)
    .eq("kind", "chat")
    .limit(1)
    .maybeSingle();
  return (data as SupportThreadRow | null) ?? null;
}

/**
 * Find a user's live-chat thread, or create an empty one. Race-safe: the
 * (workspace_id, created_by) WHERE kind='chat' unique index (migration 0028)
 * means a concurrent create loses with SQLSTATE 23505, and we re-read the
 * winner instead of failing. The thread is created neutral — no messages, both
 * unread flags false; callers set unread state when they append a message.
 */
export async function getOrCreateChatThread(args: {
  admin: SupabaseClient;
  workspaceId: string;
  ownerUserId: string;
  ownerEmail: string;
  ownerName: string;
}): Promise<SupportThreadRow> {
  const { admin, workspaceId, ownerUserId, ownerEmail, ownerName } = args;

  const existing = await findChatThread(admin, ownerUserId, workspaceId);
  if (existing) return existing;

  const { data: created, error } = await admin
    .from("support_threads")
    .insert({
      id: randomUUID(),
      workspace_id: workspaceId,
      created_by: ownerUserId,
      created_by_email: ownerEmail,
      created_by_name: ownerName,
      kind: "chat",
      subject: "Live chat",
      status: "open",
      last_sender_type: null,
      unread_for_user: false,
      unread_for_admin: false,
    })
    .select("*")
    .single();
  if (created) return created as SupportThreadRow;

  // Lost a create/create race against the unique index — re-read the winner.
  if ((error as { code?: string } | null)?.code === "23505") {
    const winner = await findChatThread(admin, ownerUserId, workspaceId);
    if (winner) return winner;
  }
  throw new Error(`Could not open the chat thread: ${error?.message || "unknown"}`);
}

// ─── attachments: staged upload, then claim ───

export interface UploadTarget {
  storageKey: string;
  token: string;
  name: string;
  mime: string;
  size: number;
}

export interface AttachmentClaim {
  storageKey: string;
  name: string;
}

function extForMime(mime: string): string {
  switch (mime) {
    case "image/png": return "png";
    case "image/jpeg": return "jpg";
    case "image/webp": return "webp";
    case "image/gif": return "gif";
    case "video/mp4": return "mp4";
    case "video/quicktime": return "mov";
    default: return "bin";
  }
}

function sanitizeFileName(name: string): string {
  const clean = (name || "file").replace(/[^\w.\- ]/g, "").trim().slice(0, 120);
  return clean || "file";
}

/**
 * Validate requested files and mint one-shot signed upload URLs. The browser
 * uploads each file straight to Supabase Storage with uploadToSignedUrl(),
 * keeping large files off Vercel's 4.5 MB function body limit. The bucket's
 * file_size_limit / allowed_mime_types (migration 0027) enforce the ceilings
 * a second time at the storage layer.
 */
export async function createUploadTargets(args: {
  admin: SupabaseClient;
  workspaceId: string;
  userId: string;
  files: ReadonlyArray<{ name: string; mime: string; size: number }>;
}): Promise<UploadTarget[]> {
  const { admin, workspaceId, userId, files } = args;
  if (files.length === 0) return [];
  if (files.length > SUPPORT_MAX_FILES) {
    throw new SupportValidationError(`Please attach at most ${SUPPORT_MAX_FILES} files.`);
  }
  // Mint every signed upload URL in parallel; Promise.all preserves order.
  return Promise.all(
    files.map(async (f) => {
      const mime = (f.mime || "").toLowerCase();
      if (!isAllowedSupportMime(mime)) {
        throw new SupportValidationError(`"${sanitizeFileName(f.name)}" is not a supported file type.`);
      }
      if (!Number.isFinite(f.size) || f.size <= 0) {
        throw new SupportValidationError(`"${sanitizeFileName(f.name)}" is empty.`);
      }
      if (f.size > SUPPORT_MAX_FILE_BYTES) {
        throw new SupportValidationError(`"${sanitizeFileName(f.name)}" is larger than 25 MB.`);
      }
      const storageKey = `${workspaceId}/${userId}/${randomUUID()}.${extForMime(mime)}`;
      const { data, error } = await withStorageControlTimeout(
        admin.storage.from(BUCKET).createSignedUploadUrl(storageKey),
        "Support attachment upload target",
      );
      if (error || !data?.token) {
        throw new Error(`Could not prepare upload: ${error?.message || "unknown"}`);
      }
      return { storageKey, token: data.token, name: sanitizeFileName(f.name), mime, size: f.size };
    }),
  );
}

/** Parse a raw request `attachments` field into safe AttachmentClaim records. */
export function parseAttachmentClaims(raw: unknown): AttachmentClaim[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, SUPPORT_MAX_FILES + 1)
    .map((a) => ({
      storageKey: String((a as { storageKey?: unknown })?.storageKey ?? ""),
      name: String((a as { name?: unknown })?.name ?? "file"),
    }))
    .filter((a) => a.storageKey.length > 0);
}

/**
 * Turn client-claimed storage keys into verified attachment records. Each key
 * MUST sit under the caller's own {workspaceId}/{userId}/ prefix, so one user
 * cannot attach another user's file. The object must actually exist — its
 * real size and mime are read back from storage, never trusted from the
 * client. Returns storage-key metadata ready to persist; read access is always
 * served later through /api/support/attachment, never stored signed URLs.
 */
export async function buildAttachmentsFromClaims(args: {
  admin: SupabaseClient;
  workspaceId: string;
  userId: string;
  claims: ReadonlyArray<AttachmentClaim>;
}): Promise<SupportAttachment[]> {
  const { admin, workspaceId, userId, claims } = args;
  if (claims.length === 0) return [];
  if (claims.length > SUPPORT_MAX_FILES) {
    throw new SupportValidationError(`Please attach at most ${SUPPORT_MAX_FILES} files.`);
  }
  const prefix = `${workspaceId}/${userId}/`;
  // Verify + re-sign every claimed attachment in parallel; order is preserved.
  return Promise.all(
    claims.map(async (claim) => {
      const key = String(claim.storageKey || "");
      if (!key.startsWith(prefix) || key.includes("..")) {
        throw new SupportValidationError("That attachment could not be verified.");
      }
      const slash = key.lastIndexOf("/");
      const folder = key.slice(0, slash);
      const fileName = key.slice(slash + 1);
      const { data: listed, error: listErr } = await withStorageControlTimeout(
        admin.storage
          .from(BUCKET)
          .list(folder, { limit: 100, search: fileName }),
        "Support attachment verification",
      );
      if (listErr) throw new Error(`Attachment check failed: ${listErr.message}`);
      const obj = (listed || []).find((o) => o.name === fileName);
      if (!obj) {
        throw new SupportValidationError("An attachment did not finish uploading. Please try again.");
      }
      const size = Number(obj.metadata?.size ?? 0);
      const mime = String(obj.metadata?.mimetype || "application/octet-stream").toLowerCase();
      if (!isAllowedSupportMime(mime)) {
        throw new SupportValidationError("That attachment type is not supported.");
      }
      if (size > SUPPORT_MAX_FILE_BYTES) {
        throw new SupportValidationError("That attachment is larger than 25 MB.");
      }
      return {
        storageKey: key,
        signedUrl: "",
        mime,
        name: sanitizeFileName(claim.name || fileName),
        size,
        kind: attachmentKind(mime),
      };
    }),
  );
}

/**
 * Validate stored attachments and strip any legacy signed URLs. The client
 * renders through /api/support/attachment using storageKey, so durable support
 * rows and emails never carry bearer-style storage URLs.
 */
export async function resignAttachments(
  _admin: SupabaseClient,
  attachments: SupportAttachment[] | null | undefined,
  workspaceId?: string,
): Promise<SupportAttachment[]> {
  if (!attachments || attachments.length === 0) return [];
  const workspacePrefix = workspaceId ? `${workspaceId}/` : null;
  const refreshed = await Promise.all(
    attachments
      .filter((a) => Boolean(a?.storageKey))
      .map(async (a) => {
        if (
          workspacePrefix &&
          (
            !a.storageKey.startsWith(workspacePrefix) ||
            a.storageKey.includes("..") ||
            a.storageKey.split("/").length < 3
          )
        ) {
          console.error("[support] skipped attachment with invalid workspace prefix");
          return null;
        }
        return { ...a, signedUrl: "" };
      }),
  );
  return refreshed.filter((a): a is SupportAttachment => Boolean(a));
}

// ─── audit ───

export async function recordSupportAudit(args: {
  admin: SupabaseClient;
  action: string;
  threadId: string;
  workspaceId: string;
  actorName: string;
  details?: string;
}): Promise<void> {
  try {
    await args.admin.rpc("record_audit_event", {
      p_entity_type: "support_ticket",
      p_action: args.action,
      p_entity_id: args.threadId,
      p_workspace_id: args.workspaceId,
      p_metadata: { user_name: args.actorName, details: args.details || null },
    });
  } catch (err) {
    console.error("[support] audit write failed:", err instanceof Error ? err.message : err);
  }
}

// ─── notifications ───

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function debounceDue(last: string | null | undefined, windowMs: number): boolean {
  if (!last) return true;
  const t = new Date(last).getTime();
  if (Number.isNaN(t)) return true;
  return Date.now() - t >= windowMs;
}

async function touchAdminNotified(admin: SupabaseClient, threadId: string): Promise<void> {
  await admin
    .from("support_threads")
    .update({ last_admin_notified_at: new Date().toISOString() })
    .eq("id", threadId);
}

async function touchUserNotified(admin: SupabaseClient, threadId: string): Promise<void> {
  await admin
    .from("support_threads")
    .update({ last_user_notified_at: new Date().toISOString() })
    .eq("id", threadId);
}

function smtpReady(): boolean {
  return Boolean(process.env.SMTP_USER && process.env.SMTP_PASS);
}

/** New ticket: full email to the admin + a Telegram ping. */
export async function notifyAdminOfTicket(args: {
  admin: SupabaseClient;
  thread: SupportThreadRow;
  body: string;
  attachments: SupportAttachment[];
}): Promise<void> {
  const { admin, thread, body, attachments } = args;
  const shortCode = threadShortCode(thread.id);
  const category = categoryLabel(thread.category);
  const url = supportThreadUrl(thread.id);

  if (smtpReady()) {
    try {
      const to = process.env.SUPPORT_NOTIFY_EMAIL || process.env.SMTP_USER!;
      const html = buildSupportTicketEmailHtml({
        shortCode,
        userName: thread.created_by_name,
        userEmail: thread.created_by_email,
        category,
        body,
        attachments: attachments.map((a) => ({ name: a.name, kind: a.kind })),
        threadUrl: url,
      });
      await getTransporter().sendMail({
        from: getFromAddress(),
        to,
        ...(isValidEmail(thread.created_by_email) ? { replyTo: thread.created_by_email } : {}),
        subject: safeSubject(`New Support Ticket #${shortCode} — ${category}`),
        html,
      });
    } catch (err) {
      console.error("[support] ticket email failed:", err instanceof Error ? err.message : err);
    }
  }

  await pingTelegram({
    text:
      `<b>New support ticket #${tgEscape(shortCode)}</b>\n` +
      `From: ${tgEscape(thread.created_by_name)}\n` +
      `Category: ${tgEscape(category)}\n\n` +
      tgEscape(truncate(body, 300)),
    threadUrl: url,
  });
  await touchAdminNotified(admin, thread.id);
}

/** New user message on an existing thread: a debounced Telegram ping only. */
export async function notifyAdminOfMessage(args: {
  admin: SupabaseClient;
  thread: SupportThreadRow;
  body: string | null;
}): Promise<void> {
  const { admin, thread, body } = args;
  if (!debounceDue(thread.last_admin_notified_at, ADMIN_PING_DEBOUNCE_MS)) return;
  const shortCode = threadShortCode(thread.id);
  const heading = thread.kind === "chat" ? "New chat message" : `New reply on ticket #${shortCode}`;
  await pingTelegram({
    text:
      `<b>${tgEscape(heading)}</b>\n` +
      `From: ${tgEscape(thread.created_by_name)}\n\n` +
      tgEscape(truncate(body || "(attachment)", 300)),
    threadUrl: supportThreadUrl(thread.id),
  });
  await touchAdminNotified(admin, thread.id);
}

/** Admin reply: a debounced email to the user who owns the thread. */
export async function notifyUserOfReply(args: {
  admin: SupabaseClient;
  thread: SupportThreadRow;
  body: string | null;
}): Promise<void> {
  const { admin, thread, body } = args;
  if (!debounceDue(thread.last_user_notified_at, USER_EMAIL_DEBOUNCE_MS)) return;
  if (!isValidEmail(thread.created_by_email) || !smtpReady()) return;
  try {
    const html = buildSupportReplyEmailHtml({
      userName: thread.created_by_name,
      shortCode: threadShortCode(thread.id),
      replyPreview: truncate(body || "Our team sent you an attachment.", 400),
      threadUrl: supportThreadUrl(thread.id),
    });
    await getTransporter().sendMail({
      from: getFromAddress(),
      to: thread.created_by_email,
      subject: safeSubject(`Reply to your support request #${threadShortCode(thread.id)}`),
      html,
    });
    await touchUserNotified(admin, thread.id);
  } catch (err) {
    console.error("[support] reply email failed:", err instanceof Error ? err.message : err);
  }
}
