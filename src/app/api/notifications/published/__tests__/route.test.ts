import { beforeEach, describe, expect, it, vi } from "vitest";

const sendMail = vi.fn<(mail: Record<string, unknown>) => Promise<void>>(() => Promise.resolve());
const usedRateLimitKeys = new Set<string>();
const rpc = vi.fn((name: string, args?: Record<string, unknown>) => {
  if (name === "rate_limit_consume") {
    const key = `${String(args?.p_scope)}:${String(args?.p_key)}`;
    const allowed = !usedRateLimitKeys.has(key);
    if (allowed) usedRateLimitKeys.add(key);
    return Promise.resolve({
      data: [{ allowed, remaining: allowed ? 0 : 0, reset_at: new Date(Date.now() + 300_000).toISOString() }],
      error: null,
    });
  }
  return Promise.resolve({ data: null, error: null });
});

let postRow: Record<string, unknown> | null;
let jobRow: Record<string, unknown> | null;
let teamRows: Array<Record<string, unknown>>;

function makeFrom(table: string) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.maybeSingle = vi.fn(() => Promise.resolve({
    data: table === "posts" ? postRow : table === "publish_jobs" ? jobRow : null,
    error: null,
  }));
  builder.then = (resolve: (value: unknown) => unknown) =>
    resolve({ data: table === "team_members" ? teamRows : [], error: null });
  return builder;
}

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    from: vi.fn((table: string) => makeFrom(table)),
    rpc,
  })),
}));

vi.mock("@/lib/email-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email-utils")>();
  return {
    ...actual,
    getTransporter: vi.fn(() => ({ sendMail })),
    getFromAddress: vi.fn(() => "\"The Reach\" <smtp@example.com>"),
  };
});

import { POST } from "../route";
import { signWebhookBody } from "@/lib/webhook-signature";

function makeRequest(headers: Record<string, string>, body: unknown) {
  const lower: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) lower[key.toLowerCase()] = value;
  const rawBody = typeof body === "string" ? body : JSON.stringify(body);
  return {
    headers: { get: (name: string) => lower[name.toLowerCase()] ?? null },
    text: () => Promise.resolve(rawBody),
  } as Parameters<typeof POST>[0];
}

function signedPublisherHeaders(body: unknown, nonce = crypto.randomUUID()) {
  const rawBody = JSON.stringify(body);
  const timestamp = String(Date.now());
  return {
    "x-webhook-timestamp": timestamp,
    "x-webhook-nonce": nonce,
    "x-webhook-signature": signWebhookBody({
      secret: "publisher-hmac-secret",
      timestamp,
      nonce,
      body: rawBody,
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  usedRateLimitKeys.clear();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-secret";
  process.env.PUBLISHER_WEBHOOK_SECRET = "publisher-webhook-secret";
  delete process.env.PUBLISHER_WEBHOOK_HMAC_SECRET;
  process.env.SMTP_USER = "smtp@example.com";
  process.env.SMTP_PASS = "smtp-pass";
  process.env.TELEGRAM_BOT_TOKEN = "telegram-token";
  process.env.TELEGRAM_ADMIN_CHAT_ID = "12345";
  process.env.NEXT_PUBLIC_SITE_URL = "https://thereach.ten80ten.com";
  postRow = {
    id: "11111111-1111-4111-8111-111111111111",
    workspace_id: "00000000-0000-0000-0000-000000000001",
    title: "Suite launch",
    stage: "posted",
    platforms: ["facebook", "instagram"],
    content_type: "image",
    caption: "A polished caption for the published post.",
    posted_at: "2026-06-04T12:00:00.000Z",
    posted_urls: { facebook: "https://facebook.example/post" },
  };
  jobRow = {
    id: "22222222-2222-4222-8222-222222222222",
    post_id: "11111111-1111-4111-8111-111111111111",
    workspace_id: "00000000-0000-0000-0000-000000000001",
  };
  teamRows = [
    { email: "admin@example.com", role: "admin", status: "active" },
    { email: "director@example.com", role: "creative_director", status: "active" },
  ];
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, text: () => Promise.resolve("") })));
});

describe("POST /api/notifications/published", () => {
  it("rejects requests without the publisher secret", async () => {
    const res = await POST(makeRequest({}, { postId: "11111111-1111-4111-8111-111111111111" }));
    expect(res.status).toBe(401);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("rejects the Supabase service-role key as a webhook secret", async () => {
    const res = await POST(makeRequest(
      { Authorization: "Bearer service-role-secret" },
      {
        postId: "11111111-1111-4111-8111-111111111111",
        jobId: "22222222-2222-4222-8222-222222222222",
      },
    ));
    expect(res.status).toBe(401);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("emails admin/director recipients and sends Telegram when a platform published", async () => {
    const res = await POST(makeRequest(
      { Authorization: "Bearer publisher-webhook-secret" },
      {
        postId: "11111111-1111-4111-8111-111111111111",
        jobId: "22222222-2222-4222-8222-222222222222",
        jobState: "succeeded",
        publishedCount: 1,
        platforms: [{ platform: "facebook", state: "succeeded", postUrl: "https://facebook.example/post" }],
      },
    ));

    expect(res.status).toBe(200);
    expect(sendMail).toHaveBeenCalledTimes(1);
    const firstMail = sendMail.mock.calls.at(0)?.[0];
    expect(firstMail).toMatchObject({
      to: ["admin@example.com", "director@example.com"],
      subject: "Published: \"Suite launch\"",
    });
    expect(String(firstMail?.html)).toContain("Executed by Aldr1dge Hypervisor System - Agent 052");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("record_audit_event", expect.objectContaining({
      p_action: "auto_publish_admin_notified",
      p_workspace_id: "00000000-0000-0000-0000-000000000001",
    }));
  });

  it("accepts timestamped HMAC publisher requests and rejects replayed nonces", async () => {
    process.env.PUBLISHER_WEBHOOK_HMAC_SECRET = "publisher-hmac-secret";
    const body = {
      postId: "11111111-1111-4111-8111-111111111111",
      jobId: "22222222-2222-4222-8222-222222222222",
      jobState: "succeeded",
      publishedCount: 1,
      platforms: [{ platform: "facebook", state: "succeeded", postUrl: "https://facebook.example/post" }],
    };
    const headers = signedPublisherHeaders(body, "published-nonce-1");

    const first = await POST(makeRequest(headers, body));
    const replay = await POST(makeRequest(headers, body));

    expect(first.status).toBe(200);
    expect(replay.status).toBe(401);
  });

  it("does not send a published email when no platform succeeded", async () => {
    const res = await POST(makeRequest(
      { "x-publisher-secret": "publisher-webhook-secret" },
      {
        postId: "11111111-1111-4111-8111-111111111111",
        jobId: "22222222-2222-4222-8222-222222222222",
        jobState: "failed",
        publishedCount: 0,
        platforms: [{ platform: "facebook", state: "failed", error: "token expired" }],
      },
    ));

    expect(res.status).toBe(200);
    expect(sendMail).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects notifications when the publish job does not match the post workspace", async () => {
    jobRow = null;

    const res = await POST(makeRequest(
      { Authorization: "Bearer publisher-webhook-secret" },
      {
        postId: "11111111-1111-4111-8111-111111111111",
        jobId: "22222222-2222-4222-8222-222222222222",
        jobState: "succeeded",
        publishedCount: 1,
        platforms: [{ platform: "facebook", state: "succeeded", postUrl: "https://facebook.example/post" }],
      },
    ));

    expect(res.status).toBe(409);
    expect(sendMail).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});
