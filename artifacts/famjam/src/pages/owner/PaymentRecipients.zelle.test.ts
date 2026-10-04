import { describe, expect, it, vi } from "vitest";
vi.mock("@workspace/api-client-react", () => ({}));
const { previewZelleContact } = await import("./PaymentRecipients");

describe("owner Zelle contact preview mirrors server rules", () => {
  it.each([
    ["Treasurer@Example.org", "treasurer@example.org"],
    ["312-555-0147", "(312) 555-0147"],
    ["+1 312 555 0147", "(312) 555-0147"],
  ])("accepts %s", (i, o) => expect(previewZelleContact(i)).toBe(o));
  it.each(["", "555-0147", "+44 20 7946 0958", "a@b", "012-555-0147", "a..b@example.org"])("rejects %j", (i) =>
    expect(previewZelleContact(i)).toBeNull(),
  );
});
