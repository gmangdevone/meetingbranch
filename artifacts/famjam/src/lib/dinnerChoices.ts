import type { ReunionFee } from "@workspace/api-client-react";
import { feeApplies, isConfiguredDinner, isDinnerFee, isVisibleDinner } from "./fees";

/** Default dinner selections for a brand-new attendee: every visible configured dinner plus legacy dinners. */
export function defaultDinnerIds(fees: ReunionFee[]): number[] {
  return fees.filter(f => isDinnerFee(f) && (!isConfiguredDinner(f) || isVisibleDinner(f))).map(f => f.id);
}

/**
 * Saved attendee's actual dinner selections. A server snapshot wins; otherwise
 * legacy attendees get the saved applicable dinners only if they had dinner on.
 */
export function hydrateDinnerIds(
  fees: ReunionFee[],
  savedSelectedFeeIds: number[],
  attendee: { includeDinner?: boolean | null; dinnerFeeIds?: number[] | null },
): number[] {
  if (attendee.includeDinner === false) return [];
  if (attendee.dinnerFeeIds != null) return attendee.dinnerFeeIds.filter(id =>
    fees.some(f => f.id === id && isDinnerFee(f) && feeApplies(f, savedSelectedFeeIds)));
  return fees.filter(f => isDinnerFee(f) && feeApplies(f, savedSelectedFeeIds)).map(f => f.id);
}

/**
 * Dinners offered as checkboxes to one attendee: visible configured dinners,
 * legacy dinners that apply to the household, and any hidden dinner this
 * attendee already has saved (so it can be kept or removed, never newly added).
 */
export function offeredDinners(
  fees: ReunionFee[],
  householdSelectedFeeIds: number[],
  attendeeDinnerIds: number[],
): ReunionFee[] {
  return fees.filter(f => {
    if (!isDinnerFee(f)) return false;
    if (!isConfiguredDinner(f)) return feeApplies(f, householdSelectedFeeIds);
    if (isVisibleDinner(f)) return true;
    return attendeeDinnerIds.includes(f.id);
  });
}

/**
 * Configured dinner IDs to save on the household: saved ones (kept even when
 * hidden or unselected so unrelated edits never drop them) plus any configured
 * dinner some attendee now selects.
 */
export function configuredDinnerSelection(
  fees: ReunionFee[],
  savedSelectedFeeIds: number[],
  attendeeDinnerIds: number[][],
): number[] {
  const configured = fees.filter(isConfiguredDinner).map(f => f.id);
  const chosen = new Set(attendeeDinnerIds.flat());
  return configured.filter(id => savedSelectedFeeIds.includes(id) || chosen.has(id));
}
