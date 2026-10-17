import type { ReunionFee } from "@workspace/api-client-react";
import { attendeeGetsDinner, feeApplies, isDinnerFee, isShirtFee, type FeeAttendee } from "./fees";

/**
 * Add-ons on a registration: selected optional fees plus every applicable dinner
 * (configured or mandatory). Per-person quantities count actual recipients.
 */
export function registrationAddOns(
  fees: ReunionFee[],
  selectedFeeIds: number[],
  attendees: FeeAttendee[],
) {
  return fees
    .filter(fee => (fee.isOptional || isDinnerFee(fee)) && feeApplies(fee, selectedFeeIds))
    .map(fee => ({
      fee,
      quantity: fee.chargeType === "flat" ? 1 : attendees.filter(
        attendee => (!isDinnerFee(fee) || attendeeGetsDinner(fee, attendee)) &&
          (!isShirtFee(fee) || attendee.includeShirt !== false),
      ).length,
    }));
}

export function attendeeAddOns(fees: ReunionFee[], selectedFeeIds: number[], attendee: FeeAttendee) {
  return registrationAddOns(fees, selectedFeeIds, [attendee])
    .filter(item => item.fee.chargeType === "per_person" && item.quantity > 0)
    .map(item => item.fee.label);
}

/** Every applicable dinner for a registration, with Included/Not included for this attendee. */
export function attendeeDinnerStatus(fees: ReunionFee[], selectedFeeIds: number[], attendee: FeeAttendee) {
  return fees
    .filter(fee => isDinnerFee(fee) && feeApplies(fee, selectedFeeIds))
    .map(fee => ({ fee, included: attendeeGetsDinner(fee, attendee) }));
}
