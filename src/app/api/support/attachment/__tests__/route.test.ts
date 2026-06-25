import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
}));

const dbState = vi.hoisted(() => ({
  workspaceMember: true,
  teamRole: "editor",
  teamStatus: "active",
  messageThreadIds: [] as string[],
  readableThread: false,
}));

vi.mock("@/lib/auth/require", () => ({
  requireUser: authMocks.requireUser,
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        contains: vi.fn(() => chain),
        in: vi.fn(() => chain),
        limit: vi.fn((count?: number) => {
          if (table === "support_messages" && count === 20) {
            return Promise.resolve({
              data: dbState.messageThreadIds.map((thread_id) => ({ thread_id })),
              error: null,
            });
          }
          return chain;
        }),
        maybeSingle: vi.fn(() => {
          if (table === "workspace_members") {
            return Promise.resolve({
              data: dbState.workspaceMember ? { workspace_id: "11111111-1111-4111-8111-111111111111" } : null,
              error: null,
            });
          }
          if (table === "team_members") {
            return Promise.resolve({
              data: { role: dbState.teamRole, status: dbState.teamStatus },
              error: null,
            });
          }
          if (table === "support_threads") {
            return Promise.resolve({
              data: dbState.readableThread ? { id: "thread-1" } : null,
              error: null,
            });
          }
          return Promise.resolve({ data: null, error: null });
        }),
      };
      return chain;
    },
  })),
}));

import { GET } from "../route";

function requestFor(key: string) {
  return {
    nextUrl: new URL(`https://thereach.ten80ten.com/api/support/attachment?key=${encodeURIComponent(key)}`),
    headers: { get: () => null },
  } as unknown as Parameters<typeof GET>[0];
}

const KEY = "11111111-1111-4111-8111-111111111111/uploader-user/attachment.png";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
  dbState.workspaceMember = true;
  dbState.teamRole = "editor";
  dbState.teamStatus = "active";
  dbState.messageThreadIds = [];
  dbState.readableThread = false;
  authMocks.requireUser.mockResolvedValue({
    user: { id: "viewer-user", email: "viewer@example.com" },
  });
  global.fetch = vi.fn(() => Promise.resolve(new Response("image", {
    status: 200,
    headers: { "content-type": "image/png", "content-length": "5" },
  }))) as typeof fetch;
});

describe("GET /api/support/attachment", () => {
  it("denies an active non-owner teammate who only has the storage key", async () => {
    const res = await GET(requestFor(KEY));

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ error: "Attachment is not available to this user" });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("allows the attachment owner", async () => {
    authMocks.requireUser.mockResolvedValue({
      user: { id: "uploader-user", email: "uploader@example.com" },
    });

    const res = await GET(requestFor(KEY));

    expect(res.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("allows an active workspace superadmin", async () => {
    dbState.teamRole = "superadmin";

    const res = await GET(requestFor(KEY));

    expect(res.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("allows the owner of a support thread that contains the attachment key", async () => {
    dbState.messageThreadIds = ["thread-1"];
    dbState.readableThread = true;

    const res = await GET(requestFor(KEY));

    expect(res.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
