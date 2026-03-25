import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const maxDuration = 10;

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase admin credentials not configured");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

interface ApproveBody {
  requestId: string;
  action: "approve" | "reject";
  role?: string;
  reviewedBy: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: ApproveBody = await request.json();

    if (!body.requestId || !body.action || !body.reviewedBy) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const admin = getAdminClient();

    // Verify requester is admin/owner
    const { data: reviewer } = await admin
      .from("team_members")
      .select("role")
      .eq("email", body.reviewedBy)
      .single();

    if (!reviewer || (reviewer.role !== "owner" && reviewer.role !== "admin")) {
      return NextResponse.json({ error: "Only admins can approve requests" }, { status: 403 });
    }

    // Get the request
    const { data: req, error: fetchErr } = await admin
      .from("signup_requests")
      .select("*")
      .eq("id", body.requestId)
      .single();

    if (fetchErr || !req) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 });
    }

    if (req.status !== "pending") {
      return NextResponse.json({ error: "Request already processed" }, { status: 409 });
    }

    if (body.action === "reject") {
      await admin
        .from("signup_requests")
        .update({ status: "rejected", reviewed_by: body.reviewedBy, reviewed_at: new Date().toISOString() })
        .eq("id", body.requestId);

      return NextResponse.json({ success: true, action: "rejected" });
    }

    // Approve: send invite via Supabase Auth
    const role = body.role || "viewer";
    const { data: authData, error: authErr } = await admin.auth.admin.inviteUserByEmail(req.email, {
      data: { name: req.name, role, phone: req.phone },
    });

    if (authErr) {
      console.error("[approve-request] Auth invite failed:", authErr.message);
      return NextResponse.json({ error: `Invite failed: ${authErr.message}` }, { status: 500 });
    }

    // Insert into team_members
    const { error: memberErr } = await admin
      .from("team_members")
      .insert({
        name: req.name,
        email: req.email,
        phone: req.phone || null,
        role,
        status: "pending",
      });

    if (memberErr) {
      // Rollback auth user
      if (authData?.user?.id) await admin.auth.admin.deleteUser(authData.user.id);
      return NextResponse.json({ error: "Failed to create team member" }, { status: 500 });
    }

    // Update request status
    await admin
      .from("signup_requests")
      .update({ status: "approved", reviewed_by: body.reviewedBy, reviewed_at: new Date().toISOString() })
      .eq("id", body.requestId);

    return NextResponse.json({ success: true, action: "approved", email: req.email });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[approve-request]", message);
    return NextResponse.json({ error: message.slice(0, 200) }, { status: 500 });
  }
}
