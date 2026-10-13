import type { ReunionFee } from "@workspace/api-client-react";
import { isDinnerFee, type FeeAttendee } from "./fees";

/** Selections are household-wide; only dinner supports individual opt-outs. */
export function registrationAddOns(
  fees: ReunionFee[],
  selectedFeeIds: number[],
  attendees: FeeAttendee[],
) {
  return fees
    .filter(fee => fee.isOptional && selectedFeeIds.includes(fee.id))
    .map(fee => ({
      fee,
      quantity: fee.chargeType === "flat" ? 1 : attendees.filter(
        attendee => !isDinnerFee(fee) || attendee.includeDinner !== false,
      ).length,
    }));
}

export function attendeeAddOns(fees: ReunionFee[], selectedFeeIds: number[], attendee: FeeAttendee) {
  return registrationAddOns(fees, selectedFeeIds, [attendee])
    .filter(item => item.fee.chargeType === "per_person" && item.quantity > 0)
    .map(item => item.fee.label);
}
