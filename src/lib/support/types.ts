// Shared types for the Support Center feature.
//
// Two layers:
//  - Row types (snake_case) mirror the support_threads / support_messages
//    tables exactly. They are what Supabase REST and Realtime payloads return.
//  - Domain types (camelCase) are what the rest of the app consumes.
//  - rowToThread / rowToMessage convert between them (the dbToCard pattern
//    used in pipeline-context.tsx).

export type SupportThreadKind = "ticket" | "chat";
export type SupportThreadStatus = "open" | "in_progress" | "resolved" | "closed";
export type SupportSenderType = "user" | "admin" | "system";

export interface SupportAttachment {
  storageKey: string;
  signedUrl: string;
  mime: string;
  name: string;
  size: number;
  kind: "image" | "video";
}

// ─── Domain types (camelCase) ───

export interface SupportThread {
  id: string;
  workspaceId: string;
  createdBy: string | null;
  createdByEmail: string;
  createdByName: string;
  kind: SupportThreadKind;
  subject: string | null;
  category: string | null;
  status: SupportThreadStatus;
  lastMessageAt: string;
  lastSenderType: SupportSenderType | null;
  unreadForUser: boolean;
  unreadForAdmin: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SupportMessage {
  id: string;
  threadId: string;
  workspaceId: string;
  senderType: SupportSenderType;
  senderName: string;
  body: string | null;
  attachments: SupportAttachment[];
  createdAt: string;
}

export interface SupportThreadWithMessages extends SupportThread {
  messages: SupportMessage[];
}

// ─── Row types (snake_case, straight from Postgres) ───

export interface SupportThreadRow {
  id: string;
  workspace_id: string;
  created_by: string | null;
  created_by_email: string;
  created_by_name: string;
  kind: SupportThreadKind;
  subject: string | null;
  category: string | null;
  status: SupportThreadStatus;
  last_message_at: string;
  last_sender_type: SupportSenderType | null;
  unread_for_user: boolean;
  unread_for_admin: boolean;
  last_user_notified_at: string | null;
  last_admin_notified_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SupportMessageRow {
  id: string;
  thread_id: string;
  workspace_id: string;
  sender_type: SupportSenderType;
  sender_name: string;
  body: string | null;
  attachments: SupportAttachment[] | null;
  created_at: string;
}

// ─── Mappers ───

export function rowToThread(r: SupportThreadRow): SupportThread {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    createdBy: r.created_by,
    createdByEmail: r.created_by_email,
    createdByName: r.created_by_name,
    kind: r.kind,
    subject: r.subject,
    category: r.category,
    status: r.status,
    lastMessageAt: r.last_message_at,
    lastSenderType: r.last_sender_type,
    unreadForUser: r.unread_for_user,
    unreadForAdmin: r.unread_for_admin,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function rowToMessage(r: SupportMessageRow): SupportMessage {
  return {
    id: r.id,
    threadId: r.thread_id,
    workspaceId: r.workspace_id,
    senderType: r.sender_type,
    senderName: r.sender_name,
    body: r.body,
    attachments: Array.isArray(r.attachments) ? r.attachments : [],
    createdAt: r.created_at,
  };
}
