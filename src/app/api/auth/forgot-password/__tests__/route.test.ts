import { beforeEach, describe, expect, it, vi } from "vitest";

type LinkResult = {
  data?: { properties?: { hashed_token?: string } } | null;
  error?: { message: string } | null;
};

let teamMember: { name: string; role: string; status: string } | null;
let linkResults: LinkResult[];
let createUserResult: { data?: { user?: { id?: string } } | null; error?: { message: string } | null };
let operations: Array<{ method: string; payload?: unknown; id?: string }>;
let sentMessages: Array<{ from: string; to: string; subject: string; html: string }>;
let recoveryUrl: string | null;
let setupUrl: string | null;

function makeQuery(table: string) {
  const builder: Record<string, unknown> = {};
  builder.select = vi.fn(() => builder);
  builder.limit = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.maybeSingle = vi.fn(() => {
    if (table === "workspaces") return Promise.resolve({ data: { id: "00000000-0000-0000-0000-000000000001" }, error: null });
    if (table === "team_members") return Promise.resolve({ data: teamMember, error: null });
    return Promise.resolve({ data: null, error: null });
  });
  return builder;
}

vi.mock("@/lib/rate-limit", () => ({
  consume: vi.fn(() => Promise.resolve({ allowed: true, remaining: 4, resetAt: new Date() })),
  getClientIp: vi.fn(() => "127.0.0.1"),
}));

vi.mock("@/lib/email-utils", () => ({
  getTransporter: vi.fn(() => ({
    sendMail: vi.fn((message: { from: string; to: string; subject: string; html: string }) => {
      sentMessages.push(message);
      return Promise.resolve();
    }),
  })),
  getFromAddress: vi.fn(() => "\"The Reach\" <smtp@example.com>"),
  getSiteUrl: vi.fn(() => "https://thereach.ten80ten.com"),
  buildPasswordResetEmailHtml: vi.fn((url: string) => {
    recoveryUrl = url;
    return `reset:${url}`;
  }),
  buildInviteEmailHtml: vi.fn((_name: string, _role: string, url: string) => {
    setupUrl = url;
    return `setup:${url}`;
  }),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    auth: {
      admin: {
        createUser: vi.fn((payload: unknown) => {
          operations.push({ method: "createUser", payload });
          return Promise.resolve(createUserResult);
        }),
        deleteUser: vi.fn((id: string) => {
          operations.push({ method: "deleteUser", id });
          return Promise.resolve({ data: null, error: null });
        }),
        generateLink: vi.fn((payload: unknown) => {
          operations.push({ method: "generateLink", payload });
          return Promise.resolve(linkResults.shift() || { data: null, error: { message: "missing mock" } });
        }),
      },
    },
    from: vi.fn((table: string) => makeQuery(table)),
  })),
}));

import { POST } from "../route";

function makeRequest(body: Record<string, unknown>) {
  return {
    headers: { get: () => null },
    json: () => Promise.resolve(body),
  } as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  process.env.NEXT_PUBLIC_SITE_URL = "https://thereach.ten80ten.com";
  teamMember = null;
  linkResults = [];
  createUserResult = { data: { user: { id: "new-auth-user" } }, error: null };
  operations = [];
  sentMessages = [];
  recoveryUrl = null;
  setupUrl = null;
});

describe("POST /api/auth/forgot-password", () => {
  it("sends an encoded recovery link when the Auth user exists", async () => {
    linkResults = [{ data: { properties: { hashed_token: "hash+with/slash=" } }, error: null }];

    const res = await POST(makeRequest({ email: " Aldridge@Ten80Ten.com " }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(recoveryUrl).toBe("https://thereach.ten80ten.com/auth/confirm?token_hash=hash%2Bwith%2Fslash%3D&type=recovery");
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]).toMatchObject({
      to: "aldridge@ten80ten.com",
      subject: "Reset your password for The Reach",
      html: `reset:${recoveryUrl}`,
    });
    expect(operations).toEqual([
      {
        method: "generateLink",
        payload: { type: "recovery", email: "aldridge@ten80ten.com" },
      },
    ]);
  });

  it("preserves workspace context on recovery links when the request provides it", async () => {
    teamMember = { name: "Aldridge Dagos", role: "superadmin", status: "active" };
    linkResults = [{ data: { properties: { hashed_token: "hash+with/slash=" } }, error: null }];

    const res = await POST(makeRequest({
      email: "aldridge@ten80ten.com",
      workspaceId: "00000000-0000-0000-0000-000000000001",
    }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(recoveryUrl).toBe("https://thereach.ten80ten.com/auth/confirm?token_hash=hash%2Bwith%2Fslash%3D&type=recovery&workspaceId=00000000-0000-0000-0000-000000000001");
    expect(sentMessages).toHaveLength(1);
    expect(operations).toEqual([
      {
        method: "generateLink",
        payload: { type: "recovery", email: "aldridge@ten80ten.com" },
      },
    ]);
  });

  it("does not send a tenant-scoped recovery link when the email is not active in that workspace", async () => {
    linkResults = [{ data: { properties: { hashed_token: "hash+with/slash=" } }, error: null }];

    const res = await POST(makeRequest({
      email: "outside@example.com",
      workspaceId: "00000000-0000-0000-0000-000000000001",
    }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(recoveryUrl).toBeNull();
    expect(sentMessages).toEqual([]);
    expect(operations).toEqual([]);
  });

  it("sends a setup invite for an active team member without an Auth user", async () => {
    teamMember = { name: "Aldridge Dagos", role: "superadmin", status: "active" };
    linkResults = [
      { data: null, error: { message: "User not found" } },
      { data: { properties: { hashed_token: "invite+hash/slash=" } }, error: null },
    ];

    const res = await POST(makeRequest({
      email: "aldridge@ten80ten.com",
      workspaceId: "00000000-0000-0000-0000-000000000001",
    }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(setupUrl).toBe("https://thereach.ten80ten.com/auth/confirm?token_hash=invite%2Bhash%2Fslash%3D&type=invite&workspaceId=00000000-0000-0000-0000-000000000001");
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]).toMatchObject({
      to: "aldridge@ten80ten.com",
      subject: "Set up your account for The Reach",
      html: `setup:${setupUrl}`,
    });
    expect(operations).toEqual([
      {
        method: "generateLink",
        payload: { type: "recovery", email: "aldridge@ten80ten.com" },
      },
      {
        method: "createUser",
        payload: expect.objectContaining({
          email: "aldridge@ten80ten.com",
          email_confirm: false,
          user_metadata: { name: "Aldridge Dagos", role: "superadmin" },
        }),
      },
      {
        method: "generateLink",
        payload: {
          type: "invite",
          email: "aldridge@ten80ten.com",
          options: { data: { name: "Aldridge Dagos", role: "superadmin" } },
        },
      },
    ]);
  });

  it("still sends a setup link when a previous attempt already created the Auth user", async () => {
    teamMember = { name: "Aldridge Dagos", role: "superadmin", status: "active" };
    createUserResult = { data: null, error: { message: "User already registered" } };
    linkResults = [
      { data: null, error: { message: "Email not confirmed" } },
      { data: { properties: { hashed_token: "retry-hash" } }, error: null },
    ];

    const res = await POST(makeRequest({
      email: "aldridge@ten80ten.com",
      workspaceId: "00000000-0000-0000-0000-000000000001",
    }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(setupUrl).toBe("https://thereach.ten80ten.com/auth/confirm?token_hash=retry-hash&type=invite&workspaceId=00000000-0000-0000-0000-000000000001");
    expect(sentMessages).toHaveLength(1);
    expect(operations).toEqual([
      {
        method: "generateLink",
        payload: { type: "recovery", email: "aldridge@ten80ten.com" },
      },
      {
        method: "createUser",
        payload: expect.objectContaining({ email: "aldridge@ten80ten.com" }),
      },
      {
        method: "generateLink",
        payload: {
          type: "invite",
          email: "aldridge@ten80ten.com",
          options: { data: { name: "Aldridge Dagos", role: "superadmin" } },
        },
      },
    ]);
  });

  it("does not create an Auth user when the email is not a known team member", async () => {
    linkResults = [{ data: null, error: { message: "User not found" } }];

    const res = await POST(makeRequest({ email: "unknown@example.com" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(sentMessages).toEqual([]);
    expect(operations).toEqual([
      {
        method: "generateLink",
        payload: { type: "recovery", email: "unknown@example.com" },
      },
    ]);
  });

  it("does not send setup fallback links without workspace context", async () => {
    teamMember = { name: "Aldridge Dagos", role: "superadmin", status: "active" };
    linkResults = [{ data: null, error: { message: "User not found" } }];

    const res = await POST(makeRequest({ email: "aldridge@ten80ten.com" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(setupUrl).toBeNull();
    expect(sentMessages).toEqual([]);
    expect(operations).toEqual([
      {
        method: "generateLink",
        payload: { type: "recovery", email: "aldridge@ten80ten.com" },
      },
    ]);
  });
});
