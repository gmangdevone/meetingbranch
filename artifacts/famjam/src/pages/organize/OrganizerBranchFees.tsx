import { useState } from "react";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetReunion,
  getGetReunionQueryKey,
  useListBranchFees,
  getListBranchFeesQueryKey,
  useUpdateBranchSpecialFee,
  useListReunionRegistrations,
  getListReunionRegistrationsQueryKey,
  useReverseReceipt,
  type BranchFeeLedger,
} from "@workspace/api-client-react";
import { Users, Wallet, AlertTriangle, Undo2, Archive } from "lucide-react";
import { OrganizerLayout } from "./OrganizerLayout";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Switch } from "../../components/ui/switch";
import { Textarea } from "../../components/ui/textarea";
import { Skeleton } from "../../components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../../components/ui/dialog";
import { useToast } from "../../hooks/use-toast";
import { FULL_ACCESS_VIEWER, viewerHasRole } from "../../lib/roles";
import { money, parseCents, centsToInput, invalidateMoney } from "../../components/payments/money";
import { errorMessage } from "../../components/payments/LedgerPanel";
import { RecordPaymentDialog } from "../../components/payments/RecordPaymentDialog";

/**
 * Branch special fees: ONE shared, one-time, opt-in fee per branch.
 * Power users configure it; registration managers confirm money and see the
 * private payer history.
 */
export function OrganizerBranchFees({ params }: { params: { reunionId: string } }) {
  const reunionId = parseInt(params.reunionId, 10);
  const { data: summary } = useGetReunion(reunionId, {
    query: { enabled: !isNaN(reunionId), retry: false, queryKey: getGetReunionQueryKey(reunionId) },
  });
  const viewer = summary?.viewer ?? FULL_ACCESS_VIEWER;
  const canConfigure = viewerHasRole(viewer, "power_user");
  const canRecord = viewerHasRole(viewer, "registration");
  const allowed = canConfigure || canRecord;

  const { data, isLoading, isError, refetch } = useListBranchFees(reunionId, {
    query: { enabled: !isNaN(reunionId) && !!summary && allowed, queryKey: getListBranchFeesQueryKey(reunionId) },
  });
  const { data: registrations } = useListReunionRegistrations(reunionId, {
    query: { enabled: !isNaN(reunionId) && !!summary && canRecord, queryKey: getListReunionRegistrationsQueryKey(reunionId) },
  });
  const [recordFor, setRecordFor] = useState<BranchFeeLedger | null>(null);
  const [reverse, setReverse] = useState<{ receiptId: number; cents: number } | null>(null);

  const branches = data?.branches ?? [];
  const active = branches.filter((b) => !b.archived);
  const archived = branches.filter((b) => b.archived && b.entries.length > 0);

  return (
    <OrganizerLayout reunionId={reunionId}>
      {summary && !allowed ? (
        <div className="bg-card border rounded-3xl p-10 text-center">
          <h1 className="font-serif text-2xl font-bold">Branch fees</h1>
          <p className="text-muted-foreground mt-2">You need the Power User or Registration role to see branch fees.</p>
        </div>
      ) : (
        <div className="space-y-6">
          <div>
            <h1 className="font-serif text-3xl font-bold">Branch Fees</h1>
            <p className="text-muted-foreground mt-1 max-w-2xl">
              Each branch can have one shared special fee, paid once by the whole branch — not per registration. Members opt in
              when they pay; it never touches registration dues or the sponsorship fund.
            </p>
          </div>

          {isLoading || !summary ? (
            <div className="space-y-4">
              <Skeleton className="h-48 rounded-3xl" />
              <Skeleton className="h-48 rounded-3xl" />
            </div>
          ) : isError ? (
            <div className="bg-card border rounded-3xl p-8 text-center">
              <p className="text-destructive font-medium">Couldn't load branch fees.</p>
              <Button variant="outline" className="mt-4 rounded-xl" onClick={() => refetch()}>Try again</Button>
            </div>
          ) : active.length === 0 ? (
            <div className="bg-card border border-dashed rounded-3xl p-10 text-center">
              <Users className="w-8 h-8 mx-auto text-muted-foreground" />
              <p className="font-medium mt-3">No branches yet</p>
              <p className="text-sm text-muted-foreground mt-1">Add branches on the Branches page, then set a fee here.</p>
            </div>
          ) : (
            active.map((b) => (
              <BranchFeeRow
                key={b.branchId}
                reunionId={reunionId}
                fee={b}
                canConfigure={canConfigure}
                canRecord={canRecord}
                onRecord={() => setRecordFor(b)}
                onReverse={(receiptId, cents) => setReverse({ receiptId, cents })}
              />
            ))
          )}

          {archived.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                <Archive className="w-3.5 h-3.5" /> Removed branches (history kept)
              </h2>
              {archived.map((b) => (
                <BranchFeeRow key={b.branchId} reunionId={reunionId} fee={b} canConfigure={false} canRecord={false} onRecord={() => {}} onReverse={(receiptId, cents) => setReverse({ receiptId, cents })} canReverse={canRecord} />
              ))}
            </div>
          )}
        </div>
      )}

      {recordFor && (
        <RecordPaymentDialog
          reunionId={reunionId}
          registrations={[]}
          preset={{
            branchFee: {
              branchId: recordFor.branchId,
              branchName: recordFor.branchName,
              label: recordFor.label,
              remainingCents: recordFor.remainingCents,
              payerOptions: (registrations ?? [])
                .filter((r) => r.branchName === recordFor.branchName && r.status === "active")
                .map((r) => ({ id: r.id, label: `${r.userName || r.userEmail || "Registration"} · #${r.id}` })),
            },
          }}
          onClose={() => setRecordFor(null)}
        />
      )}
      {reverse && <ReverseDialog reunionId={reunionId} receiptId={reverse.receiptId} cents={reverse.cents} onClose={() => setReverse(null)} />}
    </OrganizerLayout>
  );
}

function BranchFeeRow({
  reunionId,
  fee,
  canConfigure,
  canRecord,
  canReverse = canRecord,
  onRecord,
  onReverse,
}: {
  reunionId: number;
  fee: BranchFeeLedger;
  canConfigure: boolean;
  canRecord: boolean;
  canReverse?: boolean;
  onRecord: () => void;
  onReverse: (receiptId: number, cents: number) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const update = useUpdateBranchSpecialFee();
  const [enabled, setEnabled] = useState(fee.enabled);
  const [label, setLabel] = useState(fee.label);
  const [amount, setAmount] = useState(fee.amountCents ? centsToInput(fee.amountCents) : "");
  const [error, setError] = useState<string | null>(null);
  const cents = amount.trim() ? parseCents(amount) : 0;
  const dirty = enabled !== fee.enabled || label.trim() !== fee.label || cents !== fee.amountCents;
  const reducesBelowPaid = cents != null && enabled && cents < fee.paidCents;
  const valid = label.trim().length > 0 && cents != null && (!enabled || cents > 0);

  const save = () => {
    if (!valid || cents == null) return;
    setError(null);
    update.mutate(
      { reunionId, branchId: fee.branchId, data: { enabled, label: label.trim(), amountCents: cents } },
      {
        onSuccess: (l) => {
          invalidateMoney(qc, reunionId, []);
          qc.invalidateQueries({ queryKey: getGetReunionQueryKey(reunionId) });
          toast({ title: `${l.branchName} ${l.label} saved`, description: l.creditCents > 0 ? `${money(l.creditCents)} collected above the new amount — review it below.` : undefined });
        },
        onError: (err) => setError(errorMessage(err)),
      },
    );
  };

  const pct = fee.amountCents > 0 && fee.enabled ? Math.min(100, (fee.paidCents / fee.amountCents) * 100) : 0;

  return (
    <section className="bg-card border shadow-sm rounded-3xl overflow-hidden" data-testid={`branch-fee-row-${fee.branchId}`}>
      <div className="p-6 flex flex-col lg:flex-row gap-6">
        <div className="lg:w-72 shrink-0">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{fee.archived ? "Removed branch" : "Branch"}</p>
          <h2 className="font-serif text-2xl font-bold">{fee.branchName}</h2>
          {fee.enabled ? (
            <>
              <div className="mt-4 h-2 rounded-full bg-muted overflow-hidden" aria-hidden>
                <div className="h-full bg-primary rounded-full" style={{ width: `${pct}%` }} />
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-y-1 text-sm">
                <dt className="text-muted-foreground">Confirmed</dt>
                <dd className="text-right font-bold tabular-nums">{money(fee.paidCents)}</dd>
                <dt className="text-muted-foreground">Remaining</dt>
                <dd className="text-right font-bold tabular-nums">{fee.settled ? "Paid in full" : money(fee.remainingCents)}</dd>
                {fee.pendingReportedCents > 0 && (
                  <>
                    <dt className="text-muted-foreground">Reported, unconfirmed</dt>
                    <dd className="text-right tabular-nums">{money(fee.pendingReportedCents)}</dd>
                  </>
                )}
              </dl>
            </>
          ) : (
            <p className="text-sm text-muted-foreground mt-3">
              {fee.paidCents > 0 ? `Not collecting. ${money(fee.paidCents)} confirmed earlier is kept.` : "No special fee."}
            </p>
          )}
          {fee.creditCents > 0 && (
            <p className="mt-3 flex gap-2 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-300/60 p-2.5 text-xs text-amber-900 dark:text-amber-200">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>
                <span className="font-bold">{money(fee.creditCents)} credit to review.</span> Confirmed money is above the current
                fee. Refund outside the app and reverse a receipt, or raise the fee back.
              </span>
            </p>
          )}
          {canRecord && fee.enabled && fee.remainingCents > 0 && (
            <Button className="mt-4 rounded-xl w-full" onClick={onRecord}>
              <Wallet className="w-4 h-4 mr-2" /> Record branch fee payment
            </Button>
          )}
        </div>

        <div className="flex-1 min-w-0 space-y-5">
          {canConfigure && (
            <div className="rounded-2xl border bg-muted/30 p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor={`fee-on-${fee.branchId}`} className="font-bold">Collect a shared fee from this branch</Label>
                <Switch id={`fee-on-${fee.branchId}`} checked={enabled} onCheckedChange={setEnabled} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor={`fee-label-${fee.branchId}`} className="text-xs text-muted-foreground">Label members see</Label>
                  <Input id={`fee-label-${fee.branchId}`} value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} placeholder="Sibling Fee" className="rounded-xl bg-background" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`fee-amt-${fee.branchId}`} className="text-xs text-muted-foreground">Amount, once per branch ($)</Label>
                  <Input id={`fee-amt-${fee.branchId}`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className="rounded-xl bg-background tabular-nums" />
                </div>
              </div>
              {cents == null && <p className="text-xs text-destructive">Use dollars and cents, like 20 or 20.50.</p>}
              {enabled && cents === 0 && <p className="text-xs text-destructive">Set an amount above $0.00 to turn the fee on.</p>}
              {dirty && reducesBelowPaid && (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  {money(fee.paidCents)} is already confirmed. Saving keeps that history and shows {money(fee.paidCents - (cents ?? 0))} as credit for review.
                </p>
              )}
              {dirty && !enabled && fee.enabled && (
                <p className="text-xs text-muted-foreground">Turning it off stops new payments. Confirmed history stays.</p>
              )}
              {error && <p className="text-xs text-destructive">{error}</p>}
              <div className="flex justify-end">
                <Button size="sm" className="rounded-xl" disabled={!dirty || !valid || update.isPending} onClick={save}>
                  {update.isPending ? "Saving..." : "Save fee"}
                </Button>
              </div>
            </div>
          )}

          <div>
            <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">Confirmed history</h3>
            {fee.entries.length === 0 ? (
              <p className="text-sm text-muted-foreground rounded-xl border border-dashed p-4">No money confirmed for this branch fee yet.</p>
            ) : (
              <ul className="divide-y rounded-2xl border">
                {[...fee.entries].reverse().map((e) => (
                  <li key={e.receiptId} className={`flex items-center gap-3 p-3 text-sm ${e.reversed ? "opacity-60" : ""}`}>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate">
                        {e.payerName ?? "Payer not recorded"}
                        <span className="text-muted-foreground font-normal"> · receipt #{e.receiptId}</span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {e.receivedDate ? format(new Date(`${e.receivedDate}T12:00:00`), "MMM d, yyyy") : format(new Date(e.createdAt), "MMM d, yyyy")}
                        {e.method ? ` · ${e.method === "cashapp" ? "Cash App" : e.method}` : ""}
                        {e.reversed ? ` · Reversed${e.reversalReason ? `: ${e.reversalReason}` : ""}` : ""}
                      </p>
                    </div>
                    <span className={`tabular-nums font-bold ${e.reversed ? "line-through" : ""}`}>{money(e.cents)}</span>
                    {canReverse && !e.reversed && (
                      <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Reverse receipt ${e.receiptId}`} onClick={() => onReverse(e.receiptId, e.cents)}>
                        <Undo2 className="w-4 h-4" />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function ReverseDialog({ reunionId, receiptId, cents, onClose }: { reunionId: number; receiptId: number; cents: number; onClose: () => void }) {
  const qc = useQueryClient();
  const reverse = useReverseReceipt();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="rounded-3xl p-6 sm:p-8 max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl">Reverse receipt #{receiptId}</DialogTitle>
          <DialogDescription>
            Undoes this receipt everywhere it was applied ({money(cents)} on this branch fee, plus any registration money on the same receipt). History is kept.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="bf-rev-reason">Reason</Label>
          <Textarea id="bf-rev-reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} className="rounded-xl" rows={3} />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="destructive"
            className="rounded-xl"
            disabled={reason.trim().length < 3 || reverse.isPending}
            onClick={() =>
              reverse.mutate(
                { reunionId, receiptId, data: { reason: reason.trim() } },
                {
                  onSuccess: (r) => {
                    invalidateMoney(qc, reunionId, r.ledgers.map((l) => l.registrationId));
                    onClose();
                  },
                  onError: (err) => setError(errorMessage(err)),
                },
              )
            }
          >
            {reverse.isPending ? "Reversing..." : "Reverse"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
