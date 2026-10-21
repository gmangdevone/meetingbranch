import { format } from "date-fns";
import type { AdminRegistration, ReunionFee } from "@workspace/api-client-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../ui/sheet";
import { AddOnPurchaseList } from "../AddOnPicker";
import { attendeeAddOns, attendeeDinnerStatus, registrationAddOns } from "../../lib/registrationAddOns";
import { isDinnerFee } from "../../lib/fees";
import { centsLabel, describeChoices } from "../../lib/addOns";
import type { DetailKind } from "./RegistrationTable";
import { money } from "../payments/money";
import { LedgerStatusBadge } from "../payments/LedgerPanel";
import { computeTotal } from "../../lib/fees";

const TITLES: Record<DetailKind, string> = { summary: "Registration details", branch: "Branch", attendees: "Attendees", addons: "Add-ons" };

/** Read-only details for one registration; `reg` is always the live row by ID. */
export function RegistrationDetailsSheet({
  reg, kind, fees, onClose,
}: {
  reg: AdminRegistration | null;
  kind: DetailKind | null;
  fees: ReunionFee[];
  onClose: () => void;
}) {
  const open = !!reg && !!kind;
  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto" data-testid="sheet-registration-details">
        {reg && kind && (
          <>
            <SheetHeader className="text-left">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary">{TITLES[kind]}</p>
              <SheetTitle className="font-serif text-2xl" data-testid="text-details-registrant">{reg.userName || reg.userEmail || `Registration #${reg.id}`}</SheetTitle>
              <SheetDescription>
                #{reg.id} · {reg.branchName} · {reg.attendeeCount} {reg.attendeeCount === 1 ? "attendee" : "attendees"}
                {reg.status === "cancelled" ? " · Cancelled" : ""}
              </SheetDescription>
            </SheetHeader>
            <div className="mt-5 space-y-4 text-sm">
              {kind === "summary" && (
                <dl className="space-y-3 rounded-xl border p-4">
                  <div><dt className="text-muted-foreground">Date</dt><dd>{format(new Date(reg.createdAt), "MMM d, yyyy")}</dd></div>
                  <div><dt className="text-muted-foreground">Balance</dt><dd className="font-bold">{money(reg.ledger?.balanceCents ?? Math.round(computeTotal(fees, reg.attendees, reg.selectedFeeIds ?? [], reg.addOns ?? []) * 100))}</dd></div>
                  <div><dt className="text-muted-foreground">Payment</dt><dd><LedgerStatusBadge status={reg.ledger?.status ?? (reg.paymentStatus === "pending" ? "unpaid" : reg.paymentStatus)} /></dd></div>
                  {reg.ledger && <div><dt className="text-muted-foreground">Confirmed paid</dt><dd>{money(reg.ledger.confirmedCents + reg.ledger.legacyCreditCents)}</dd></div>}
                </dl>
              )}
              {kind === "branch" && (
                <div className="rounded-xl border p-4">
                  <div className="text-xs text-muted-foreground">Family branch</div>
                  <div className="font-serif text-xl font-bold mt-0.5">{reg.branchName}</div>
                  <div className="text-xs text-muted-foreground mt-2">Registered {format(new Date(reg.createdAt), "MMM d, yyyy")}</div>
                </div>
              )}
              {kind === "attendees" && <AttendeeList reg={reg} fees={fees} />}
              {kind === "addons" && <AddOnDetails reg={reg} fees={fees} />}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function AttendeeList({ reg, fees }: { reg: AdminRegistration; fees: ReunionFee[] }) {
  return (
    <ul className="space-y-2">
      {reg.attendees.map((a) => {
        const addOns = attendeeAddOns(fees.filter((f) => !isDinnerFee(f)), reg.selectedFeeIds ?? [], a);
        const dinners = attendeeDinnerStatus(fees, reg.selectedFeeIds ?? [], a);
        return (
          <li key={a.id} className="rounded-xl border p-3" data-testid={`detail-attendee-${a.id}`}>
            <div className="flex justify-between gap-2">
              <span className="font-medium">{a.name}</span>
              {a.age != null && <span className="text-xs text-muted-foreground">Age {a.age}</span>}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">{addOns.length ? `Add-ons: ${addOns.join(", ")}` : "No individual add-ons"}</div>
            {dinners.map(({ fee, included }) => (
              <div key={fee.id} className="text-xs">
                <span className="text-muted-foreground">{fee.label}: </span>
                <span className={included ? "font-bold text-green-700" : "font-bold text-muted-foreground"}>{included ? "Included" : "Not included"}</span>
              </div>
            ))}
            {a.dietaryRestrictions && <div className="text-xs mt-0.5"><span className="text-muted-foreground">Dietary: </span>{a.dietaryRestrictions}</div>}
            {!(a.addOns ?? []).length && a.shirtSize && <div className="text-xs text-muted-foreground/70">Historical size on file: {a.shirtSize}</div>}
            <div className="text-xs mt-1">
              {a.checkedInAt
                ? <span className="text-green-700 font-bold">Checked in {format(new Date(a.checkedInAt), "MMM d, h:mm a")}</span>
                : <span className="text-muted-foreground">Not checked in</span>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function AddOnDetails({ reg, fees }: { reg: AdminRegistration; fees: ReunionFee[] }) {
  const feeAddOns = registrationAddOns(fees, reg.selectedFeeIds ?? [], reg.attendees);
  const household = feeAddOns.filter((i) => i.fee.chargeType === "flat");
  const perPerson = feeAddOns.filter((i) => i.fee.chargeType !== "flat");
  const attendeePurchases = reg.attendees.filter((a) => (a.addOns ?? []).length > 0);
  const shirtSizes = attendeePurchases.length === 0 && !(reg.addOns ?? []).length ? reg.attendees.filter((a) => a.shirtSize).length : 0;
  const empty = !feeAddOns.length && !attendeePurchases.length && !(reg.addOns ?? []).length;
  return (
    <>
      {empty && <p className="text-muted-foreground">No add-ons on this registration.</p>}
      {(household.length > 0 || (reg.addOns ?? []).length > 0) && (
        <section className="rounded-xl border p-3" data-testid="detail-household-addons">
          <h3 className="font-medium">Household add-ons</h3>
          <p className="text-xs text-muted-foreground mb-1">Shared with this registration; not assigned to an individual.</p>
          {household.map(({ fee, quantity }) => <div key={fee.id}>{fee.label} × {quantity}</div>)}
          <AddOnPurchaseList items={reg.addOns} testIdPrefix={`detail-household-${reg.id}`} />
        </section>
      )}
      {perPerson.length > 0 && (
        <section className="rounded-xl border p-3">
          <h3 className="font-medium mb-1">Per-person options</h3>
          {perPerson.map(({ fee, quantity }) => <div key={fee.id}>{fee.label} × {quantity}</div>)}
        </section>
      )}
      {attendeePurchases.length > 0 && (
        <section className="rounded-xl border p-3" data-testid="detail-attendee-addons">
          <h3 className="font-medium mb-1">Attendee add-ons</h3>
          <ul className="space-y-2">
            {attendeePurchases.map((a) => (
              <li key={a.id}>
                <div className="text-xs font-bold text-muted-foreground">{a.name}</div>
                {(a.addOns ?? []).map((p, i) => (
                  <div key={i} data-testid={`detail-addon-${a.id}-${i}`}>
                    {p.label}{p.choices.length ? ` (${describeChoices(p)})` : ""} · {centsLabel(p.unitPriceCents)}
                  </div>
                ))}
              </li>
            ))}
          </ul>
        </section>
      )}
      {shirtSizes > 0 && <p className="text-xs text-muted-foreground/70">{shirtSizes} historical {shirtSizes === 1 ? "size" : "sizes"} on file (not a purchase)</p>}
    </>
  );
}
