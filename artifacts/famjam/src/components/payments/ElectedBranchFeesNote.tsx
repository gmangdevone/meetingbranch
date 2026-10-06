import { Link } from "wouter";
import { useListMyBranchFeeElections, getListMyBranchFeeElectionsQueryKey } from "@workspace/api-client-react";
import { ArrowRight, Users } from "lucide-react";
import { money } from "./money";

const STATUS = { unpaid: "Not paid yet", reported: "Awaiting confirmation", paid: "Paid" } as const;

/**
 * Branch special fees the viewer chose to pay, shown next to a registration
 * as SEPARATE charges. They are never part of this registration's balance;
 * payment and history live in the reunion hub.
 */
export function ElectedBranchFeesNote({ reunionId, hubPath }: { reunionId: number; hubPath: string }) {
  const { data } = useListMyBranchFeeElections(reunionId, {
    query: { enabled: reunionId > 0, queryKey: getListMyBranchFeeElectionsQueryKey(reunionId) },
  });
  const elections = data?.elections ?? [];
  if (elections.length === 0) return null;
  return (
    <section className="bg-card border shadow-sm rounded-3xl p-6" data-testid="elected-branch-fees">
      <h3 className="font-serif text-xl font-bold flex items-center gap-2"><Users className="w-5 h-5" /> Your branch fee</h3>
      <p className="text-sm text-muted-foreground mt-1">Separate from the balance above. It's paid once per branch, in full, from the reunion hub.</p>
      <ul className="mt-4 divide-y rounded-2xl border text-sm">
        {elections.map((e) => (
          <li key={e.id} className="flex items-center justify-between gap-3 p-3">
            <span>
              <span className="font-medium">{e.label}</span>
              <span className="text-muted-foreground"> · {e.branchName}</span>
              <span className="block text-xs text-muted-foreground">{e.status === "unpaid" && !e.collecting ? "Not being collected right now" : STATUS[e.status]}</span>
            </span>
            <span className="font-bold tabular-nums">{money(e.amountCents)}</span>
          </li>
        ))}
      </ul>
      <Link href={hubPath} className="mt-4 inline-flex items-center gap-1.5 text-sm font-bold text-primary hover:underline">
        Pay or view it in the hub <ArrowRight className="w-4 h-4" />
      </Link>
    </section>
  );
}
