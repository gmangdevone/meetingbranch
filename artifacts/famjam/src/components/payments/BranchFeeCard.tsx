import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import {
  useReleaseBranchFeeElection,
  getListMyBranchFeeElectionsQueryKey,
  getListBranchFeeOptionsQueryKey,
  type MyBranchFeeElection,
} from "@workspace/api-client-react";
import { money } from "./money";
import { errorMessage } from "./LedgerPanel";
import { Button } from "../ui/button";
import { Users } from "lucide-react";
import { useToast } from "../../hooks/use-toast";

const STATUS: Record<MyBranchFeeElection["status"], { text: string; tone: string }> = {
  unpaid: { text: "Not paid yet", tone: "bg-amber-100 text-amber-900" },
  reported: { text: "Awaiting confirmation", tone: "bg-sky-100 text-sky-900" },
  paid: { text: "Paid", tone: "bg-emerald-100 text-emerald-900" },
};

/**
 * A branch special fee this member chose to pay IN FULL (once per branch).
 * Separate from attendees: it never adds headcount. Unpaid choices can be
 * released so someone else in the branch can take it.
 */
export function BranchFeeCard({ election, reunionId }: { election: MyBranchFeeElection; reunionId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const release = useReleaseBranchFeeElection();
  const st = STATUS[election.status];
  const live = election.history.filter((e) => !e.reversed);
  const onRelease = () => {
    if (!window.confirm(`Stop paying the ${election.label}? Someone else in ${election.branchName} can then choose it.`)) return;
    release.mutate(
      { electionId: election.id },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListMyBranchFeeElectionsQueryKey(reunionId) });
          qc.invalidateQueries({ queryKey: getListBranchFeeOptionsQueryKey(reunionId) });
          toast({ title: "Branch fee released" });
        },
        onError: (err) => toast({ title: "Couldn't release", description: errorMessage(err), variant: "destructive" }),
      },
    );
  };
  return (
    <div className="bg-card border shadow-sm rounded-3xl p-6" data-testid={`branch-fee-${election.branchId}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5" /> {election.branchName} branch
          </p>
          <h3 className="font-serif text-xl font-bold mt-1">{election.label}</h3>
          <p className="text-sm text-muted-foreground mt-1">
            You chose to pay this once-per-branch fee in full. It's separate from attendee costs.
          </p>
        </div>
        <div className="text-right shrink-0">
          <div className="font-bold text-2xl tabular-nums">{money(election.amountCents)}</div>
          <span className={`inline-block mt-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${st.tone}`}>{st.text}</span>
        </div>
      </div>
      {live.length > 0 && (
        <ul className="mt-4 space-y-1 text-sm">
          {live.map((e) => (
            <li key={e.receiptId} className="flex justify-between">
              <span className="text-muted-foreground">Confirmed {format(new Date(e.receivedDate ?? e.createdAt), "MMM d, yyyy")}</span>
              <span className="tabular-nums font-medium">{money(e.cents)}</span>
            </li>
          ))}
        </ul>
      )}
      {election.status === "unpaid" && !election.collecting && (
        <p className="mt-3 text-sm text-muted-foreground" data-testid="branch-fee-not-collecting">
          This branch isn't collecting the fee right now. Nothing to pay unless organizers turn it back on.
        </p>
      )}
      {election.status === "unpaid" && (
        <Button variant="ghost" size="sm" className="mt-3 -ml-2 text-muted-foreground" onClick={onRelease} disabled={release.isPending}>
          I can't pay this after all
        </Button>
      )}
    </div>
  );
}
