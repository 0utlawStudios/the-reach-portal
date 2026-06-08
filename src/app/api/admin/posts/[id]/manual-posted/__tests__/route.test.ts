import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  requireBearerTeamRole: vi.fn(),
}));

const adminMocks = vi.hoisted(() => ({
  flagEnabled: true,
  postStage: "approved_scheduled",
  postId: "11111111-1111-4111-8111-111111111111",
  postError: null as { message: string } | null,
  updateError: null as { message: string } | null,
  update: vi.fn(),
  rpc: vi.fn(),
  createServiceRoleClient: vi.fn(),
}));

vi.mock("@/lib/auth/require", () => ({
  requireBearerTeamRole: authMocks.requireBearerTeamRole,
}));

vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: adminMocks.createServiceRoleClient,
}));

function featureFlagsBuilder() {
  const builder: Record<string, unknown> = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.maybeSingle = vi.fn(() => Promise.resolve({ data: { enabled: adminMocks.flagEnabled }, error: null }));
  return builder;
}

function postsBuilder(mode: "read" | "update" = "read") {
  const builder: Record<string, unknown> = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.update = vi.fn((patch: Record<string, unknown>) => {
    adminMocks.update(patch);
    return postsBuilder("update");
  });
  builder.maybeSingle = vi.fn(() => {
    if (mode === "update") {
      return Promise.resolve({
        data: adminMocks.updateError ? null : { id: adminMocks.postId, stage: "posted", posted_at: "2026-06-09T00:00:00.000Z" },
        error: adminMocks.updateError,
      });
    }
    return Promise.resolve({
      data: adminMocks.postError ? null : {
        id: adminMocks.postId,
        title: "Approved post",
        stage: adminMocks.postStage,
        workspace_id: "00000000-0000-0000-0000-000000000001",
        posted_at: null,
      },
      error: adminMocks.postError,
    });
  });
  return builder;
}

function makeAdminClient() {
  return {
    from: vi.fn((table: string) => {
      if (table === "feature_flags") return featureFlagsBuilder();
      if (table === "posts") return postsBuilder();
      throw new Error(`unexpected table ${table}`);
    }),
    rpc: adminMocks.rpc,
  };
}

import { POST } from "../route";

const VALID_ID = "11111111-1111-4111-8111-111111111111";

function makeRequest(body: Record<string, unknown> = {}) {
  return {
    headers: { get: () => "Bearer test-token" },
    json: () => Promise.resolve(body),
  } as unknown as Parameters<typeof POST>[0];
}

function ctx(id = VALID_ID) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  adminMocks.flagEnabled = true;
  adminMocks.postStage = "approved_scheduled";
  adminMocks.postError = null;
  adminMocks.updateError = null;
  adminMocks.rpc.mockResolvedValue({ data: null, error: null });
  adminMocks.createServiceRoleClient.mockReturnValue(makeAdminClient());
  authMocks.requireBearerTeamRole.mockResolvedValue({
    user: { id: "approver-1" },
    email: "approver@example.com",
    role: "approver",
    workspaceId: "00000000-0000-0000-0000-000000000001",
  });
});

describe("POST /api/admin/posts/[id]/manual-posted", () => {
  it("lets an approver move an Approved/Scheduled card to Posted when the flag is enabled", async () => {
    const res = await POST(makeRequest({ postedAt: "2026-06-09T00:00:00.000Z" }), ctx());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.stage).toBe("posted");
    expect(authMocks.requireBearerTeamRole).toHaveBeenCalledWith(expect.anything(), [
      "superadmin",
      "admin",
      "owner",
      "approver",
      "creative_director",
    ]);
    expect(adminMocks.update).toHaveBeenCalledWith({
      stage: "posted",
      posted_at: "2026-06-09T00:00:00.000Z",
    });
    expect(adminMocks.rpc).toHaveBeenCalledWith("record_audit_event", expect.objectContaining({
      p_action: "manual_posted",
    }));
  });

  it("rejects manual posted moves while the global flag is disabled", async () => {
    adminMocks.flagEnabled = false;

    const res = await POST(makeRequest(), ctx());

    expect(res.status).toBe(403);
    expect(adminMocks.update).not.toHaveBeenCalled();
  });

  it("rejects non-approved source stages even when the flag is enabled", async () => {
    adminMocks.postStage = "awaiting_approval";

    const res = await POST(makeRequest(), ctx());

    expect(res.status).toBe(409);
    expect(adminMocks.update).not.toHaveBeenCalled();
  });
});
