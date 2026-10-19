import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MemberChecklist } from "@workspace/api-client-react";
import { ChecklistHeroButton, ChecklistPanel } from "./MemberChecklist";
import { checklistButtonLabel, draftToItems, safeChecklistLink } from "../../lib/checklist";

vi.mock("@clerk/react", () => ({ useUser: () => ({ isSignedIn: true, user: { id: "u1" } }) }));
afterEach(cleanup);

const data: MemberChecklist = {
  enabled: true, completedCount: 1, totalCount: 2,
  items: [
    { id: 1, title: "Register attendees", kind: "registration", visible: true, sortOrder: 0, completed: true, statusText: "Registered" },
    { id: 2, title: "Book hotel", kind: "manual", visible: true, sortOrder: 1, completed: false, link: "javascript:alert(1)", description: "Group rate" },
    { id: 3, title: "Hidden", kind: "manual", visible: false, sortOrder: 2 },
  ],
};
const noop = () => {};

describe("checklist helpers", () => {
  it("labels progress", () => {
    expect(checklistButtonLabel(1, 3)).toBe("My Checklist · 1 of 3 complete");
    expect(checklistButtonLabel(3, 3)).toBe("My Checklist · All complete");
  });
  it("only allows http(s) links", () => {
    expect(safeChecklistLink("https://x.example/a")).toBe("https://x.example/a");
    expect(safeChecklistLink("javascript:alert(1)")).toBeNull();
    expect(safeChecklistLink("x.example")).toBeNull();
  });
  it("keeps saved ids and omits ids for new items", () => {
    const items = draftToItems([
      { key: "a", id: 7, title: " Renamed ", description: "", link: "", kind: "manual", visible: true },
      { key: "b", title: "New", description: "d", link: "", kind: "payment", visible: false },
    ]);
    expect(items[0]).toMatchObject({ id: 7, title: "Renamed", description: null, sortOrder: 0 });
    expect("id" in items[1]).toBe(false);
    expect(items[1].sortOrder).toBe(1);
  });
});

describe("ChecklistHeroButton", () => {
  it("shows visible-item progress", () => {
    render(<ChecklistHeroButton data={data} isError={false} isRefetching={false} open={false} onToggle={noop} onRetry={noop} />);
    expect(screen.getByTestId("button-my-checklist").textContent).toContain("My Checklist · 1 of 2 complete");
  });
  it("renders nothing when disabled or empty", () => {
    const { container } = render(<ChecklistHeroButton data={{ ...data, enabled: false }} isError={false} isRefetching={false} open={false} onToggle={noop} onRetry={noop} />);
    expect(container.innerHTML).toBe("");
  });
  it("shows retry on read failure", () => {
    const onRetry = vi.fn();
    render(<ChecklistHeroButton data={undefined} isError isRefetching={false} open={false} onToggle={noop} onRetry={onRetry} />);
    fireEvent.click(screen.getByTestId("button-checklist-retry"));
    expect(onRetry).toHaveBeenCalled();
  });
});

describe("ChecklistPanel", () => {
  it("renders automatic status without toggle, manual toggle, no unsafe link", () => {
    const onToggle = vi.fn();
    render(<ChecklistPanel data={data} isError={false} pendingItemId={null} itemErrors={{ 2: "Could not save." }} onToggleItem={onToggle} onClose={noop} />);
    expect(screen.getByText("Your current checklist")).toBeTruthy();
    expect(screen.getByTestId("status-checklist-auto-1").textContent).toBe("Registered");
    expect(screen.queryByTestId("checkbox-checklist-item-1")).toBeNull();
    expect(screen.queryByTestId("link-checklist-item-2")).toBeNull();
    expect(screen.queryByText("Hidden")).toBeNull();
    expect(screen.getByText("Could not save.")).toBeTruthy();
    fireEvent.click(screen.getByTestId("checkbox-checklist-item-2"));
    expect(onToggle).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }), true);
  });
});
