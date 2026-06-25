// POST /api/support/uploads
// Mint one-shot signed upload URLs so the browser can send attachment files
// straight to Supabase Storage, bypassing Vercel's 4.5 MB function body limit.

import { NextRequest, NextResponse } from "next/server";
import { requireBearerUser } from "@/lib/auth/require";
import { consume } from "@/lib/rate-limit";
import {
  getSupportAdminClient,
  resolveActiveSupportWorkspace,
  workspaceIdFromHeaders,
  createUploadTargets,
  SupportValidationError,
} from "@/lib/support/server";
import { SUPPORT_MAX_FILES } from "@/lib/support/format";

export const runtime = "nodejs";
export const maxDuration = 20;

export async function POST(request: NextRequest) {
  const auth = await requireBearerUser(request);
  if (auth instanceof NextResponse) return auth;

  const rl = await consume("support:upload", auth.user.id, 40, 300, { onError: "deny" });
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many uploads. Please wait a moment." }, { status: 429 });
  }

  let payload: { files?: Array<{ name?: unknown; mime?: unknown; size?: unknown }> };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const rawFiles = Array.isArray(payload.files) ? payload.files : [];
  if (rawFiles.length === 0) return NextResponse.json({ uploads: [] });
  if (rawFiles.length > SUPPORT_MAX_FILES) {
    return NextResponse.json(
      { error: `Please attach at most ${SUPPORT_MAX_FILES} files.` },
      { status: 400 },
    );
  }

  const files = rawFiles.map((f) => ({
    name: String(f?.name ?? "file"),
    mime: String(f?.mime ?? ""),
    size: Number(f?.size ?? 0),
  }));

  const admin = getSupportAdminClient();
  const email = (auth.user.email ?? "").toLowerCase();
  const workspaceId = await resolveActiveSupportWorkspace(admin, auth.user.id, email, workspaceIdFromHeaders(request.headers));
  if (!workspaceId) return NextResponse.json({ error: "No active workspace access" }, { status: 403 });

  try {
    const targets = await createUploadTargets({
      admin,
      workspaceId,
      userId: auth.user.id,
      files,
    });
    return NextResponse.json({ uploads: targets });
  } catch (err) {
    if (err instanceof SupportValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("[support/uploads] failed:", err);
    return NextResponse.json(
      { error: "Could not prepare the upload. Please try again." },
      { status: 500 },
    );
  }
}
