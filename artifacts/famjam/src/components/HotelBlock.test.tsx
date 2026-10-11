import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HotelBlock } from "./HotelBlock";
import { PlainText } from "./PlainText";

afterEach(cleanup);

describe("HotelBlock", () => {
  it("renders exact label with safe external link and no image placeholder", () => {
    render(<HotelBlock content={{ hotelEnabled: true, hotelDescription: "Group rate", hotelBookingUrl: "https://hotel.example/b" }} />);
    const link = screen.getByRole("link", { name: /Click here to book your hotel room/ });
    expect(link.getAttribute("href")).toBe("https://hotel.example/b");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(screen.queryByTestId("img-hotel")).toBeNull();
  });
  it("renders nothing for unsafe url or disabled", () => {
    const { container } = render(<HotelBlock content={{ hotelEnabled: true, hotelDescription: "x", hotelBookingUrl: "javascript:alert(1)" }} />);
    expect(container.innerHTML).toBe("");
  });
  it("renders text as plain text, not HTML", () => {
    const { container } = render(<PlainText text={"<b>hi</b>\nthere"} />);
    expect(container.querySelector("b")).toBeNull();
    expect(container.textContent).toContain("<b>hi</b>");
    expect(container.querySelector("br")).not.toBeNull();
  });
});
