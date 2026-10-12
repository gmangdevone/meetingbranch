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

describe("ActivityDirectory details", () => {
  it("renders description, address and safe labeled links", () => {
    render(<ActivityDirectory categories={[{ id: 1, title: "X", activities: [{ id: 1, label: "Zoo", description: "Big cats", address: "1 Main St", websiteUrl: "https://zoo.example", mapUrl: "https://maps.example/zoo" }] }]} />);
    expect(screen.getByText("Big cats")).toBeTruthy();
    expect(screen.getByText("1 Main St")).toBeTruthy();
    const site = screen.getByRole("link", { name: /website for zoo/i });
    expect(site.getAttribute("href")).toBe("https://zoo.example/");
    expect(site.getAttribute("target")).toBe("_blank");
    expect(site.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.getByRole("link", { name: /view map for zoo/i }).getAttribute("href")).toBe("https://maps.example/zoo");
  });
  it("falls back to a Google map for address-only and hides unsafe/null links", () => {
    render(<ActivityDirectory categories={[{ id: 1, title: "X", activities: [
      { id: 1, label: "Park", address: "5 Oak Ave", websiteUrl: "javascript:alert(1)", mapUrl: null },
      { id: 2, label: "Bare", description: null, address: null, websiteUrl: null, mapUrl: null },
    ] }]} />);
    expect(screen.queryByRole("link", { name: /website for park/i })).toBeNull();
    expect(screen.getByRole("link", { name: /view map for park/i }).getAttribute("href")).toContain("google.com/maps/search/?api=1&query=5%20Oak%20Ave");
    expect(screen.queryByRole("link", { name: /bare/i })).toBeNull();
  });
});
