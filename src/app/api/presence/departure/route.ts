// /api/presence/departure — departure beacon endpoint.
//
// Called via navigator.sendBeacon() on the `pagehide` event only (the `freeze`
// listener was removed). The client also applies a 5-minute cooldown so a
// pagehide that fires repeatedly won't fan out beacons. The browser typically
// gives us ≤ 100ms to complete this, so we keep the work minimal: validate the
// bearer token in the body, then upsert user_presence using the service-role
// client (RPC requires an auth context that isn't available on a beacon
// request).
//
// Returns 204 on success or on any swallowed error — the client doesn't care
// about the response and we don't want to retry a torn-down request.

import type { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { consume, getClientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

type BeaconBody = { token?: string; ts?: number };

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function POST(req: NextRequest) {
  try {
    // SEC-011: Beacon endpoints are still a public POST surface. Cap them
    // at 120/min/IP so a misbehaving client (or attacker) can't fan out
    // user_presence upserts at line rate. We return 204 on rate-limit hit
    // to preserve beacon semantics — sendBeacon() doesn't surface non-2xx
    // and we don't want the dying page to retry.
    const rl = await consume("presence-departure:ip", getClientIp(req), 120, 60);
    if (!rl.allowed) {
      return new Response(null, { status: 204 });
    }

    const text = await req.text();
    let body: BeaconBody = {};
    if (text) {
      try {
        body = JSON.parse(text) as BeaconBody;
      } catch {
        // sendBeacon may send a malformed body if the page is dying; bail
        // quietly with 204 rather than 400.
        return new Response(null, { status: 204 });
      }
    }

    const token = body.token;
    if (!token) {
      return new Response(null, { status: 204 });
    }

    const admin = adminClient();
    if (!admin) {
      console.error("[presence/departure] admin client not configured");
      return new Response(null, { status: 204 });
    }

    // Validate the token by exchanging it for the user (no RPC needed).
    const { data: userResult, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userResult?.user) {
      return new Response(null, { status: 204 });
    }
    const userId = userResult.user.id;

    // Upsert directly — bypasses RLS via service role, matches what
    // touch_my_presence(false) would have done if we had an auth context.
    const nowIso = new Date().toISOString();
    const { error: upsertErr } = await admin
      .from("user_presence")
      .upsert(
        {
          user_id: userId,
          last_seen_at: nowIso,
          updated_at: nowIso,
        },
        { onConflict: "user_id" },
      );

    if (upsertErr) {
      console.error("[presence/departure] upsert failed", upsertErr.message);
    }

    return new Response(null, { status: 204 });
  } catch (err) {
    console.error("[presence/departure] handler error", err);
    return new Response(null, { status: 204 });
  }
}
