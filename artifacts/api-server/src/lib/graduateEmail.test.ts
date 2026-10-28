import { afterEach, describe, expect, it, vi } from "vitest";
import { graduateEmailHtml, sendGraduateEmail } from "./graduateEmail";
import type { GraduateSubmissionRow } from "@workspace/db";
const row = {
  id: 1, name: "<script>alert(1)</script>", email: "qa@example.com", zelle: "", cashApp: "$QA",
  answers: [{ questionId: "a", label: "<b>Question</b>", value: "<img src=x onerror=alert(1)>" }],
  links: [{ label: "Social", url: "https://example.com?a=1&b=2" }],
} as GraduateSubmissionRow;
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("Graduate Dollars email", () => {
  it("escapes all user text and includes answers, links and reference-only details", () => {
    const html = graduateEmailHtml("<Event>", row);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;Event&gt;");
    expect(html).toContain("https://example.com?a=1&amp;b=2");
    expect(html).toContain("reference only");
    expect(html).toContain("$QA");
  });
  it("fails explicitly when email credentials are missing", async () => {
    vi.stubEnv("BREVO_API_KEY", "");
    await expect(sendGraduateEmail("qa@example.com", "Event", row)).rejects.toThrow("not configured");
  });
  it("records provider acceptance separately from inbox delivery", async () => {
    vi.stubEnv("BREVO_API_KEY", "test-only");
    vi.stubEnv("BREVO_FROM_EMAIL", "test@coppergram.com");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ messageId: "message-1" }) }));
    expect(await sendGraduateEmail("qa@example.com", "Event", row)).toBe("message-1");
  });
  it("rejects provider errors without echoing sensitive response bodies", async () => {
    vi.stubEnv("BREVO_API_KEY", "test-only");
    vi.stubEnv("BREVO_FROM_EMAIL", "test@coppergram.com");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    await expect(sendGraduateEmail("qa@example.com", "Event", row)).rejects.toThrow("did not accept");
  });
});
