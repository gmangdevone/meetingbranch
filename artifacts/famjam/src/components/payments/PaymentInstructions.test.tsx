import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PaymentRecipientPublic } from "@workspace/api-client-react";
import { PaymentInstructions } from "./PaymentInstructions";

const recipient = {
  reunionId: 1, status: "approved", cashAppTag: "Family",
  cashAppUrl: "https://cash.app/$Family", paymentHandle: null, paymentUrl: null,
  zelleRecipientName: "Family Treasurer", zelleContact: "family@example.com",
} as PaymentRecipientPublic;

describe("visible payment instructions", () => {
  it("shows approved destinations without an extra click", () => {
    render(<PaymentInstructions recipient={recipient} checkPayee="Family Reunion" />);
    expect(screen.getByText("$Family")).toBeInTheDocument();
    expect(screen.getByText("family@example.com")).toBeInTheDocument();
    expect(screen.getByText("Family Reunion")).toBeInTheDocument();
    expect(screen.queryByText("View Payment Instructions")).not.toBeInTheDocument();
  });
  it("does not reveal disabled destinations", () => {
    render(<PaymentInstructions recipient={{ ...recipient, status: "disabled" }} />);
    expect(screen.queryByText("$Family")).not.toBeInTheDocument();
    expect(screen.queryByText("family@example.com")).not.toBeInTheDocument();
    expect(screen.getByText(/not available yet/)).toBeInTheDocument();
  });
});