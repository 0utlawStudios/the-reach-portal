// /api/presence/diag — superadmin forensic dashboard.
//
// Returns v_user_presence_summary as JSON, ordered by best_known_seen.
// Used to verify that all five write paths are populating last_seen_at
// correctly during the post-deploy verification step.
//
// Auth model: requires a valid Bearer token AND that the caller's
// workspace_members.role is in (superadmin, admin, owner).

import type { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const ADMIN_ROLES = ["superadmin", "admin", "owner"];

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function unauthorized() {
  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

function forbidden() {
  return new Response(JSON.stringify({ error: "forbidden" }), {
    status: 403,
    headers: { "Content-Type": "application/json" },
  });
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!auth || !auth.toLowerCase().startsWith("bearer ")) return unauthorized();
  const token = auth.slice(7).trim();
  if (!token) return unauthorized();

  const admin = adminClient();
  if (!admin) {
    return new Response(JSON.stringify({ error: "supabase admin not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { data: userResult, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userResult?.user) return unauthorized();
  const userId = userResult.user.id;

  // Check the caller has an admin-class workspace_members row.
  const { data: membership } = await admin
    .from("workspace_members")
    .select("role, status")
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();

  if (!membership || !ADMIN_ROLES.includes(membership.role)) return forbidden();

  const { data, error } = await admin
    .from("v_user_presence_summary")
    .select("*")
    .order("best_known_seen", { ascending: false, nullsFirst: false });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({
      generated_at: new Date().toISOString(),
      count: data?.length ?? 0,
      rows: data ?? [],
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    },
  );
}
