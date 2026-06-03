import { beforeEach, describe, expect, it, vi } from "vitest";

const sendMail = vi.fn((_: Record<string, unknown>) => Promise.resolve());
const rpc = vi.fn(() => Promise.resolve({ data: null, error: null }));

let postRow: Record<string, unknown> | null;
let teamRows: Array<Record<string, unknown>>;

function makeFrom(table: string) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.maybeSingle = vi.fn(() => Promise.resolve({ data: table === "posts" ? postRow : null, error: null }));
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

function makeRequest(headers: Record<string, string>, body: unknown) {
  const lower: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) lower[key.toLowerCase()] = value;
  return {
    headers: { get: (name: string) => lower[name.toLowerCase()] ?? null },
    json: () => Promise.resolve(body),
  } as Parameters<typeof POST>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-secret";
  process.env.SMTP_USER = "smtp@example.com";
  process.env.SMTP_PASS = "smtp-pass";
  process.env.TELEGRAM_BOT_TOKEN = "telegram-token";
  process.env.TELEGRAM_ADMIN_CHAT_ID = "12345";
  process.env.NEXT_PUBLIC_SITE_URL = "https://reach.ten80ten.com";
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

  it("emails admin/director recipients and sends Telegram when a platform published", async () => {
    const res = await POST(makeRequest(
      { Authorization: "Bearer service-role-secret" },
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

  it("does not send a published email when no platform succeeded", async () => {
    const res = await POST(makeRequest(
      { "x-publisher-secret": "service-role-secret" },
      {
        postId: "11111111-1111-4111-8111-111111111111",
        jobState: "failed",
        publishedCount: 0,
        platforms: [{ platform: "facebook", state: "failed", error: "token expired" }],
      },
    ));

    expect(res.status).toBe(200);
    expect(sendMail).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
