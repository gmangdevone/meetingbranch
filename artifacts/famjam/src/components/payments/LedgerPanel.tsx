import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Undo2, RotateCcw, Receipt, Clock, AlertTriangle } from "lucide-react";
import {
  useGetRegistrationLedger,
  getGetRegistrationLedgerQueryKey,
  useReverseReceipt,
  type RegistrationLedger,
  type LedgerEntry,
} from "@workspace/api-client-react";
import { Skeleton } from "../ui/skeleton";
import { Button } from "../ui/button";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../ui/dialog";
import { invalidateMoney, money } from "./money";

export const LEDGER_STATUS_LABEL: Record<string, string> = {
  unpaid: "Unpaid",
  partial: "Partially paid",
  paid: "Paid",
  waived: "Waived",
};

export function LedgerStatusBadge({ status, className = "" }: { status: string; className?: string }) {
  const tone =
    status === "paid"
      ? "bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-300"
      : status === "partial"
        ? "bg-sky-100 text-sky-900 border-sky-200 dark:bg-sky-900/30 dark:text-sky-200"
        : status === "waived"
          ? "bg-muted text-muted-foreground border-border"
          : "bg-amber-100 text-amber-900 border-amber-200 dark:bg-amber-900/30 dark:text-amber-200";
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider ${tone} ${className}`}>
      {LEDGER_STATUS_LABEL[status] ?? status}
    </span>
  );
}

function Row({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: string }) {
  return (
    <div className={`flex items-center justify-between py-1.5 ${strong ? "border-t mt-1 pt-3" : ""}`}>
      <span className={strong ? "font-bold" : "text-muted-foreground"}>{label}</span>
      <span className={`tabular-nums ${strong ? "font-serif text-xl font-bold" : "font-medium"} ${tone ?? ""}`}>{value}</span>
    </div>
  );
}

export function BalanceSummary({ ledger }: { ledger: RegistrationLedger }) {
  const chipOwed = ledger.contributions.reduce((s, c) => s + c.outstandingCents, 0);
  const chipPaid = ledger.contributions.reduce((s, c) => s + c.confirmedCents, 0);
  return (
    <div className="text-sm">
      <Row label="Charges" value={money(ledger.chargeCents)} />
      {ledger.sponsoredCents > 0 && <Row label="Sponsored" value={`- ${money(ledger.sponsoredCents)}`} />}
      {ledger.legacyCreditCents > 0 && <Row label="Opening credit (paid before itemized receipts)" value={`- ${money(ledger.legacyCreditCents)}`} />}
      <Row label="Confirmed payments" value={`- ${money(ledger.confirmedCents)}`} />
      {ledger.waived && <Row label="Waived by organizer" value={`- ${money(ledger.waivedCents)}`} />}
      <Row
        label="Remaining balance"
        value={money(ledger.balanceCents)}
        strong
        tone={ledger.balanceCents > 0 ? "text-amber-700 dark:text-amber-400" : "text-green-700 dark:text-green-400"}
      />
      {ledger.creditCents > 0 && (
        <p className="mt-2 rounded-xl bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-800 px-3 py-2 text-sky-900 dark:text-sky-200">
          {money(ledger.creditCents)} confirmed above current charges. This credit is held for organizer review; no refund is issued automatically.
        </p>
      )}
      {ledger.contributions.length > 0 && (
        <div className="mt-3 rounded-xl bg-muted/50 px-3 py-2">
          <p className="font-medium">Attached fund chip-in</p>
          <p className="text-muted-foreground">
            {money(chipPaid)} confirmed, {money(chipOwed)} still owed. This is separate from the registration balance.
          </p>
        </div>
      )}
      {ledger.pendingReportedCents > 0 && (
        <p className="mt-3 flex items-start gap-2 text-muted-foreground">
          <Clock className="w-4 h-4 mt-0.5 shrink-0" />
          {money(ledger.pendingReportedCents)} reported and waiting for an organizer to confirm. Reported payments do not reduce the balance until confirmed.
        </p>
      )}
    </div>
  );
}

const METHOD_LABEL: Record<string, string> = { cashapp: "Cash App", zelle: "Zelle", cash: "Cash", check: "Check", other: "Other" };

function entryTitle(e: LedgerEntry) {
  if (e.kind === "legacy_credit") return "Opening credit";
  if (e.kind === "transfer") return e.registrationCents < 0 ? "Transferred out" : "Transferred in";
  return METHOD_LABEL[e.method ?? ""] ?? "Payment";
}

export function LedgerHistory({
  registrationId,
  reunionId,
  onReplace,
}: {
  registrationId: number;
  reunionId?: number;
  onReplace?: (entry: LedgerEntry) => void;
}) {
  const { data, isLoading, isError, refetch } = useGetRegistrationLedger(registrationId, {
    query: { queryKey: getGetRegistrationLedgerQueryKey(registrationId) },
  });
  const [reversing, setReversing] = useState<LedgerEntry | null>(null);

  if (isLoading)
    return (
      <div className="space-y-3">
        <Skeleton className="h-28 w-full rounded-2xl" />
        <Skeleton className="h-14 w-full rounded-xl" />
        <Skeleton className="h-14 w-full rounded-xl" />
      </div>
    );
  if (isError || !data)
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
        <p className="font-medium text-destructive">Could not load the balance.</p>
        <Button size="sm" variant="outline" className="mt-2 rounded-lg" onClick={() => refetch()}>Try again</Button>
      </div>
    );

  const canManage = data.canManage && reunionId != null;
  const replaced = new Set(data.entries.map((e) => e.replacesReceiptId).filter(Boolean));

  return (
    <div className="space-y-5">
      <BalanceSummary ledger={data.ledger} />
      <div>
        <h4 className="font-bold text-xs uppercase tracking-widest text-muted-foreground mb-2">Payment history</h4>
        {data.entries.length === 0 ? (
          <div className="rounded-2xl border border-dashed p-5 text-center text-sm text-muted-foreground">
            <Receipt className="w-5 h-5 mx-auto mb-2 opacity-60" />
            No confirmed payments yet.
          </div>
        ) : (
          <ul className="divide-y rounded-2xl border bg-card">
            {data.entries.map((e) => {
              const cents = e.registrationCents + e.contributionCents;
              const isReversed = !!e.reversed;
              return (
                <li key={e.id} className="p-3 sm:p-4 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className={`font-semibold ${isReversed ? "line-through text-muted-foreground" : ""}`}>
                        {entryTitle(e)}
                        <span className="ml-2 text-xs font-normal text-muted-foreground">#{e.id}</span>
                      </p>
                      <p className="text-muted-foreground">
                        {e.receivedDate ? `Received ${format(new Date(`${e.receivedDate}T12:00:00`), "MMM d, yyyy")}` : "Date not recorded"}
                        {e.recordedByName && ` · recorded by ${e.recordedByName}`}
                      </p>
                      {e.contributionCents !== 0 && (
                        <p className="text-muted-foreground">
                          {money(e.registrationCents)} to fees, {money(e.contributionCents)} to the fund chip-in
                        </p>
                      )}
                      {e.reference && <p className="text-muted-foreground">Ref: {e.reference}</p>}
                      {e.note && <p className="text-muted-foreground italic">{e.note}</p>}
                      {e.replacesReceiptId && <p className="text-muted-foreground">Replaces #{e.replacesReceiptId}</p>}
                      {e.reversed && (
                        <p className="mt-1 flex items-start gap-1.5 text-destructive">
                          <Undo2 className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                          Reversed {format(new Date(e.reversed.at), "MMM d, yyyy")}
                          {e.reversed.byName && ` by ${e.reversed.byName}`}
                          {e.reversed.reason && `: ${e.reversed.reason}`}
                        </p>
                      )}
                    </div>
                    <span className={`tabular-nums font-bold shrink-0 ${isReversed ? "line-through text-muted-foreground" : cents < 0 ? "text-destructive" : ""}`}>
                      {money(cents)}
                    </span>
                  </div>
                  {canManage && (e.kind === "payment" || e.kind === "transfer") && (
                    <div className="mt-2 flex gap-2">
                      {!isReversed && (
                        <Button size="sm" variant="outline" className="rounded-lg h-8" onClick={() => setReversing(e)}>
                          <Undo2 className="w-3.5 h-3.5 mr-1.5" /> Reverse
                        </Button>
                      )}
                      {e.kind === "payment" && isReversed && !replaced.has(e.id) && onReplace && (
                        <Button size="sm" variant="outline" className="rounded-lg h-8" onClick={() => onReplace(e)}>
                          <RotateCcw className="w-3.5 h-3.5 mr-1.5" /> Record replacement
                        </Button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {data.pendingSubmissions.length > 0 && (
        <div>
          <h4 className="font-bold text-xs uppercase tracking-widest text-muted-foreground mb-2">Reported, awaiting confirmation</h4>
          <ul className="space-y-2">
            {data.pendingSubmissions.map((p) => (
              <li key={p.id} className="flex justify-between rounded-xl border border-dashed px-3 py-2 text-sm">
                <span>
                  {METHOD_LABEL[p.method] ?? p.method} · {format(new Date(p.createdAt), "MMM d, yyyy")}
                  {p.registrationIds.length > 1 && <span className="text-muted-foreground"> · covers {p.registrationIds.length} registrations</span>}
                </span>
                <span className="tabular-nums font-medium">{money(p.amountCents)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {reversing && reunionId != null && (
        <ReverseDialog entry={reversing} reunionId={reunionId} registrationId={registrationId} onClose={() => setReversing(null)} />
      )}
    </div>
  );
}

function ReverseDialog({ entry, reunionId, registrationId, onClose }: { entry: LedgerEntry; reunionId: number; registrationId: number; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const reverse = useReverseReceipt();
  const submit = () => {
    setError(null);
    reverse.mutate(
      { reunionId, receiptId: entry.id, data: { reason: reason.trim() } },
      {
        onSuccess: (r) => {
          invalidateMoney(qc, reunionId, [registrationId, ...r.ledgers.map((l) => l.registrationId)]);
          onClose();
        },
        onError: (err: unknown) => setError(errorMessage(err)),
      },
    );
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="rounded-3xl p-6 sm:p-8 max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl">Reverse receipt #{entry.id}</DialogTitle>
          <DialogDescription>
            {entry.kind === "transfer"
              ? "This will undo the transfer for both registrations. If the money was transferred again, reverse that later transfer first."
              : `${money(entry.registrationCents + entry.contributionCents)} will stop counting toward the balance.`} The original entry stays in the history with your reason.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="rev-reason">Reason (required)</Label>
          <Textarea id="rev-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="e.g. Entered $40, check was for $35" className="rounded-xl" />
        </div>
        {error && (
          <p className="flex items-start gap-2 text-sm text-destructive"><AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />{error}</p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Keep it</Button>
          <Button variant="destructive" disabled={reason.trim().length < 3 || reverse.isPending} onClick={submit}>
            {reverse.isPending ? "Reversing..." : "Reverse receipt"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function errorMessage(err: unknown): string {
  const e = err as { error?: string; data?: { error?: string }; response?: { data?: { error?: string } }; message?: string };
  return e?.error ?? e?.data?.error ?? e?.response?.data?.error ?? e?.message ?? "Something went wrong. Try again.";
}
