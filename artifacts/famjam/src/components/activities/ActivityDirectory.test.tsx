import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ActivityDirectory } from "./ActivityDirectory";

afterEach(cleanup);

const categories = [
  { id: 1, title: "Outdoors", description: "Fresh air", activities: [{ id: 10, label: "River trail" }, { id: 11, label: "Botanical garden" }] },
  { id: 2, title: "Food", activities: [{ id: 20, label: "Night market" }] },
];

describe("ActivityDirectory", () => {
  it("lists categories and activities as a read-only directory", () => {
    render(<ActivityDirectory categories={categories} />);
    expect(screen.getAllByTestId("activity-category")).toHaveLength(2);
    expect(screen.getByText("Outdoors")).toBeTruthy();
    expect(screen.getByText("Fresh air")).toBeTruthy();
    expect(screen.getByText("Night market")).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });
  it("renders no voting, selection, or results controls", () => {
    const { container } = render(<ActivityDirectory categories={categories} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(container.textContent).not.toMatch(/%|vote|pick up to|selections|results/i);
  });
  it("shows a composed empty state", () => {
    render(<ActivityDirectory categories={[]} />);
    expect(screen.getByTestId("activities-empty")).toBeTruthy();
  });
});
