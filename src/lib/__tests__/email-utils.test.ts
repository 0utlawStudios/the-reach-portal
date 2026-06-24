// Security tests for the email-utils sanitizers. These functions sit between
// user-derived input (post titles, comments, requester names, recipient lists)
// and outbound email: HTML bodies + nodemailer header fields. A regression in
// any of them is a stored-XSS or header-injection vector.
//
//   esc()            — HTML-entity escaping for interpolation into email HTML.
//   safeSubject()    — strips CR/LF from Subject lines (header injection).
//   isValidEmail()   — strict single-address validator.
//   safeRecipients() — dedupes + drops invalid entries from a recipient list.

import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";

const createTransport = vi.hoisted(() => vi.fn());

vi.mock("nodemailer", () => ({
  default: { createTransport },
}));

import {
  DEFAULT_SMTP_CONNECTION_TIMEOUT_MS,
  DEFAULT_SMTP_DNS_TIMEOUT_MS,
  DEFAULT_SMTP_GREETING_TIMEOUT_MS,
  DEFAULT_SMTP_SOCKET_TIMEOUT_MS,
  esc,
  getTransporter,
  safeSubject,
  isValidEmail,
  safeRecipients,
} from "../email-utils";

const originalEnv = { ...process.env };

beforeEach(() => {
  createTransport.mockReset();
  process.env.SMTP_USER = "smtp@example.com";
  process.env.SMTP_PASS = "smtp-pass";
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_PORT;
  delete process.env.SMTP_CONNECTION_TIMEOUT_MS;
  delete process.env.SMTP_DNS_TIMEOUT_MS;
  delete process.env.SMTP_GREETING_TIMEOUT_MS;
  delete process.env.SMTP_SOCKET_TIMEOUT_MS;
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("getTransporter — bounded SMTP network waits", () => {
  it("sets explicit SMTP timeouts so dead mail servers cannot hang notification routes", () => {
    getTransporter();

    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({
      connectionTimeout: DEFAULT_SMTP_CONNECTION_TIMEOUT_MS,
      dnsTimeout: DEFAULT_SMTP_DNS_TIMEOUT_MS,
      greetingTimeout: DEFAULT_SMTP_GREETING_TIMEOUT_MS,
      socketTimeout: DEFAULT_SMTP_SOCKET_TIMEOUT_MS,
    }));
  });

  it("allows production SMTP timeout overrides while ignoring invalid values", () => {
    process.env.SMTP_CONNECTION_TIMEOUT_MS = "12000";
    process.env.SMTP_DNS_TIMEOUT_MS = "14000";
    process.env.SMTP_GREETING_TIMEOUT_MS = "13000";
    process.env.SMTP_SOCKET_TIMEOUT_MS = "not-a-number";

    getTransporter();

    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({
      connectionTimeout: 12_000,
      dnsTimeout: 14_000,
      greetingTimeout: 13_000,
      socketTimeout: DEFAULT_SMTP_SOCKET_TIMEOUT_MS,
    }));
  });
});

describe("esc — HTML entity escaping", () => {
  it("escapes all five dangerous characters: & < > \" '", () => {
    expect(esc("&")).toBe("&amp;");
    expect(esc("<")).toBe("&lt;");
    expect(esc(">")).toBe("&gt;");
    expect(esc('"')).toBe("&quot;");
    expect(esc("'")).toBe("&#39;");
  });

  it("neutralizes a script-tag XSS payload", () => {
    const out = esc('<script>alert("xss")</script>');
    expect(out).not.toContain("<script>");
    expect(out).not.toContain("</script>");
    expect(out).toContain("&lt;script&gt;");
  });

  it("escapes ampersand BEFORE other entities (no double-escaping artifacts)", () => {
    // If `&` were escaped last, `<` → `&lt;` would then become `&amp;lt;`.
    expect(esc("<")).toBe("&lt;");
    expect(esc("a & b < c")).toBe("a &amp; b &lt; c");
  });

  it("returns an empty string for null and undefined", () => {
    expect(esc(null)).toBe("");
    expect(esc(undefined)).toBe("");
  });

  it("stringifies non-string input", () => {
    expect(esc(42)).toBe("42");
    expect(esc(true)).toBe("true");
  });

  it("leaves a benign string untouched", () => {
    expect(esc("Hello world")).toBe("Hello world");
  });
});

describe("safeSubject — strips CR/LF and truncates", () => {
  it("removes CR and LF (email header-injection defense)", () => {
    const out = safeSubject("Subject\r\nBcc: attacker@evil.com");
    expect(out).not.toContain("\r");
    expect(out).not.toContain("\n");
  });

  it("collapses a CRLF run into a single space", () => {
    expect(safeSubject("line one\r\n\r\nline two")).toBe("line one line two");
  });

  it("trims surrounding whitespace", () => {
    expect(safeSubject("   padded subject   ")).toBe("padded subject");
  });

  it("truncates to 200 characters", () => {
    const out = safeSubject("x".repeat(500));
    expect(out.length).toBe(200);
  });

  it("returns an empty string for null and undefined", () => {
    expect(safeSubject(null)).toBe("");
    expect(safeSubject(undefined)).toBe("");
  });

  it("leaves a normal subject untouched", () => {
    expect(safeSubject("Jane mentioned you in a post")).toBe(
      "Jane mentioned you in a post",
    );
  });
});

describe("isValidEmail — strict single-address validation", () => {
  it("accepts a normal address", () => {
    expect(isValidEmail("jane.cruz@example.com")).toBe(true);
  });

  it("rejects an empty string", () => {
    expect(isValidEmail("")).toBe(false);
  });

  it("rejects a whitespace-only string", () => {
    expect(isValidEmail("   ")).toBe(false);
  });

  it("rejects a non-string value", () => {
    expect(isValidEmail(null)).toBe(false);
    expect(isValidEmail(undefined)).toBe(false);
    expect(isValidEmail(12345)).toBe(false);
  });

  it("rejects an over-long address (> 320 chars)", () => {
    const longLocal = "a".repeat(320);
    expect(isValidEmail(`${longLocal}@example.com`)).toBe(false);
  });

  it("rejects an address containing a comma (recipient-list smuggling)", () => {
    expect(isValidEmail("a@b.com,c@d.com")).toBe(false);
  });

  it("rejects an address containing CR or LF (header injection)", () => {
    expect(isValidEmail("a@b.com\r\nBcc: evil@x.com")).toBe(false);
    expect(isValidEmail("a@b.com\nevil@x.com")).toBe(false);
  });

  it("rejects an address containing angle brackets", () => {
    expect(isValidEmail("<a@b.com>")).toBe(false);
    expect(isValidEmail("a@b.com>")).toBe(false);
  });

  it("rejects an address with a space", () => {
    expect(isValidEmail("a b@c.com")).toBe(false);
  });

  it("rejects an address with no @ or no domain dot", () => {
    expect(isValidEmail("not-an-email")).toBe(false);
    expect(isValidEmail("missing@domain")).toBe(false);
  });
});

describe("safeRecipients — dedupe + drop invalid", () => {
  it("dedupes case-insensitively and lowercases the output", () => {
    const out = safeRecipients(["Jane@Example.com", "jane@example.com"]);
    expect(out).toEqual(["jane@example.com"]);
  });

  it("drops invalid entries while keeping valid ones", () => {
    const out = safeRecipients([
      "valid@example.com",
      "",
      "bad,injection@x.com",
      "with\r\nnewline@x.com",
      "good@example.com",
    ]);
    expect(out).toEqual(["valid@example.com", "good@example.com"]);
  });

  it("returns an empty array when every entry is invalid", () => {
    expect(safeRecipients(["", "nope", null, "<x@y.com>"])).toEqual([]);
  });

  it("returns an empty array for an empty input list", () => {
    expect(safeRecipients([])).toEqual([]);
  });

  it("trims surrounding whitespace before dedupe comparison", () => {
    const out = safeRecipients(["  jane@example.com  ", "jane@example.com"]);
    expect(out).toEqual(["jane@example.com"]);
  });
});
