import { sql } from "drizzle-orm";
import { type Exec } from "./ledger";
import { feeApplies, isDinnerFee } from "./fees";

type Fee = { id: number; label: string; chargeType: string; isDinner?: boolean | null; isOptional: boolean; dinnerMode?: "hidden" | "optional" | "mandatory" | null };
type Attendee = { name: string; includeDinner?: boolean; dinnerFeeIds?: number[] | null };
type Change = { feeId: number; feeLabel: string; attendeeName?: string; beforeChoice: string; afterChoice: string };

export function dinnerSelectionChanges(
  fees: Fee[], attendees: Attendee[], previous: (Attendee | undefined)[], oldSelected: number[], selected: number[],
): Change[] {
  return attendees.flatMap((attendee, index) => {
    const old = previous[index];
    return fees.filter(isDinnerFee).flatMap(fee => {
      const before = old
        ? feeApplies(fee, oldSelected) && old.includeDinner !== false && (old.dinnerFeeIds?.includes(fee.id) ?? true)
        : fee.dinnerMode !== "hidden" && feeApplies(fee, selected);
      const after = feeApplies(fee, selected) && attendee.includeDinner !== false && (attendee.dinnerFeeIds?.includes(fee.id) ?? true);
      if (before === after) return [];
      return [{ feeId: fee.id, feeLabel: fee.label, attendeeName: attendee.name,
        beforeChoice: before ? "Included" : "Excluded", afterChoice: after ? "Included" : "Excluded" }];
    });
  });
}

export async function recordDinnerChanges(
  tx: Exec, reunionId: number, actorId: string, kind: "mode" | "selection",
  changes: Change[], registrationId: number | null = null,
) {
  for (const change of changes) {
    if (change.beforeChoice === change.afterChoice) continue;
    await tx.execute(sql`
      INSERT INTO dinner_history
        (reunion_id, actor_id, actor_name, kind, fee_id, fee_label, registration_id, attendee_name, before_choice, after_choice)
      VALUES (${reunionId}, ${actorId},
        COALESCE((SELECT COALESCE(NULLIF(trim(concat_ws(' ', first_name, last_name)), ''), email)
          FROM users WHERE id = ${actorId}), ${actorId}),
        ${kind}, ${change.feeId}, ${change.feeLabel}, ${registrationId}, ${change.attendeeName ?? null},
        ${change.beforeChoice}, ${change.afterChoice})
    `);
  }
}

export function dinnerModeChoice(fee: { dinnerMode?: string | null; isOptional: boolean }) {
  return fee.dinnerMode ?? (fee.isOptional ? "Legacy optional" : "Legacy required");
}
