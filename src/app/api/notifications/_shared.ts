import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireBearerTeamRole } from "@/lib/auth/require";
import { isValidUuid } from "@/lib/utils";

export const ACTIVE_NOTIFICATION_ROLES = [
  "superadmin",
  "admin",
  "owner",
  "approver",
  "creative_director",
  "social_media_specialist",
  "video_editor",
  "graphic_designer",
  "editor",
  "viewer",
] as const;

export const CONTENT_NOTIFICATION_ROLES = ACTIVE_NOTIFICATION_ROLES.filter((role) => role !== "viewer");

export const APPROVAL_NOTIFICATION_ROLES = [
  "superadmin",
  "admin",
  "owner",
  "approver",
  "creative_director",
] as const;

export type NotificationContext = {
  user: { id: string; email?: string | null };
  email: string;
  role: string;
  workspaceId: string;
};

export async function requireNotificationContext(
  request: NextRequest,
  roles: readonly string[] = ACTIVE_NOTIFICATION_ROLES,
): Promise<NotificationContext | NextResponse> {
  const ctx = await requireBearerTeamRole(request, roles);
  if (ctx instanceof NextResponse) return ctx;
  return ctx as NotificationContext;
}

export async function loadWorkspacePost<T extends object>(
  admin: SupabaseClient,
  postId: unknown,
  workspaceId: string,
  select: string,
): Promise<T | NextResponse> {
  const id = typeof postId === "string" ? postId.trim() : "";
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: "Invalid post id" }, { status: 400 });
  }

  const { data, error } = await admin
    .from("posts")
    .select(select)
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (error) {
    console.error("[notifications] post lookup failed:", error.message);
    return NextResponse.json({ error: "Could not verify post" }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Post not found" }, { status: 404 });
  }
  return data as unknown as T;
}

export async function loadCallerProfile(admin: SupabaseClient, email: string, workspaceId: string): Promise<{ name: string; email: string }> {
  const callerEmail = email.toLowerCase();
  const { data } = await admin
    .from("team_members")
    .select("name, email")
    .eq("workspace_id", workspaceId)
    .eq("email", callerEmail)
    .eq("status", "active")
    .maybeSingle();

  return {
    name: (data?.name as string) || callerEmail || "Team member",
    email: (data?.email as string) || callerEmail,
  };
}

export async function loadMemberByCreatorKey(
  admin: SupabaseClient,
  creatorKey: unknown,
  workspaceId: string,
): Promise<{ name?: string | null; email?: string | null } | null> {
  const key = String(creatorKey || "").trim();
  if (!key) return null;
  const column = key.includes("@") ? "email" : "name";
  const value = key.includes("@") ? key.toLowerCase() : key;
  const { data } = await admin
    .from("team_members")
    .select("name, email")
    .eq("workspace_id", workspaceId)
    .eq(column, value)
    .eq("status", "active")
    .maybeSingle();
  return data as { name?: string | null; email?: string | null } | null;
}
