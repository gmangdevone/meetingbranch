import type { ReunionFee } from "@workspace/api-client-react";
import { computeFeeAmount, feeApplies, type FeeAttendee } from "../lib/fees";
import { money } from "./payments/money";

/** Household/branch fees and contributions are not assigned to individual attendees. */
export function AttendeeFeeBreakdown({ fees, attendee, selectedFeeIds, ready = true }: {
  fees: ReunionFee[];
  attendee: FeeAttendee;
  selectedFeeIds: number[];
  ready?: boolean;
}) {
  if (!ready) return <p className="mt-3 text-sm text-muted-foreground">Enter this attendee's name and valid age to see their fees.</p>;
  const lines = fees
    .filter(fee => fee.chargeType === "per_person" && feeApplies(fee, selectedFeeIds))
    .map(fee => ({ id: fee.id, label: fee.label, cents: Math.round(computeFeeAmount(fee, [attendee]) * 100) }));
  const total = lines.reduce((sum, line) => sum + line.cents, 0);
  return (
    <div className="mt-3 space-y-1 text-sm" aria-label="Attendee fee breakdown">
      {lines.map(line => (
        <div key={line.id} className="flex justify-between gap-3 text-muted-foreground">
          <span className="break-words min-w-0">{line.label}</span>
          <span className="tabular-nums shrink-0">{money(line.cents)}</span>
        </div>
      ))}
      <div className="flex justify-between gap-3 border-t pt-2 font-bold">
        <span>Attendee total</span><span className="tabular-nums shrink-0">{money(total)}</span>
      </div>
      <p className="text-xs text-muted-foreground">Household and branch fees and fund contributions are listed separately.</p>
    </div>
  );
}
