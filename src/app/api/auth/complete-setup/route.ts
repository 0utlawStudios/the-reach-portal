import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";

export const maxDuration = 10;

const BASELINE_WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";

type CompleteSetupBody = {
  name?: unknown;
  phone?: unknown;
  avatarUrl?: unknown;
};

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase admin credentials not configured");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

function hashEmail(email: string | null | undefined): string {
  return createHash("sha256").update(email || "").digest("hex").slice(0, 12);
}

function cleanPhone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const phone = value.trim().replace(/[^0-9+]/g, "");
  return phone || null;
}

function cleanSupabaseAvatarUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const url = value.trim();
  if (!url) return undefined;
  if (url.length > 2048) return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return undefined;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl) return undefined;
    const expectedHost = new URL(supabaseUrl).host;
    if (parsed.host !== expectedHost) return undefined;
    const prefix = "/storage/v1/object/public/avatars/";
    if (!parsed.pathname.startsWith(prefix)) return undefined;
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function cleanOwnedProfileAvatarUrl(value: unknown, userId: string): string | undefined {
  const url = cleanSupabaseAvatarUrl(value);
  if (!url) return undefined;
  const parsed = new URL(url);
  const objectPath = decodeURIComponent(parsed.pathname.replace("/storage/v1/object/public/avatars/", ""));
  if (objectPath.includes("..")) return undefined;
  if (!objectPath.startsWith(`profiles/${userId}/`)) return undefined;
  return url;
}

function cleanName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/g, " ");
  return name.length >= 2 ? name : null;
}

export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = (await request.json().catch(() => ({}))) as CompleteSetupBody;
    const name = cleanName(body.name);
    if (!name) return NextResponse.json({ error: "Full name is required" }, { status: 400 });
    const phone = cleanPhone(body.phone);

    const admin = getAdminClient();
    const { data: authData, error: authErr } = await admin.auth.getUser(token);
    const user = authData.user;
    if (authErr || !user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const email = (user.email || "").toLowerCase();
    if (!email) return NextResponse.json({ error: "No email on user" }, { status: 403 });

    const { data: existingWorkspaceAccess } = await admin
      .from("workspace_members")
      .select("workspace_id, status")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();

    let memberQuery = admin
      .from("team_members")
      .select("id, workspace_id, role, status, avatar_url")
      .eq("email", email);
    if (existingWorkspaceAccess?.workspace_id) {
      memberQuery = memberQuery.eq("workspace_id", existingWorkspaceAccess.workspace_id);
    }
    const { data: member, error: memberReadErr } = await memberQuery
      .limit(1)
      .maybeSingle();

    if (memberReadErr) {
      console.error("[auth/complete-setup] member read failed:", memberReadErr.message);
      return NextResponse.json({ error: "Could not verify invitation" }, { status: 500 });
    }
    if (!member) return NextResponse.json({ error: "Invitation not found" }, { status: 403 });
    if (!member.role) return NextResponse.json({ error: "Invitation role is missing" }, { status: 409 });
    if (!["pending", "active"].includes(String(member.status))) {
      return NextResponse.json({ error: "Invitation is not active" }, { status: 403 });
    }
    const workspaceId = (member.workspace_id as string | null) || existingWorkspaceAccess?.workspace_id || BASELINE_WORKSPACE_ID;
    const avatarUrl = cleanOwnedProfileAvatarUrl(body.avatarUrl, user.id);
    const submittedAvatar = typeof body.avatarUrl === "string" && body.avatarUrl.trim().length > 0;
    const existingAvatarUrl = String(member.avatar_url || "").trim();
    const safeExistingAvatarUrl = member.status === "active"
      ? cleanSupabaseAvatarUrl(existingAvatarUrl)
      : cleanOwnedProfileAvatarUrl(existingAvatarUrl, user.id);

    if (submittedAvatar && !avatarUrl) {
      return NextResponse.json({ error: "Profile photo is required" }, { status: 400 });
    }
    if (!avatarUrl && !safeExistingAvatarUrl) {
      return NextResponse.json({ error: "Profile photo is required" }, { status: 400 });
    }

    const memberUpdates: Record<string, unknown> = {
      status: "active",
      name,
      phone,
    };
    if (avatarUrl) memberUpdates.avatar_url = avatarUrl;

    const { error: memberUpdateErr } = await admin
      .from("team_members")
      .update(memberUpdates)
      .eq("id", member.id)
      .eq("workspace_id", workspaceId);

    if (memberUpdateErr) {
      console.error("[auth/complete-setup] member update failed:", memberUpdateErr.message);
      return NextResponse.json({ error: "Could not activate team profile" }, { status: 500 });
    }

    const { error: workspaceErr } = await admin
      .from("workspace_members")
      .upsert(
        {
          workspace_id: workspaceId,
          user_id: user.id,
          role: member.role,
          status: "active",
        },
        { onConflict: "workspace_id,user_id" },
      );

    if (workspaceErr) {
      console.error("[auth/complete-setup] workspace activation failed:", workspaceErr.message);
      await admin.from("team_members").update({ status: member.status }).eq("id", member.id).eq("workspace_id", workspaceId);
      return NextResponse.json({ error: "Could not activate workspace access" }, { status: 500 });
    }

    const metadata: Record<string, unknown> = { ...(user.user_metadata || {}), name, phone, role: member.role };
    if (avatarUrl) metadata.avatar_url = avatarUrl;
    const { error: authUpdateErr } = await admin.auth.admin.updateUserById(user.id, {
      user_metadata: metadata,
    });
    if (authUpdateErr) {
      console.error("[auth/complete-setup] auth metadata update failed:", authUpdateErr.message);
    }

    try {
      await admin.rpc("record_audit_event", {
        p_entity_type: "team",
        p_action: "member_activated",
        p_entity_id: null,
        p_workspace_id: workspaceId,
        p_metadata: {
          user_name: email,
          details: `${name} completed invite setup`,
        },
      });
    } catch {
      // Audit is best-effort; activation state is already committed.
    }

    console.log(`[auth/complete-setup] Activated email_hash=${hashEmail(email)} as ${member.role}`);
    return NextResponse.json({
      success: true,
      workspaceId,
      member: {
        name,
        email,
        role: member.role,
        status: "active",
        avatarUrl: avatarUrl || safeExistingAvatarUrl || null,
      },
    });
  } catch (err: unknown) {
    console.error("[auth/complete-setup]", err);
    return NextResponse.json({ error: "Setup failed" }, { status: 500 });
  }
}
