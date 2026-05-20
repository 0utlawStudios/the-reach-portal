import { describe, it, expect } from "vitest";
import { buildSupportTicketEmailHtml, buildSupportReplyEmailHtml } from "@/lib/email-utils";

describe("buildSupportTicketEmailHtml", () => {
  it("includes the short code, body, and thread link", () => {
    const html = buildSupportTicketEmailHtml({
      shortCode: "A1B2",
      userName: "Ann",
      userEmail: "ann@example.com",
      category: "Bug",
      body: "The publish button does nothing.",
      attachments: [],
      threadUrl: "https://smm.ten80ten.com/?support=t1",
    });
    expect(html).toContain("A1B2");
    expect(html).toContain("The publish button does nothing.");
    expect(html).toContain("https://smm.ten80ten.com/?support=t1");
  });

  it("escapes HTML in user-supplied fields to prevent injection", () => {
    const html = buildSupportTicketEmailHtml({
      shortCode: "A1B2",
      userName: "<script>alert(1)</script>",
      userEmail: "x@y.com",
      category: "Bug",
      body: "<img src=x onerror=alert(1)>",
      attachments: [],
      threadUrl: "https://smm.ten80ten.com/",
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("renders an image attachment preview", () => {
    const html = buildSupportTicketEmailHtml({
      shortCode: "A1B2",
      userName: "Ann",
      userEmail: "x@y.com",
      category: "Bug",
      body: "see screenshot",
      attachments: [{ name: "shot.png", signedUrl: "https://store/shot.png", kind: "image" }],
      threadUrl: "https://smm.ten80ten.com/",
    });
    expect(html).toContain("https://store/shot.png");
  });
});

describe("buildSupportReplyEmailHtml", () => {
  it("includes the reply preview and the thread link", () => {
    const html = buildSupportReplyEmailHtml({
      userName: "Ann",
      shortCode: "A1B2",
      replyPreview: "We shipped a fix.",
      threadUrl: "https://smm.ten80ten.com/?support=t1",
    });
    expect(html).toContain("We shipped a fix.");
    expect(html).toContain("A1B2");
    expect(html).toContain("?support=t1");
  });

  it("escapes HTML in the reply preview", () => {
    const html = buildSupportReplyEmailHtml({
      userName: "Ann",
      shortCode: "A1B2",
      replyPreview: "<script>steal()</script>",
      threadUrl: "https://smm.ten80ten.com/",
    });
    expect(html).not.toContain("<script>steal()</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
