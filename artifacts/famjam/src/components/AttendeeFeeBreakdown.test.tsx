import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ReunionFee } from "@workspace/api-client-react";
import { AttendeeFeeBreakdown } from "./AttendeeFeeBreakdown";

afterEach(cleanup);
const fee = (id: number, overrides: Partial<ReunionFee> = {}) => ({
  id, label: "Admission", amount: 50, chargeType: "per_person", isOptional: false,
  ageTiers: [], ...overrides,
}) as ReunionFee;
const fees = [
  fee(1, { ageTiers: [{ minAge: 0, maxAge: 12, amount: 20 }] }),
  fee(2, { label: "Dinner", amount: 15, isDinner: true, dinnerMode: "optional", isOptional: true }),
  fee(3, { label: "Shirt", amount: 10, isShirt: true, isOptional: true }),
  fee(4, { label: "Household fee", chargeType: "flat", amount: 100 }),
];
describe("attendee fee breakdown", () => {
  it("uses age pricing and selected add-ons without assigning flat fees", () => {
    render(<AttendeeFeeBreakdown fees={fees} attendee={{ age: 10, includeDinner: true, dinnerFeeIds: [2], includeShirt: true }} selectedFeeIds={[2, 3]} />);
    expect(screen.getByText("$45.00")).toBeInTheDocument();
    expect(screen.getByText("$20.00")).toBeInTheDocument();
    expect(screen.queryByText("Household fee")).not.toBeInTheDocument();
  });
  it("updates when an attendee age or add-on choice changes", () => {
    const props = { fees, selectedFeeIds: [2, 3] };
    const { rerender } = render(<AttendeeFeeBreakdown {...props} attendee={{ age: 30, includeDinner: true, dinnerFeeIds: [2], includeShirt: true }} />);
    expect(screen.getByText("$75.00")).toBeInTheDocument();
    rerender(<AttendeeFeeBreakdown {...props} attendee={{ age: 10, includeDinner: false, includeShirt: false }} />);
    expect(screen.queryByText("$75.00")).not.toBeInTheDocument();
    expect(screen.getAllByText("$20.00")).toHaveLength(2);
  });
  it("does not include unselected optional fees", () => {
    render(<AttendeeFeeBreakdown fees={fees} attendee={{ age: 20 }} selectedFeeIds={[]} />);
    expect(screen.queryByText("Dinner")).not.toBeInTheDocument();
    expect(screen.queryByText("Shirt")).not.toBeInTheDocument();
    expect(screen.getAllByText("$50.00")).toHaveLength(2);
  });
  it("avoids misleading totals for incomplete attendees", () => {
    render(<AttendeeFeeBreakdown fees={fees} attendee={{ age: null }} selectedFeeIds={[]} ready={false} />);
    expect(screen.queryByText("Attendee total")).not.toBeInTheDocument();
    expect(screen.getByText(/valid age/)).toBeInTheDocument();
  });
});
