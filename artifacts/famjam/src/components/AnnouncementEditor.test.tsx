import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AnnouncementEditor } from "./AnnouncementEditor";
import { AnnouncementBody } from "./AnnouncementBody";
import { announcementLinks, encodeAnnouncementLink, safeAnnouncementUrl } from "../lib/announcementLinks";

afterEach(cleanup);
function Editor({ initial = "Book here today." }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return <AnnouncementEditor value={value} onChange={setValue} disabled={false} />;
}
describe("announcement links", () => {
  it("inserts over a selection, previews, edits, removes, and preserves surrounding words", () => {
    render(<Editor />);
    const message = screen.getByLabelText("Message") as HTMLTextAreaElement;
    message.setSelectionRange(5, 9);
    fireEvent.click(screen.getByText("Insert Link"));
    expect((screen.getByLabelText("Display text") as HTMLInputElement).value).toBe("here");
    fireEvent.change(screen.getByLabelText("Destination URL"), { target: { value: "https://example.com/hotel" } });
    fireEvent.click(screen.getByText("Apply Link"));
    expect(message.value).toBe("Book [here](https://example.com/hotel) today.");
    expect(screen.getByRole("link", { name: "here" }).getAttribute("href")).toBe("https://example.com/hotel");
    fireEvent.click(screen.getByRole("button", { name: "Edit link here" }));
    fireEvent.change(screen.getByLabelText("Display text"), { target: { value: "hotel details" } });
    fireEvent.click(screen.getByText("Apply Link"));
    fireEvent.click(screen.getByRole("button", { name: "Remove link hotel details" }));
    expect(message.value).toBe("Book hotel details today.");
  });
  it("supports cursor insertion and rejects unsafe links inline", () => {
    render(<Editor initial="Go: " />);
    const message = screen.getByLabelText("Message") as HTMLTextAreaElement;
    message.setSelectionRange(4, 4);
    fireEvent.click(screen.getByText("Insert Link"));
    fireEvent.change(screen.getByLabelText("Display text"), { target: { value: "Hotel" } });
    fireEvent.change(screen.getByLabelText("Destination URL"), { target: { value: "javascript:alert(1)" } });
    fireEvent.click(screen.getByText("Apply Link"));
    expect(screen.getByRole("alert").textContent).toContain("https://");
    expect(message.value).toBe("Go: ");
    fireEvent.change(screen.getByLabelText("Destination URL"), { target: { value: "https://example.com/a(b)" } });
    fireEvent.click(screen.getByText("Apply Link"));
    expect(screen.getByRole("link").getAttribute("href")).toBe("https://example.com/a%28b%29");
  });
  it("renders persisted bodies with multiple links, safe attributes, and literal HTML", () => {
    const body = `Hello\n${encodeAnnouncementLink("Hotel [rooms]", "https://example.com")}\n${encodeAnnouncementLink("Map", "https://example.com/map")}\n<img src=x onerror=alert(1)>`;
    const { container, unmount } = render(<AnnouncementBody body={body} />);
    expect(screen.getAllByRole("link")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Hotel [rooms]" }).getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.getByRole("link", { name: "Map" }).getAttribute("target")).toBe("_blank");
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("Hello\n");
    unmount();
    render(<Editor initial={body} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit link Map" }));
    expect((screen.getByLabelText("Destination URL") as HTMLInputElement).value).toBe("https://example.com/map");
  });
  it("leaves legacy text and unsafe stored markup inert", () => {
    const text = "Line one\nhttps://example.com\n[bad](javascript:evil)\n<b>Not HTML</b>";
    const { container } = render(<AnnouncementBody body={text} />);
    expect(container.textContent).toBe(text);
    expect(screen.queryByRole("link")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(announcementLinks(encodeAnnouncementLink("a\\b [c]", "https://example.com"))[0].label).toBe("a\\b [c]");
  });
  it.each(["javascript:alert(1)", "data:text/html,hi", "//example.com", "https://user:pass@example.com", "https://", "https://exa mple.com"])("rejects %s", url => {
    expect(safeAnnouncementUrl(url)).toBeNull();
  });
});
