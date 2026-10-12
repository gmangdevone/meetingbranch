import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReunionAnnouncements } from "./ReunionAnnouncements";

vi.mock("wouter", () => ({ useLocation: () => ["/", vi.fn()] }));
vi.mock("@workspace/api-client-react", () => ({
  getGetReunionByCodeQueryKey: () => ["reunion"],
  getListReunionAnnouncementsQueryKey: () => ["announcements"],
  useGetReunionByCode: () => ({ data: { id: 1, code: "TEST", name: "Test reunion" } }),
  useListReunionAnnouncements: () => ({
    data: [
      { id: 1, title: "First update", body: "First announcement body", createdAt: "2026-10-12T12:00:00Z", pinned: true },
      { id: 2, title: "Second update", body: "Second announcement body", createdAt: "2026-10-12T12:00:00Z", pinned: false },
    ],
  }),
}));
afterEach(cleanup);

describe("announcement content typography", () => {
  it("uses scalable content text on both card colors without fixed prose sizing", () => {
    render(<ReunionAnnouncements params={{ code: "TEST" }} />);
    for (const text of ["First announcement body", "Second announcement body"]) {
      const body = screen.getByText(text);
      expect(body.classList.contains("text-sm")).toBe(true);
      expect(body.classList.contains("prose-sm")).toBe(false);
      expect(body.classList.contains("whitespace-pre-wrap")).toBe(true);
    }
    expect(screen.getByRole("heading", { name: "First update" }).classList.contains("text-xl")).toBe(true);
  });
});
