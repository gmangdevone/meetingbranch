import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SubmitPayment, type PayableBranchFee } from "./SubmitPayment";

const h = vi.hoisted(() => ({ mutate: vi.fn(), feeMutate: vi.fn() }));
vi.mock("@workspace/api-client-react", async (orig) => ({
  ...(await orig<object>()),
  useCreatePaymentSubmission: () => ({ mutate: h.mutate, isPending: false }),
  useCreateContributionPaymentSubmission: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateBranchFeePaymentSubmission: () => ({ mutate: h.feeMutate, isPending: false }),
  getReunionPaymentRecipient: vi.fn(),
}));

const FEE: PayableBranchFee = { electionId: 31, branchId: 11, branchName: "Lacey", label: "Sibling Fee", amountCents: 2000 };
const renderPay = (registrations: { id: number; label: string; amount: number }[]) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SubmitPayment reunionId={7} registrations={registrations} branchFees={[FEE]} cashAppAvailable={false} checkPayee="Lacey Family" />
    </QueryClientProvider>,
  );
const amountInput = () => screen.getByLabelText("Amount ($)") as HTMLInputElement;

beforeEach(() => { h.mutate.mockReset(); h.feeMutate.mockReset(); });
afterEach(cleanup);

describe("branch special fee in Submit a Payment", () => {
  it("with attendees it's an explicit opt-in, not added to dues by default", () => {
    renderPay([{ id: 4, label: "Lacey (2 attendees)", amount: 80 }]);
    const box = screen.getByRole("checkbox", { name: /Sibling Fee for the Lacey branch/ });
    expect(box).not.toBeChecked();
    expect(screen.getByText(/once per branch, paid in full/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Check/ }));
    expect(amountInput().value).toBe("80.00");
    fireEvent.click(screen.getByRole("button", { name: "Submit Payment" }));
    expect(h.mutate.mock.calls[0][0].data.branchFeeElectionId).toBeUndefined();
  });

  it("combined: the full fee is a separate charge sent with the election id", () => {
    renderPay([{ id: 4, label: "Lacey", amount: 80 }]);
    fireEvent.click(screen.getByRole("checkbox", { name: /Sibling Fee/ }));
    fireEvent.click(screen.getByRole("button", { name: /Check/ }));
    expect(amountInput().value).toBe("100.00");
    expect(screen.queryByLabelText(/Paying now/)).toBeNull(); // no partial fee
    fireEvent.click(screen.getByRole("button", { name: "Submit Payment" }));
    expect(h.mutate.mock.calls[0][0]).toMatchObject({ id: 4, data: { amount: 100, registrationIds: [4], branchFeeElectionId: 31 } });
    expect(h.feeMutate).not.toHaveBeenCalled();
  });

  it("standalone: no attendees, fee pre-selected, reported on its own for the full amount", () => {
    renderPay([]);
    expect(screen.getByRole("checkbox", { name: /Sibling Fee/ })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: /Check/ }));
    expect(amountInput().value).toBe("20.00");
    fireEvent.change(amountInput(), { target: { value: "12" } });
    expect(screen.getByText(/paid in full: the amount must be \$20\.00/)).toBeInTheDocument();
    fireEvent.change(amountInput(), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Payment" }));
    expect(h.feeMutate.mock.calls[0][0]).toMatchObject({ electionId: 31, data: { method: "check" } });
    expect(h.mutate).not.toHaveBeenCalled();
  });
});
