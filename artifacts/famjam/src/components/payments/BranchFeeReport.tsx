import { useState } from "react";
import { useListBranchFees, getListBranchFeesQueryKey } from "@workspace/api-client-react";
import { ChevronDown, Wallet } from "lucide-react";
import { money } from "./money";
import { Skeleton } from "../ui/skeleton";
import { Button } from "../ui/button";

/**
 * Branch special fee totals for Reports. Fee-only payers are never counted as
 * attendees; pending reports count as outstanding, not paid.
 */
export function BranchFeeReport({ reunionId }: { reunionId: number }) {
  const { data, isLoading, isError, refetch } = useListBranchFees(reunionId, {
    query: { enabled: !isNaN(reunionId), queryKey: getListBranchFeesQueryKey(reunionId) },
  });
  const [open, setOpen] = useState(false);
  if (isLoading) return <Skeleton className="h-40 rounded-3xl" />;
  if (isError || !data) {
    return (
      <div className="bg-card border rounded-3xl p-6 text-sm">
        <p className="text-destructive font-medium">Couldn't load branch fees.</p>
        <Button variant="outline" size="sm" className="mt-3 rounded-xl" onClick={() => refetch()}>Try again</Button>
      </div>
    );
  }
  const s = data.summary;
  if (s.paidCount + s.outstandingCount === 0) return null;
  return (
    <section className="bg-card border shadow-sm rounded-3xl p-6" data-testid="branch-fee-report">
      <h2 className="font-serif text-2xl font-bold flex items-center gap-2"><Wallet className="w-5 h-5" /> Branch special fees</h2>
      <p className="text-sm text-muted-foreground mt-1">Once per branch, paid in full by one member. Not counted as attendees.</p>
      <div className="mt-5 grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="Paid branches" value={String(s.paidCount)} testId="bf-paid-count" />
        <Stat label="Paid total" value={money(s.paidCents)} testId="bf-paid-total" />
        <Stat label="Outstanding branches" value={String(s.outstandingCount)} testId="bf-out-count" />
        <Stat label="Outstanding total" value={money(s.outstandingCents)} testId="bf-out-total" />
      </div>
      {s.outstanding.length > 0 && (
        <div className="mt-5">
          <button type="button" className="flex items-center gap-1.5 text-sm font-bold text-primary" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            <ChevronDown className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`} /> Unpaid branches
          </button>
          {open && (
            <ul className="mt-3 divide-y rounded-2xl border text-sm" data-testid="bf-outstanding-list">
              {s.outstanding.map((o) => (
                <li key={o.branchId} className="flex items-center justify-between gap-3 p-3">
                  <span>
                    <span className="font-medium">{o.branchName}</span>
                    <span className="text-muted-foreground"> · {o.label}</span>
                    <span className="block text-xs text-muted-foreground">{o.elected ? "Chosen by a member, not yet paid" : "Nobody has chosen it yet"}</span>
                  </span>
                  <span className="font-bold tabular-nums">{money(o.amountCents)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function Stat({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="rounded-2xl bg-muted/40 p-4">
      <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="text-2xl font-bold font-serif tabular-nums mt-1" data-testid={testId}>{value}</div>
    </div>
  );
}
