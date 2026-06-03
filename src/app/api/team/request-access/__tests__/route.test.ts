import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const SIGNUP_REQUESTS_WORKSPACE_MIGRATION_SRC = readFileSync(
  join(process.cwd(), "supabase/migrations/0040_signup_requests_workspace_hardening.sql"),
  "utf8",
);

type MockResult = { data?: unknown; error?: { message: string } | null };

let tableResults: Record<string, {
  maybeSingle?: MockResult | MockResult[];
  insert?: MockResult;
  list?: MockResult;
}>;
let operations: Array<
  | { table: string; method: "insert"; payload: Record<string, unknown> }
  | { table: string; method: "select"; filters: Array<[string, unknown]>; inFilters: Array<[string, unknown[]]> }
  | { table: "audit"; method: "rpc"; payload: unknown }
>;
let sendMail: ReturnType<typeof vi.fn>;

function nextResult(value: MockResult | MockResult[] | undefined): MockResult {
  if (Array.isArray(value)) return value.shift() || { data: null, error: null };
  return value || { data: null, error: null };
}

function makeQuery(table: string) {
  const state = {
    method: "select" as "select" | "insert",
    filters: [] as Array<[string, unknown]>,
    inFilters: [] as Array<[string, unknown[]]>,
    payload: null as Record<string, unknown> | null,
  };
  const builder: Record<string, unknown> = {};
  builder.select = vi.fn(() => builder);
  builder.insert = vi.fn((payload: Record<string, unknown>) => {
    state.method = "insert";
    state.payload = payload;
    operations.push({ table, method: "insert", payload });
    return builder;
  });
  builder.eq = vi.fn((column: string, value: unknown) => {
    state.filters.push([column, value]);
    return builder;
  });
  builder.in = vi.fn((column: string, values: unknown[]) => {
    state.inFilters.push([column, values]);
    operations.push({ table, method: "select", filters: state.filters, inFilters: state.inFilters });
    return builder;
  });
  builder.maybeSingle = vi.fn(() => Promise.resolve(nextResult(tableResults[table]?.maybeSingle)));
  builder.single = vi.fn(() => {
    if (state.method === "insert") return Promise.resolve(nextResult(tableResults[table]?.insert));
    return Promise.resolve(nextResult(tableResults[table]?.maybeSingle));
  });
  builder.then = (resolve: (value: MockResult) => unknown, reject: (reason: unknown) => unknown) => {
    const value = tableResults[table]?.list || { data: null, error: null };
    return Promise.resolve(value).then(resolve, reject);
  };
  return builder;
}

vi.mock("@/lib/rate-limit", () => ({
  consume: vi.fn(() => Promise.resolve({ allowed: true, remaining: 4, resetAt: new Date() })),
  getClientIp: vi.fn(() => "127.0.0.1"),
}));

vi.mock("@/lib/email-utils", () => ({
  getTransporter: vi.fn(() => ({ sendMail })),
  getFromAddress: vi.fn(() => '"The Reach" <smtp@example.com>'),
  buildAdminNotificationHtml: vi.fn(() => "<p>request</p>"),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    from: vi.fn((table: string) => makeQuery(table)),
    rpc: vi.fn((_fn: string, payload: unknown) => {
      operations.push({ table: "audit", method: "rpc", payload });
      return Promise.resolve({ data: null, error: null });
    }),
  })),
}));

import { POST } from "../route";

function makeRequest(body: Record<string, unknown>) {
  return {
    headers: { get: () => "127.0.0.1" },
    json: () => Promise.resolve(body),
  } as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  process.env.SMTP_USER = "smtp@example.com";
  process.env.SMTP_PASS = "smtp-pass";
  sendMail = vi.fn(() => Promise.resolve({ messageId: "msg-1" }));
  operations = [];
  tableResults = {
    team_members: {
      maybeSingle: { data: null, error: null },
      list: { data: [{ email: "admin@example.com" }], error: null },
    },
    signup_requests: {
      maybeSingle: { data: null, error: null },
      insert: { data: { id: "request-1" }, error: null },
    },
  };
});

describe("POST /api/team/request-access", () => {
  it("keeps signup request workspace scope non-null in migration history", () => {
    expect(SIGNUP_REQUESTS_WORKSPACE_MIGRATION_SRC).toContain("ALTER COLUMN workspace_id SET NOT NULL");
    expect(SIGNUP_REQUESTS_WORKSPACE_MIGRATION_SRC).toContain("workspace_id = '00000000-0000-0000-0000-000000000001'");
    expect(SIGNUP_REQUESTS_WORKSPACE_MIGRATION_SRC).not.toContain("workspace_id is null");
  });

  it("saves a new request with the baseline workspace before notifying admins", async () => {
    const res = await POST(makeRequest({
      name: "Hanes Abasola",
      email: " Hanes@Ten80Ten.com ",
      phone: "+1 555",
      company: "The Reach",
      reason: "Client demo",
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, requestId: "request-1", status: "pending", emailSent: true });
    expect(operations).toEqual(expect.arrayContaining([
      {
        table: "signup_requests",
        method: "insert",
        payload: expect.objectContaining({
          workspace_id: "00000000-0000-0000-0000-000000000001",
          email: "hanes@ten80ten.com",
          status: "pending",
          requested_by: "hanes@ten80ten.com",
        }),
      },
    ]));
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      to: "admin@example.com",
      subject: "New Access Request: Hanes Abasola",
    }));
  });

  it("does not show success when the signup request insert fails", async () => {
    tableResults.signup_requests.insert = { data: null, error: { message: "database unavailable" } };

    const res = await POST(makeRequest({ name: "New User", email: "new@example.com" }));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain("could not be saved");
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("returns a generic received response when the email already belongs to the team", async () => {
    tableResults.team_members.maybeSingle = { data: { id: "member-1", status: "active" }, error: null };

    const res = await POST(makeRequest({ name: "Aldridge", email: "aldridge@ten80ten.com" }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, status: "received" });
    expect(JSON.stringify(body)).not.toContain("active");
    expect(JSON.stringify(body)).not.toContain("team_member");
    expect(operations.some((op) => op.table === "signup_requests" && op.method === "insert")).toBe(false);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("does not create duplicate pending requests", async () => {
    tableResults.signup_requests.maybeSingle = { data: { id: "existing-request" }, error: null };

    const res = await POST(makeRequest({ name: "Pending User", email: "pending@example.com" }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, status: "received" });
    expect(JSON.stringify(body)).not.toContain("pending review");
    expect(operations.some((op) => op.table === "signup_requests" && op.method === "insert")).toBe(false);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("keeps the saved request when admin email delivery fails", async () => {
    sendMail.mockRejectedValueOnce(new Error("smtp down"));

    const res = await POST(makeRequest({ name: "Saved User", email: "saved@example.com" }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, requestId: "request-1", emailSent: false });
    expect(operations).toEqual(expect.arrayContaining([
      { table: "signup_requests", method: "insert", payload: expect.objectContaining({ email: "saved@example.com" }) },
    ]));
  });
});
