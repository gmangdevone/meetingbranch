import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AdminRegistration } from "@workspace/api-client-react";
import { CustomizeViewDialog } from "./CustomizeViewDialog";
import { RegistrationTable, type RegistrationActions } from "./RegistrationTable";
import { DEFAULT_FIELDS, PRESETS, matchPreset, normalizeFields } from "../../lib/registrationView";

afterEach(() => vi.unstubAllGlobals());

describe("registration view model", () => {
  it("has the exact default and presets", () => {
    expect(DEFAULT_FIELDS).toEqual(["date", "balance", "payment"]);
    expect(PRESETS.checkin.fields).toEqual(["checkin", "payment"]);
    expect(PRESETS.payments.fields).toEqual(["balance", "payment", "edit"]);
  });
  it("normalizes unsupported ids and duplicates", () => {
    expect(normalizeFields(["payment", "bogus", "date", "payment"])).toEqual(["date", "payment"]);
    expect(matchPreset(["payment", "checkin"])).toBe("checkin");
    expect(matchPreset(["branch"])).toBeNull();
  });
});

const KEY = ["/api/me/registration-view", "user_a"];
function renderDialog(current = DEFAULT_FIELDS) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(KEY, { fields: current, resetInvalid: false });
  const onSaved = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <CustomizeViewDialog open onOpenChange={onOpenChange} current={[...current]} queryKey={KEY} onSaved={onSaved} />
    </QueryClientProvider>,
  );
  return { client, onSaved, onOpenChange };
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("CustomizeViewDialog", () => {
  it("applies presets, custom toggles and reset", () => {
    renderDialog();
    expect(screen.getByTestId("text-preset-state")).toHaveTextContent("Default");
    fireEvent.click(screen.getByTestId("button-preset-checkin"));
    expect(screen.getByTestId("checkbox-field-checkin")).toHaveAttribute("data-state", "checked");
    expect(screen.getByTestId("checkbox-field-date")).toHaveAttribute("data-state", "unchecked");
    fireEvent.click(screen.getByTestId("checkbox-field-branch"));
    expect(screen.getByTestId("text-preset-state")).toHaveTextContent("Custom");
    fireEvent.click(screen.getByTestId("button-reset-view"));
    expect(screen.getByTestId("text-preset-state")).toHaveTextContent("Default");
  });

  it("saves to the user-scoped cache on success", async () => {
    const fetchMock = vi.fn(async () => json({ fields: ["balance", "payment", "edit"], resetInvalid: false }));
    vi.stubGlobal("fetch", fetchMock);
    const { client, onSaved } = renderDialog();
    fireEvent.click(screen.getByTestId("button-preset-payments"));
    fireEvent.click(screen.getByTestId("button-save-view"));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body).toEqual({ fields: ["balance", "payment", "edit"] });
    expect(client.getQueryData(KEY)).toEqual({ fields: ["balance", "payment", "edit"], resetInvalid: false });
  });

  it("does not present a failed save as persisted", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "Server unavailable" }, 500)));
    const { client, onSaved, onOpenChange } = renderDialog();
    fireEvent.click(screen.getByTestId("button-preset-checkin"));
    fireEvent.click(screen.getByTestId("button-save-view"));
    expect(await screen.findByTestId("text-save-error")).toHaveTextContent("not saved");
    expect(onSaved).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(client.getQueryData(KEY)).toEqual({ fields: DEFAULT_FIELDS, resetInvalid: false });
  });
});

function reg(id: number, name: string, status: "active" | "cancelled" = "active"): AdminRegistration {
  return {
    id, userName: name, userEmail: `${name.toLowerCase()}@x.org`, branchName: "Oak", status, attendeeCount: 1,
    attendees: [{ id: id * 10, name, addOns: [] }], selectedFeeIds: [], addOns: [], createdAt: "2025-03-02T00:00:00Z",
    paymentStatus: "pending", registrantIsManaged: false,
  } as unknown as AdminRegistration;
}
function actions(): RegistrationActions {
  return {
    onCheckIn: vi.fn(), onPayments: vi.fn(), onSubmissions: vi.fn(), onEdit: vi.fn(),
    onTransfer: vi.fn(), onCancel: vi.fn(), onDetails: vi.fn(),
  };
}
function headers() {
  return screen.getAllByRole("columnheader").map((h) => h.textContent);
}
function openMenu(id: number) {
  const trigger = screen.getByTestId(`button-menu-${id}`);
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "Enter" });
  return screen.getByTestId(`menu-registration-${id}`);
}

describe("RegistrationTable", () => {
  it("renders exactly the default columns plus menu", () => {
    render(<RegistrationTable rows={[reg(1, "Ada")]} fields={DEFAULT_FIELDS} fees={[]} isLoading={false} submissionCount={() => 0} actions={actions()} />);
    expect(headers()).toEqual(["Registrant", "Date", "Balance", "Payment", "Registration menu"]);
    // Keep the absolutely positioned accessibility label inside the table's scroller.
    expect(screen.getByRole("columnheader", { name: "Registration menu" })).toHaveClass("relative");
    expect(screen.queryByTestId("button-edit-1")).toBeNull();
  });

  it("renders the check-in preset and shows cancelled status with payment hidden", () => {
    render(<RegistrationTable rows={[reg(1, "Ada"), reg(2, "Bo", "cancelled")]} fields={["checkin"]} fees={[]} isLoading={false} submissionCount={() => 0} actions={actions()} />);
    expect(headers()).toEqual(["Registrant", "Check-in", "Registration menu"]);
    expect(screen.getByTestId("status-cancelled-2")).toBeInTheDocument();
    expect(screen.queryByTestId("button-checkin-2")).toBeNull();
  });

  it("uses dynamic spans for empty state", () => {
    render(<RegistrationTable rows={[]} fields={PRESETS.payments.fields} fees={[]} isLoading={false} submissionCount={() => 0} actions={actions()} />);
    expect(screen.getByTestId("text-empty")).toHaveAttribute("colspan", "5");
  });

  it("routes menu and visible actions to the correct row after filtering", () => {
    const a = actions();
    // Filtered list: only registration 7 remains in second position semantics.
    render(<RegistrationTable rows={[reg(9, "Cy"), reg(7, "Di")]} fields={["edit", "transfer"]} fees={[]} isLoading={false} submissionCount={() => 0} actions={a} />);
    fireEvent.click(screen.getByTestId("button-transfer-7"));
    expect(a.onTransfer).toHaveBeenCalledWith(7);
    const menu = openMenu(7);
    fireEvent.click(within(menu).getByTestId("menu-attendees-7"));
    expect(a.onDetails).toHaveBeenCalledWith(7, "attendees");
    const menu2 = openMenu(9);
    fireEvent.click(within(menu2).getByTestId("menu-cancel-9"));
    expect(a.onCancel).toHaveBeenCalledWith(9);
  });

  it("hides mutating actions for cancelled registrations in the menu", () => {
    render(<RegistrationTable rows={[reg(3, "Ed", "cancelled")]} fields={DEFAULT_FIELDS} fees={[]} isLoading={false} submissionCount={() => 0} actions={actions()} />);
    const menu = openMenu(3);
    expect(within(menu).queryByTestId("menu-cancel-3")).toBeNull();
    expect(within(menu).queryByTestId("menu-transfer-3")).toBeNull();
    expect(within(menu).getByTestId("menu-addons-3")).toBeInTheDocument();
  });
});
