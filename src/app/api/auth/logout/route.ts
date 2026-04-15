import { NextResponse, type NextRequest } from "next/server";
import {
  createServerSupabaseClient,
  createServiceRoleClient,
} from "@/lib/supabase/server";
import { log, newCorrelationId } from "@/lib/logger";

// Server-side logout. Revokes the current refresh token via the Supabase
// admin API and clears session cookies on the response. Closes the server
// side of finding #8 (login/session state). Part of Workstream B (B5).

export const maxDuration = 5;

function clearCookies(res: NextResponse): NextResponse {
  res.cookies.delete("sb-access-token");
  res.cookies.delete("sb-refresh-token");
  return res;
}

export async function POST(req: NextRequest) {
  const correlation_id = newCorrelationId();
  try {
    const supabase = createServerSupabaseClient(req);
    const { data: userData } = await supabase.auth.getUser();
    const user = userData?.user;

    if (user) {
      try {
        const admin = createServiceRoleClient();
        await admin.auth.admin.signOut(user.id);
        log.info("logout success", {
          route: "/api/auth/logout",
          correlation_id,
          user_id: user.id,
        });
      } catch (adminErr) {
        log.warn("logout admin signOut failed", {
          route: "/api/auth/logout",
          correlation_id,
          user_id: user.id,
          message: adminErr instanceof Error ? adminErr.message : String(adminErr),
        });
      }
    } else {
      log.info("logout without active session", {
        route: "/api/auth/logout",
        correlation_id,
      });
    }

    return clearCookies(NextResponse.json({ ok: true, correlation_id }));
  } catch (err) {
    log.error("logout failed", {
      route: "/api/auth/logout",
      correlation_id,
      message: err instanceof Error ? err.message : String(err),
    });
    // Still clear cookies on error so the client state is cleaned up.
    return clearCookies(
      NextResponse.json({ ok: false, correlation_id, error: "logout failed" }, { status: 500 }),
    );
  }
}
