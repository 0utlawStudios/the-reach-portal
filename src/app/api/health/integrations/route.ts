import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "node:crypto";
import { log, newCorrelationId } from "@/lib/logger";

// SEC-002: Constant-time secret comparison so the health token can't be
// recovered byte-by-byte via response-timing analysis.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

// Live integration health probes. Gated by the same HEALTH_CHECK_SECRET as
// /api/health/deep-check. Used to replace the hardcoded "connected" cards on
// the settings page. Closes finding #16 (hardcoded status) as a new endpoint.
// The settings UI wiring is deferred to a follow-up commit so this file only
// adds a new route.
//
// Part of Workstream G (G6) of the security remediation.

export const maxDuration = 10;
export const dynamic = "force-dynamic";

const HEALTH_SECRET = process.env.HEALTH_CHECK_SECRET;

type Status = "pass" | "warn" | "fail";

type Probe = {
  name: string;
  status: Status;
  latency_ms: number;
  message?: string;
};

async function probeSupabase(): Promise<Probe> {
  const start = Date.now();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return {
      name: "supabase",
      status: "fail",
      latency_ms: 0,
      message: "Supabase env vars missing",
    };
  }
  try {
    const client = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error } = await client.from("team_members").select("id").limit(1);
    const latency_ms = Date.now() - start;
    if (error) {
      return { name: "supabase", status: "fail", latency_ms, message: error.message };
    }
    return { name: "supabase", status: "pass", latency_ms };
  } catch (err) {
    return {
      name: "supabase",
      status: "fail",
      latency_ms: Date.now() - start,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

async function probeN8n(): Promise<Probe> {
  const start = Date.now();
  const url = process.env.N8N_HEALTH_WEBHOOK_URL;
  if (!url) {
    return {
      name: "n8n",
      status: "warn",
      latency_ms: 0,
      message: "N8N_HEALTH_WEBHOOK_URL not set",
    };
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, { method: "HEAD", signal: controller.signal });
    clearTimeout(timeout);
    const latency_ms = Date.now() - start;
    if (!res.ok) {
      return { name: "n8n", status: "fail", latency_ms, message: `HTTP ${res.status}` };
    }
    return { name: "n8n", status: "pass", latency_ms };
  } catch (err) {
    return {
      name: "n8n",
      status: "fail",
      latency_ms: Date.now() - start,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

async function probeSmtp(): Promise<Probe> {
  const start = Date.now();
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) {
    return {
      name: "smtp",
      status: "warn",
      latency_ms: 0,
      message: "SMTP credentials not set",
    };
  }
  try {
    const { getTransporter } = await import("@/lib/email-utils");
    const transporter = getTransporter();
    await transporter.verify();
    return { name: "smtp", status: "pass", latency_ms: Date.now() - start };
  } catch (err) {
    return {
      name: "smtp",
      status: "fail",
      latency_ms: Date.now() - start,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

async function probeFeatureFlags(): Promise<Probe> {
  const start = Date.now();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return {
      name: "feature_flags",
      status: "fail",
      latency_ms: 0,
      message: "Supabase env vars missing",
    };
  }
  try {
    const client = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await client
      .from("feature_flags")
      .select("name, enabled");
    const latency_ms = Date.now() - start;
    if (error) {
      // If the table does not exist yet, this is expected until 0001 is applied.
      return {
        name: "feature_flags",
        status: "warn",
        latency_ms,
        message: `table missing or unreadable: ${error.message}. Apply 0001_feature_flags.sql.`,
      };
    }
    return {
      name: "feature_flags",
      status: "pass",
      latency_ms,
      message: `${data?.length ?? 0} flags`,
    };
  } catch (err) {
    return {
      name: "feature_flags",
      status: "fail",
      latency_ms: Date.now() - start,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function GET(request: Request) {
  const correlation_id = newCorrelationId();
  const token = request.headers.get("x-health-token");
  if (!HEALTH_SECRET || !safeEqual(token ?? "", HEALTH_SECRET)) {
    log.warn("integrations health unauthorized", {
      route: "/api/health/integrations",
      correlation_id,
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  log.info("integrations health probe start", {
    route: "/api/health/integrations",
    correlation_id,
  });

  const probes = await Promise.all([
    probeSupabase(),
    probeFeatureFlags(),
    probeN8n(),
    probeSmtp(),
  ]);

  const overall: Status = probes.some((p) => p.status === "fail")
    ? "fail"
    : probes.some((p) => p.status === "warn")
      ? "warn"
      : "pass";

  log.info("integrations health probe end", {
    route: "/api/health/integrations",
    correlation_id,
    overall,
  });

  return NextResponse.json({
    overall,
    correlation_id,
    timestamp: new Date().toISOString(),
    probes,
  });
}
