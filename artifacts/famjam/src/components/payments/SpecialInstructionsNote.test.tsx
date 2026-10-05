import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PaymentRecipientPublic } from "@workspace/api-client-react";
import { SpecialInstructionsNote, approvedInstructions } from "./SpecialInstructionsNote";
import { PaymentInstructions } from "./PaymentInstructions";
import { RecipientStatusCard } from "./RecipientStatusCard";

vi.mock("@workspace/api-client-react", () => ({}));
afterEach(cleanup);

const NOTE = "Cash at check-in.\nQuestions: call (312) 555-0147\n<img src=x onerror=alert(1)><b>bold</b>";
const base = {
  reunionId: 1, status: "approved", cashAppTag: "Family", cashAppUrl: "https://cash.app/$Family",
  paymentHandle: null, paymentUrl: null, zelleRecipientName: null, zelleContact: null,
  paymentInstructions: NOTE, approvedAt: null,
} as PaymentRecipientPublic;

describe("special payment instructions", () => {
  it("renders text literally with line breaks and never as HTML", () => {
    const { container } = render(<SpecialInstructionsNote text={NOTE} />);
    const p = screen.getByText(/Cash at check-in/);
    expect(p.textContent).toBe(NOTE);
    expect(p.className).toContain("whitespace-pre-wrap");
    expect(container.querySelector("img, b")).toBeNull();
  });
  it("only approved recipients expose instructions", () => {
    expect(approvedInstructions(base)).toBe(NOTE);
    expect(approvedInstructions({ ...base, status: "disabled" })).toBeNull();
    expect(approvedInstructions({ ...base, status: "pending_review" })).toBeNull();
    expect(approvedInstructions({ ...base, paymentInstructions: "   " })).toBeNull();
    expect(approvedInstructions(null)).toBeNull();
  });
  it("PaymentInstructions shows the note alongside destinations, and hides it when disabled", () => {
    render(<PaymentInstructions recipient={base} />);
    expect(screen.getByTestId("special-payment-instructions")).toHaveTextContent("Questions: call (312) 555-0147");
    expect(screen.getByText(/\$Family/)).toBeInTheDocument();
    cleanup();
    render(<PaymentInstructions recipient={{ ...base, status: "disabled" }} />);
    expect(screen.queryByTestId("special-payment-instructions")).toBeNull();
  });
  it("PaymentInstructions supports an instructions-only approval", () => {
    render(<PaymentInstructions recipient={{ ...base, cashAppTag: null, cashAppUrl: null, paymentInstructions: "Pay cash at check-in" }} />);
    expect(screen.getByTestId("special-payment-instructions")).toHaveTextContent("Pay cash at check-in");
    expect(screen.queryByText(/not available yet/)).toBeNull();
  });
  it("organizer read-only card shows the note as plain text", () => {
    const { container } = render(<RecipientStatusCard recipient={base} />);
    expect(screen.getByText(/shown to payers/)).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });
});
