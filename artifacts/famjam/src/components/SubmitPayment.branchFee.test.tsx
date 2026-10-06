import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SubmitPayment, type PayableBranchFee } from "./SubmitPayment";

const h = vi.hoisted(() => ({ mutate: vi.fn() }));
vi.mock("@workspace/api-client-react", async (orig) => ({
  ...(await orig<object>()),
  useCreatePaymentSubmission: () => ({ mutate: h.mutate, isPending: false }),
  useCreateContributionPaymentSubmission: () => ({ mutate: vi.fn(), isPending: false }),
  getReunionPaymentRecipient: vi.fn(),
}));

const FEE: PayableBranchFee = { registrationId: 4, branchId: 11, branchName: "Lacey", label: "Sibling Fee", remainingCents: 2000 };
const renderPay = (registrations: { id: number; label: string; amount: number }[]) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SubmitPayment reunionId={7} registrations={registrations} branchFees={[FEE]} cashAppAvailable={false} checkPayee="Lacey Family" />
    </QueryClientProvider>,
  );

beforeEach(() => h.mutate.mockReset());
afterEach(cleanup);

describe("branch special fee in Submit a Payment", () => {
  it("is opt-in: unchecked by default, labelled once per branch, and not added to the amount", () => {
    renderPay([{ id: 4, label: "Lacey (2 attendees)", amount: 80 }]);
    const box = screen.getByRole("checkbox", { name: /Sibling Fee for the Lacey branch/ });
    expect(box).not.toBeChecked();
    expect(screen.getByText(/Once per branch, shared by everyone in Lacey/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Check/ }));
    expect((screen.getByLabelText("Amount ($)") as HTMLInputElement).value).toBe("80.00");
    fireEvent.click(screen.getByRole("button", { name: "Submit Payment" }));
    expect(h.mutate.mock.calls[0][0].data.branchFeeAmount).toBeUndefined();
  });

  it("mixed report: opting in adds the fee portion; installments are allowed", () => {
    renderPay([{ id: 4, label: "Lacey", amount: 80 }]);
    fireEvent.click(screen.getByRole("checkbox", { name: /Sibling Fee/ }));
    fireEvent.click(screen.getByRole("button", { name: /Check/ }));
    expect((screen.getByLabelText("Amount ($)") as HTMLInputElement).value).toBe("100.00");
    fireEvent.change(screen.getByLabelText(/Paying now/), { target: { value: "7.50" } });
    expect((screen.getByLabelText("Amount ($)") as HTMLInputElement).value).toBe("87.50");
    fireEvent.click(screen.getByRole("button", { name: "Submit Payment" }));
    expect(h.mutate.mock.calls[0][0]).toMatchObject({ id: 4, data: { amount: 87.5, registrationIds: [4], branchFeeAmount: 7.5 } });
  });

  it("fee-only when the registration is already settled; can't exceed what's left", () => {
    renderPay([]);
    fireEvent.click(screen.getByRole("checkbox", { name: /Sibling Fee/ }));
    fireEvent.click(screen.getByRole("button", { name: /Check/ }));
    fireEvent.change(screen.getByLabelText(/Paying now/), { target: { value: "25" } });
    expect(screen.getByText(/Only \$20\.00 is left/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Paying now/), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Payment" }));
    expect(h.mutate.mock.calls[0][0]).toMatchObject({ id: 4, data: { amount: 20, registrationIds: [], branchFeeAmount: 20 } });
  });
});
