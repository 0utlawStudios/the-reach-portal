import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  requireBearerTeamRole: vi.fn(),
}));

const adminMocks = vi.hoisted(() => ({
  flagEnabled: false,
  flagError: null as { message: string } | null,
  upsert: vi.fn(),
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
  builder.maybeSingle = vi.fn(() => Promise.resolve({
    data: adminMocks.flagError ? null : { enabled: adminMocks.flagEnabled },
    error: adminMocks.flagError,
  }));
  builder.upsert = adminMocks.upsert;
  return builder;
}

function makeAdminClient() {
  return {
    from: vi.fn((table: string) => {
      if (table !== "feature_flags") throw new Error(`unexpected table ${table}`);
      return featureFlagsBuilder();
    }),
    rpc: adminMocks.rpc,
  };
}

import { GET, PATCH } from "../route";

function makeRequest(body?: Record<string, unknown>) {
  return {
    headers: { get: () => "Bearer test-token" },
    json: () => Promise.resolve(body ?? {}),
  } as unknown as Parameters<typeof PATCH>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  adminMocks.flagEnabled = false;
  adminMocks.flagError = null;
  adminMocks.upsert.mockResolvedValue({ error: null });
  adminMocks.rpc.mockResolvedValue({ data: null, error: null });
  adminMocks.createServiceRoleClient.mockReturnValue(makeAdminClient());
  authMocks.requireBearerTeamRole.mockResolvedValue({
    user: { id: "user-1" },
    email: "aldridge@ten80ten.com",
    role: "superadmin",
    workspaceId: "00000000-0000-0000-0000-000000000001",
  });
});

describe("/api/admin/manual-posted-settings", () => {
  it("lets active users read the workspace setting and reports whether they can toggle", async () => {
    adminMocks.flagEnabled = true;
    authMocks.requireBearerTeamRole.mockResolvedValueOnce({
      user: { id: "approver-1" },
      email: "approver@example.com",
      role: "approver",
      workspaceId: "00000000-0000-0000-0000-000000000001",
    });

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ enabled: true, canToggle: false });
  });

  it("allows only superadmin callers to toggle the flag", async () => {
    const res = await PATCH(makeRequest({ enabled: true }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ enabled: true, canToggle: true });
    expect(adminMocks.upsert).toHaveBeenCalledWith(expect.objectContaining({
      name: "manual_posted_moves",
      workspace_id: "00000000-0000-0000-0000-000000000001",
      enabled: true,
    }), { onConflict: "workspace_id,name" });
    expect(adminMocks.rpc).toHaveBeenCalledWith("record_audit_event", expect.objectContaining({
      p_entity_type: "setting",
      p_action: "settings_changed",
    }));
  });

  it("rejects invalid toggle payloads before writing", async () => {
    const res = await PATCH(makeRequest({ enabled: "true" }));

    expect(res.status).toBe(400);
    expect(adminMocks.upsert).not.toHaveBeenCalled();
  });
});
