import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const maxDuration = 10;
export const dynamic = "force-dynamic";

const WRITE_ROLES = new Set([
  "superadmin",
  "admin",
  "owner",
  "approver",
  "creative_director",
  "editor",
  "social_media_specialist",
  "video_editor",
  "graphic_designer",
  "specialist",
]);

function assertEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function createCallerClient(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  return createClient(
    assertEnv("NEXT_PUBLIC_SUPABASE_URL"),
    assertEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      global: {
        headers: authorization ? { Authorization: authorization } : {},
      },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  );
}

function createAdminClient() {
  return createClient(
    assertEnv("NEXT_PUBLIC_SUPABASE_URL"),
    assertEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  );
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

type PublishJobRequest = {
  postId?: unknown;
};

export async function POST(request: NextRequest) {
  try {
    const caller = createCallerClient(request);
    const { data: userData, error: userError } = await caller.auth.getUser();
    if (userError || !userData.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json() as PublishJobRequest;
    if (!isUuid(body.postId)) {
      return NextResponse.json({ error: "Invalid postId" }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data: post, error: postError } = await admin
      .from("posts")
      .select("id, workspace_id, stage, scheduled_at, scheduled_date, scheduled_time")
      .eq("id", body.postId)
      .maybeSingle();

    if (postError) {
      return NextResponse.json({ error: postError.message }, { status: 500 });
    }
    if (!post) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    const { data: membership, error: membershipError } = await admin
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", post.workspace_id)
      .eq("user_id", userData.user.id)
      .eq("status", "active")
      .maybeSingle();

    if (membershipError) {
      return NextResponse.json({ error: membershipError.message }, { status: 500 });
    }
    if (!membership || !WRITE_ROLES.has(String(membership.role))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (post.stage !== "approved_scheduled") {
      return NextResponse.json({ error: "Post must be approved_scheduled before creating a publish job" }, { status: 409 });
    }
    if (!post.scheduled_at && (!post.scheduled_date || !post.scheduled_time)) {
      return NextResponse.json({ error: "Post is missing scheduled_at or legacy schedule columns" }, { status: 400 });
    }

    const { data: job, error: jobError } = await admin.rpc("create_publish_job_for_post", {
      p_post_id: body.postId,
    });

    if (jobError) {
      return NextResponse.json({ error: jobError.message }, { status: 500 });
    }

    return NextResponse.json({ job });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[publish-jobs]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
