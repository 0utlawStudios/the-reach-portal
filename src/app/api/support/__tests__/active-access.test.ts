import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveActiveSupportWorkspace: vi.fn(),
  getSupportAdminClient: vi.fn(() => ({})),
  createUploadTargets: vi.fn(),
  getOrCreateChatThread: vi.fn(),
  buildAttachmentsFromClaims: vi.fn(),
  workspaceIdFromHeaders: vi.fn(() => "workspace-1"),
}));

vi.mock("@/lib/auth/require", () => ({
  requireBearerUser: vi.fn(() => Promise.resolve({ user: { id: "user-1", email: "pending@example.com" } })),
  requireBearerTeamRole: vi.fn(() => Promise.resolve({ user: { id: "admin-1", email: "admin@example.com" }, workspaceId: "workspace-1", role: "superadmin" })),
}));

vi.mock("@/lib/rate-limit", () => ({
  consume: vi.fn(() => Promise.resolve({ allowed: true })),
}));

vi.mock("@/lib/support/server", () => {
  class SupportValidationError extends Error {}
  return {
    SupportValidationError,
    getSupportAdminClient: mocks.getSupportAdminClient,
    resolveWorkspaceId: vi.fn(() => Promise.resolve("workspace-1")),
    workspaceIdFromHeaders: mocks.workspaceIdFromHeaders,
    resolveActiveSupportWorkspace: mocks.resolveActiveSupportWorkspace,
    resolveUserName: vi.fn(() => Promise.resolve("Pending User")),
    parseAttachmentClaims: vi.fn(() => []),
    buildAttachmentsFromClaims: mocks.buildAttachmentsFromClaims,
    createUploadTargets: mocks.createUploadTargets,
    findChatThread: vi.fn(),
    getOrCreateChatThread: mocks.getOrCreateChatThread,
    resignAttachments: vi.fn(),
    notifyAdminOfTicket: vi.fn(),
    notifyAdminOfMessage: vi.fn(),
    recordSupportAudit: vi.fn(),
  };
});

import { GET as getThreads, POST as postThread } from "../threads/route";
import { GET as getChat, POST as postChat } from "../chat/route";
import { POST as postUpload } from "../uploads/route";

function makeRequest(body?: unknown) {
  return {
    url: "https://thereach.ten80ten.com/api/support/test",
    headers: { get: () => "Bearer token" },
    json: () => Promise.resolve(body ?? {}),
  } as unknown as Parameters<typeof postThread>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveActiveSupportWorkspace.mockResolvedValue(null);
});

describe("support user routes active workspace gate", () => {
  it("blocks ticket list without active team/workspace membership", async () => {
    const res = await getThreads(makeRequest());
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ error: "No active workspace access" });
    expect(mocks.resolveActiveSupportWorkspace).toHaveBeenCalledWith(expect.anything(), "user-1", "pending@example.com", "workspace-1");
  });

  it("blocks ticket creation before support rows are written", async () => {
    const res = await postThread(makeRequest({ body: "I need help with the dashboard.", category: "bug" }));
    expect(res.status).toBe(403);
    expect(mocks.buildAttachmentsFromClaims).not.toHaveBeenCalled();
  });

  it("blocks chat reads and sends without active access", async () => {
    await expect((await getChat(makeRequest())).status).toBe(403);
    const sendRes = await postChat(makeRequest({ body: "Hello support" }));
    expect(sendRes.status).toBe(403);
    expect(mocks.getOrCreateChatThread).not.toHaveBeenCalled();
  });

  it("blocks upload URL minting without active access", async () => {
    const res = await postUpload(makeRequest({ files: [{ name: "bug.png", mime: "image/png", size: 1024 }] }));
    expect(res.status).toBe(403);
    expect(mocks.createUploadTargets).not.toHaveBeenCalled();
  });
});
