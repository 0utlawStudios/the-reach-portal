// GET /api/ai/studio/spend — lightweight daily spend chip data.
//
// The Studio client used to query ai_generation_jobs directly on every rows
// change. That hit RLS, showed up as Data API 500s when policies drifted, and
// repeated while the user edited fields. Keep the database read server-side,
// workspace-scoped, and polled at a slow cadence.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireStudioWriter, okResponse } from "@/lib/ai/auth-helpers";
import { dailyCapUsd, todaysSpend } from "@/lib/ai/cost";

export async function GET(req: NextRequest) {
  const auth = await requireStudioWriter(req);
  if (auth instanceof NextResponse) return auth;

  const spent = await todaysSpend(auth.workspaceId);
  return okResponse({
    spend_today_usd: spent,
    daily_cap_usd: dailyCapUsd(),
  });
}
