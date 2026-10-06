import type { BranchFeeOption } from "@workspace/api-client-react";
import { CheckCircle2, Info } from "lucide-react";
import { money } from "./money";

export type FeeChoice = "yes" | "no" | null;

/** The fee option for the selected branch (matched by the branch's stable id). */
export function branchFeeOptionFor(
  branches: { id: number; name: string }[],
  options: BranchFeeOption[],
  branchName: string,
): BranchFeeOption | null {
  const branch = branches.find((b) => b.name === branchName);
  if (!branch) return null;
  return options.find((o) => o.branchId === branch.id) ?? null;
}

/**
 * Asked right after the branch is chosen, before attendee details.
 * Yes adds the FULL fee as its own line (optionally with no attendees at all);
 * No continues to attendees. Already-chosen or paid fees are never re-asked.
 */
export function BranchFeeQuestion({
  option,
  choice,
  onChoice,
  feeOnly,
  onFeeOnly,
  allowFeeOnly,
}: {
  option: BranchFeeOption;
  choice: FeeChoice;
  onChoice: (c: FeeChoice) => void;
  feeOnly: boolean;
  onFeeOnly: (v: boolean) => void;
  allowFeeOnly: boolean;
}) {
  if (option.state !== "available") {
    const text =
      option.state === "yours_unpaid" ? `You chose to pay the ${option.label} (${money(option.amountCents)}). It's in your hub; it won't be charged twice.`
      : option.state === "yours_reported" ? `You reported your ${option.label} payment. An organizer will confirm it.`
      : option.state === "yours_paid" ? `Your ${option.label} is paid. Thank you.`
      : option.state === "paid" ? `The ${option.branchName} ${option.label} is already paid. Nothing to add.`
      : option.state === "under_review" ? `Earlier payments toward the ${option.branchName} ${option.label} are being reviewed by organizers. Nothing to add now.`
      : option.state === "yours_disabled" ? `The ${option.label} you chose isn't being collected right now. Nothing to pay unless organizers turn it back on.`
      : `Someone in ${option.branchName} already chose to pay the ${option.label}.`;
    return (
      <p className="mt-4 flex gap-2 rounded-2xl bg-muted/50 p-3 text-sm text-muted-foreground" data-testid="branch-fee-status">
        {option.state === "yours_paid" || option.state === "paid" ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-primary" /> : <Info className="w-4 h-4 shrink-0 mt-0.5" />}
        {text}
      </p>
    );
  }
  const btn = (active: boolean) =>
    `flex-1 rounded-xl border-2 px-4 py-3 text-sm font-bold transition-colors ${active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:border-primary/50"}`;
  return (
    <fieldset className="mt-5 rounded-2xl border border-primary/25 bg-primary/5 p-4 sm:p-5" data-testid="branch-fee-question">
      <legend className="sr-only">{option.label}</legend>
      <p className="text-xs font-bold uppercase tracking-widest text-primary">{option.branchName} branch</p>
      <p className="font-serif text-xl font-bold mt-1">
        Will you pay the {option.label}? <span className="tabular-nums">{money(option.amountCents)}</span>
      </p>
      <p className="text-sm text-muted-foreground mt-1">
        Once per branch, paid in full by one person. It's separate from attendee costs.
      </p>
      <div className="mt-4 flex gap-3" role="radiogroup" aria-label={`Pay the ${option.label}?`}>
        <button type="button" role="radio" aria-checked={choice === "yes"} className={btn(choice === "yes")} onClick={() => onChoice("yes")}>
          Yes, I'll pay it
        </button>
        <button type="button" role="radio" aria-checked={choice === "no"} className={btn(choice === "no")} onClick={() => onChoice("no")}>
          No
        </button>
      </div>
      {choice === "yes" && allowFeeOnly && (
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2" role="radiogroup" aria-label="Attendees">
          <button type="button" role="radio" aria-checked={!feeOnly} className={btn(!feeOnly)} onClick={() => onFeeOnly(false)}>
            Also register attendees
          </button>
          <button type="button" role="radio" aria-checked={feeOnly} className={btn(feeOnly)} onClick={() => onFeeOnly(true)}>
            Fee only, no attendees
          </button>
        </div>
      )}
      {choice === "yes" && feeOnly && allowFeeOnly && (
        <p className="mt-3 text-sm">No one is registered and no registration or dinner cost is added. You'll report the payment from the hub.</p>
      )}
    </fieldset>
  );
}
