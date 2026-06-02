import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { rowToThread, rowToMessage } from "@/lib/support/types";
import type { SupportThreadRow, SupportMessageRow } from "@/lib/support/types";
import { tgEscape } from "@/lib/support/telegram";
import { getTeamRole, parseAttachmentClaims } from "@/lib/support/server";

type MockQueryResult = { data: unknown; error?: unknown };
type MockQuery = {
  select: () => MockQuery;
  eq: () => MockQuery;
  limit: () => MockQuery;
  maybeSingle: () => Promise<MockQueryResult>;
};

function makeAdmin(resultsByTable: Record<string, MockQueryResult>): SupabaseClient {
  return {
    from(table: string) {
      const query: MockQuery = {
        select: () => query,
        eq: () => query,
        limit: () => query,
        maybeSingle: async () => resultsByTable[table] ?? { data: null, error: null },
      };
      return query;
    },
  } as unknown as SupabaseClient;
}

describe("rowToThread", () => {
  it("maps a snake_case row to the camelCase domain object", () => {
    const row: SupportThreadRow = {
      id: "t1",
      workspace_id: "w1",
      created_by: "u1",
      created_by_email: "ann@example.com",
      created_by_name: "Ann",
      kind: "ticket",
      subject: "Login bug",
      category: "bug",
      status: "open",
      last_message_at: "2026-05-20T00:00:00Z",
      last_sender_type: "user",
      unread_for_user: false,
      unread_for_admin: true,
      last_user_notified_at: null,
      last_admin_notified_at: null,
      user_last_read_at: null,
      admin_last_read_at: null,
      created_at: "2026-05-20T00:00:00Z",
      updated_at: "2026-05-20T00:00:00Z",
    };
    const thread = rowToThread(row);
    expect(thread.workspaceId).toBe("w1");
    expect(thread.createdByEmail).toBe("ann@example.com");
    expect(thread.unreadForAdmin).toBe(true);
    expect(thread.unreadForUser).toBe(false);
    expect(thread.lastMessageAt).toBe("2026-05-20T00:00:00Z");
  });
});

describe("rowToMessage", () => {
  it("coerces null attachments to an empty array", () => {
    const row: SupportMessageRow = {
      id: "m1",
      thread_id: "t1",
      workspace_id: "w1",
      sender_type: "admin",
      sender_name: "Tech Team",
      body: "Looking into it.",
      attachments: null,
      created_at: "2026-05-20T00:00:00Z",
    };
    const message = rowToMessage(row);
    expect(message.threadId).toBe("t1");
    expect(message.senderType).toBe("admin");
    expect(message.attachments).toEqual([]);
  });
  it("keeps a present attachments array", () => {
    const message = rowToMessage({
      id: "m2",
      thread_id: "t1",
      workspace_id: "w1",
      sender_type: "user",
      sender_name: "Ann",
      body: null,
      attachments: [
        { storageKey: "w1/u1/a.png", signedUrl: "https://s/a.png", mime: "image/png", name: "a.png", size: 10, kind: "image" },
      ],
      created_at: "2026-05-20T00:00:00Z",
    });
    expect(message.attachments).toHaveLength(1);
    expect(message.attachments[0].storageKey).toBe("w1/u1/a.png");
  });
});

describe("tgEscape", () => {
  it("escapes HTML-significant characters for Telegram", () => {
    expect(tgEscape("<b>&</b>")).toBe("&lt;b&gt;&amp;&lt;/b&gt;");
  });
  it("returns an empty string for null or undefined", () => {
    expect(tgEscape(null)).toBe("");
    expect(tgEscape(undefined)).toBe("");
  });
});

describe("parseAttachmentClaims", () => {
  it("returns an empty array for non-array input", () => {
    expect(parseAttachmentClaims(null)).toEqual([]);
    expect(parseAttachmentClaims("nope")).toEqual([]);
    expect(parseAttachmentClaims(undefined)).toEqual([]);
  });
  it("keeps claims with a storageKey and drops empty ones", () => {
    const out = parseAttachmentClaims([
      { storageKey: "w/u/a.png", name: "a.png" },
      { storageKey: "", name: "empty" },
      { name: "no-key" },
    ]);
    expect(out).toEqual([{ storageKey: "w/u/a.png", name: "a.png" }]);
  });
  it("coerces a missing name to 'file'", () => {
    const out = parseAttachmentClaims([{ storageKey: "w/u/b.mp4" }]);
    expect(out[0].name).toBe("file");
  });
  it("never returns more than the file cap plus one", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ storageKey: `k${i}`, name: `n${i}` }));
    expect(parseAttachmentClaims(many).length).toBe(6);
  });
});

describe("getTeamRole", () => {
  it("returns a lowercased role only for an active team member with active workspace access", async () => {
    const admin = makeAdmin({
      team_members: { data: { role: "SuperAdmin", status: "active" } },
      workspace_members: { data: { id: "wm1" } },
    });
    await expect(getTeamRole(admin, "OWNER@EXAMPLE.COM", "u1")).resolves.toBe("superadmin");
  });

  it("rejects inactive or pending team rows", async () => {
    const admin = makeAdmin({
      team_members: { data: { role: "superadmin", status: "pending" } },
      workspace_members: { data: { id: "wm1" } },
    });
    await expect(getTeamRole(admin, "owner@example.com", "u1")).resolves.toBeNull();
  });

  it("rejects callers without active workspace access when a user id is provided", async () => {
    const admin = makeAdmin({
      team_members: { data: { role: "superadmin", status: "active" } },
      workspace_members: { data: null },
    });
    await expect(getTeamRole(admin, "owner@example.com", "u1")).resolves.toBeNull();
  });
});
