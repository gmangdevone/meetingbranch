import { feeApplies, isDinnerFee } from "./fees";

type DinnerMode = "hidden" | "optional" | "mandatory";
type Fee = { id: number; chargeType: string; label: string; isDinner?: boolean | null; isOptional: boolean; dinnerMode?: DinnerMode | null };
type Attendee = { id?: number; name: string; includeDinner?: boolean; dinnerFeeIds?: number[] | null };

/** Server-owned eligibility, never taken from the submitted dinnerFeeIds. */
export function resolveDinnerSelections<T extends Attendee>(
  fees: Fee[], attendees: T[], selected: number[], manager: boolean,
  saved?: { attendees: Attendee[]; selectedFeeIds: number[] },
) {
  const dinners = fees.filter(isDinnerFee);
  const configured = dinners.filter(f => f.dinnerMode != null);
  const remaining = [...(saved?.attendees ?? [])];
  const usedIds = new Set<number>();
  const previous = attendees.map(a => {
    if (a.id != null) {
      if (!saved || usedIds.has(a.id)) throw new Error("Invalid or duplicate attendee ID.");
      usedIds.add(a.id);
      const index = remaining.findIndex(old => old.id === a.id);
      if (index < 0) throw new Error("Attendee does not belong to this registration.");
      return remaining.splice(index, 1)[0];
    }
    // Backward-compatible clients do not send IDs. Consume matches once.
    const index = remaining.findIndex(old => old.name.trim().toLowerCase() === a.name.trim().toLowerCase());
    return index < 0 ? undefined : remaining.splice(index, 1)[0];
  });
  const chosen = new Set(selected);
  for (const f of configured) {
    if (f.dinnerMode === "hidden") {
      if (saved?.selectedFeeIds.includes(f.id)) chosen.add(f.id);
      else if (chosen.has(f.id)) throw new Error("Hidden dinner is not available for this registration.");
    } else if (!saved || previous.some(a => !a)) {
      // Defaults apply to new attendees, not retroactively to saved records.
      chosen.add(f.id);
    } else if (saved.selectedFeeIds.includes(f.id)) {
      chosen.add(f.id);
    }
  }
  const allowed = new Set(fees.filter(f => f.isOptional || (isDinnerFee(f) && f.dinnerMode != null)).map(f => f.id));
  if ([...chosen].some(id => !allowed.has(id))) throw new Error("One or more selected fees are not available for this reunion.");
  const normalized = attendees.map((a, index) => {
    const old = previous[index];
    let eligible = old
      ? old.dinnerFeeIds ?? dinners.filter(f => f.dinnerMode == null || feeApplies(f, saved!.selectedFeeIds)).map(f => f.id)
      : dinners.filter(f => f.dinnerMode == null || (f.dinnerMode !== "hidden" && feeApplies(f, [...chosen]))).map(f => f.id);
    // Retain legacy behavior when no new dinner controls have been configured.
    const defaultIncluded = old?.includeDinner ?? (configured.length ? eligible.length > 0 : true);
    let includeDinner = a.includeDinner ?? defaultIncluded;
    if (a.dinnerFeeIds != null) {
      const requested = a.includeDinner === false ? [] : [...new Set(a.dinnerFeeIds)];
      const oldSelected = old?.includeDinner !== false ? old?.dinnerFeeIds ?? dinners.filter(f => feeApplies(f, saved?.selectedFeeIds ?? [])).map(f => f.id) : [];
      for (const id of requested) {
        const fee = dinners.find(f => f.id === id);
        if (!fee || (fee.dinnerMode === "hidden" && (!old || !oldSelected?.includes(id)))) {
          throw new Error("Dinner is not available for this attendee.");
        }
        if (fee.dinnerMode != null) chosen.add(id);
      }
      for (const fee of configured) {
        if (fee.dinnerMode === "mandatory" && !manager && !requested.includes(fee.id) &&
          (!old || oldSelected?.includes(fee.id))) {
          throw new Error("Dinner is mandatory. Contact an organizer to request an exception.");
        }
        if (fee.dinnerMode === "hidden" && !manager && oldSelected?.includes(fee.id) && !requested.includes(fee.id)) {
          throw new Error("Contact an organizer to remove a saved hidden dinner.");
        }
      }
      eligible = requested;
      includeDinner = requested.length > 0;
    }
    if (!old && configured.length && !eligible.length) includeDinner = false;
    const mandatory = dinners.some(f => f.dinnerMode === "mandatory" && eligible.includes(f.id) && chosen.has(f.id));
    if (a.dinnerFeeIds == null && !manager && mandatory && !includeDinner && old?.includeDinner !== false) {
      throw new Error("Dinner is mandatory. Contact an organizer to request an exception.");
    }
    return { ...a, includeDinner, dinnerFeeIds: eligible };
  });
  return { attendees: normalized, selectedFeeIds: [...chosen] };
}
