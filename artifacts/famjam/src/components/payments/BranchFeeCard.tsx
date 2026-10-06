import { format } from "date-fns";
import type { BranchFeeLedger } from "@workspace/api-client-react";
import { money } from "./money";
import { Users } from "lucide-react";

/**
 * Member view of a branch's ONE shared special fee. Shows the shared balance
 * and dated confirmed amounts only — never who paid.
 */
export function BranchFeeCard({ fee }: { fee: BranchFeeLedger }) {
  const live = fee.entries.filter((e) => !e.reversed);
  const pct = fee.amountCents > 0 ? Math.min(100, (fee.paidCents / fee.amountCents) * 100) : 0;
  return (
    <div className="bg-card border shadow-sm rounded-3xl p-6" data-testid={`branch-fee-${fee.branchId}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5" /> {fee.branchName} branch
          </p>
          <h3 className="font-serif text-xl font-bold mt-1">{fee.label}</h3>
          <p className="text-sm text-muted-foreground mt-1">
            One shared fee for the whole {fee.branchName} branch, paid once — not per registration. Optional; add it to a
            payment only if you're covering some of it.
          </p>
        </div>
        <div className="text-right shrink-0">
          <div className="font-bold text-2xl tabular-nums">{money(fee.amountCents)}</div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">once per branch</div>
        </div>
      </div>

      <div className="mt-5 h-2 rounded-full bg-muted overflow-hidden" aria-hidden>
        <div className="h-full bg-primary rounded-full transition-transform origin-left" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-2 flex flex-wrap justify-between gap-2 text-sm">
        <span>
          <span className="font-bold tabular-nums">{money(fee.paidCents)}</span>{" "}
          <span className="text-muted-foreground">confirmed</span>
        </span>
        {fee.settled ? (
          <span className="font-bold text-primary">Paid in full — nothing more is owed.</span>
        ) : !fee.enabled ? (
          <span className="text-muted-foreground">Not being collected right now.</span>
        ) : (
          <span>
            <span className="font-bold tabular-nums">{money(fee.remainingCents)}</span>{" "}
            <span className="text-muted-foreground">left for the branch</span>
          </span>
        )}
      </div>
      {fee.pendingReportedCents > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          {money(fee.pendingReportedCents)} reported and awaiting organizer confirmation (not counted yet).
        </p>
      )}

      {live.length > 0 && (
        <ul className="mt-4 divide-y border-t">
          {live.map((e) => (
            <li key={e.receiptId} className="flex justify-between py-2 text-sm">
              <span className="text-muted-foreground">
                {e.receivedDate ? format(new Date(`${e.receivedDate}T12:00:00`), "MMM d, yyyy") : format(new Date(e.createdAt), "MMM d, yyyy")}
              </span>
              <span className="font-medium tabular-nums">{money(e.cents)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
