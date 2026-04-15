import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";

// Server-side Supabase client factories. Used by route handlers that need to
// either (a) act as the caller (verified via cookie-borne JWT) or (b) perform
// privileged operations after verifying the caller. The service-role client
// MUST only be used after requireUser/requireRole has established an actor.
//
// Part of Workstream B (B1) of the security remediation. NOT yet wired to
// any route — this file is a scaffolding helper for future B/D/E workstreams.

function assertEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`${name} is not set`);
  }
  return v;
}

/**
 * Build a Supabase client that acts as the caller, using the access token
 * from the `sb-access-token` cookie. Reads but does not refresh. If the token
 * is absent or expired, auth.getUser() will return null/error and the caller
 * should respond with 401.
 *
 * Uses the anon key + caller-scoped JWT. Never use this for privileged
 * operations — call createServiceRoleClient() after verifying the actor.
 */
export function createServerSupabaseClient(req: NextRequest): SupabaseClient {
  const url = assertEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anon = assertEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const accessToken = req.cookies.get("sb-access-token")?.value;
  return createClient(url, anon, {
    global: {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

/**
 * Build a Supabase client with the service-role key. Bypasses RLS. Use ONLY
 * after requireUser/requireRole has verified the actor. Never expose to a
 * client-facing response.
 */
export function createServiceRoleClient(): SupabaseClient {
  const url = assertEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = assertEnv("SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
