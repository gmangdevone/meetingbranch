import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PollOptionDetails, PollOptionFields } from "./PollOptionFields";
import { draftToInput, emptyOptionDraft, validateLinkUrl, validateOptionDraft, visibleDetails, type PollOptionDraft } from "../../lib/pollOptions";

afterEach(cleanup);

describe("poll option validation", () => {
  it("accepts http(s) and rejects other schemes or credentials", () => {
    expect(validateLinkUrl("https://example.com/a")).toBeNull();
    expect(validateLinkUrl("http://example.com")).toBeNull();
    expect(validateLinkUrl("")).toBeNull();
    expect(validateLinkUrl("javascript:alert(1)")).not.toBeNull();
    expect(validateLinkUrl("ftp://example.com")).not.toBeNull();
    expect(validateLinkUrl("https://user:pw@example.com")).not.toBeNull();
    expect(validateLinkUrl("example.com")).not.toBeNull();
  });
  it("requires one meaningful field only when enabled", () => {
    const base = { ...emptyOptionDraft(), label: "Park" };
    expect(validateOptionDraft(base)).toEqual({});
    expect(validateOptionDraft({ ...base, detailsEnabled: true, description: "  " }).details).toBeTruthy();
    expect(validateOptionDraft({ ...base, detailsEnabled: true, description: "Shade" })).toEqual({});
    expect(validateOptionDraft({ ...base, detailsEnabled: true, linkUrl: "https://x.org" })).toEqual({});
    expect(validateOptionDraft({ ...base, detailsEnabled: true, linkUrl: "data:text/html,x" }).linkUrl).toBeTruthy();
  });
  it("preserves text when disabled and nulls blanks", () => {
    expect(draftToInput({ label: " A ", detailsEnabled: false, description: "kept", linkUrl: " " })).toEqual({
      label: "A", detailsEnabled: false, description: "kept", linkUrl: null,
    });
    expect(visibleDetails({ detailsEnabled: false, description: "kept", linkUrl: null })).toBeNull();
  });
});

function Harness() {
  const [v, setV] = useState<PollOptionDraft>({ label: "Lake", detailsEnabled: false, description: "", linkUrl: "" });
  return <PollOptionFields labelText="Option 1" value={v} onChange={setV} />;
}

describe("PollOptionFields", () => {
  it("defaults off and keeps text when toggled off and on", () => {
    render(<Harness />);
    expect(screen.queryByLabelText(/Description/)).toBeNull();
    const toggle = screen.getByRole("switch");
    fireEvent.click(toggle);
    fireEvent.change(screen.getByLabelText(/Description/), { target: { value: "Bring chairs" } });
    fireEvent.click(toggle);
    expect(screen.queryByLabelText(/Description/)).toBeNull();
    fireEvent.click(toggle);
    expect((screen.getByLabelText(/Description/) as HTMLTextAreaElement).value).toBe("Bring chairs");
  });
});

describe("PollOptionDetails", () => {
  it("renders a safe link outside the vote button that does not trigger voting", () => {
    const onVote = vi.fn();
    render(
      <div onClick={onVote}>
        <button type="button">Lake</button>
        <PollOptionDetails option={{ label: "Lake", detailsEnabled: true, description: "Line one\nLine two", linkUrl: "https://lake.example/info" }} />
      </div>,
    );
    const link = screen.getByRole("link");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.closest("button")).toBeNull();
    fireEvent.click(link);
    expect(onVote).not.toHaveBeenCalled();
    expect(document.querySelector("br")).not.toBeNull();
  });
  it("hides unsafe links and disabled details", () => {
    const { container, rerender } = render(<PollOptionDetails option={{ label: "x", detailsEnabled: true, linkUrl: "javascript:alert(1)" }} />);
    expect(container.innerHTML).toBe("");
    rerender(<PollOptionDetails option={{ label: "x", detailsEnabled: false, description: "hi" }} />);
    expect(container.innerHTML).toBe("");
  });
});
