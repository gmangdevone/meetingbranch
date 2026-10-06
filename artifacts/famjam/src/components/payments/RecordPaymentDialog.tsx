import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import { useRecordReceipt, type RegistrationLedger, type ReceiptInputMethod, type ReceiptInput } from "@workspace/api-client-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import { Checkbox } from "../ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../ui/dialog";
import { money, parseCents, centsToInput, invalidateMoney } from "./money";
import { errorMessage } from "./LedgerPanel";

export interface PayableRegistration {
  id: number;
  label: string;
  ledger: RegistrationLedger;
}

export interface RecordPaymentPreset {
  submissionId?: number;
  amountCents?: number;
  method?: string;
  reference?: string | null;
  receivedDate?: string | null;
  replacesReceiptId?: number;
  /** Pending standalone fund chip-ins included in the reported payment (all-or-nothing). */
  standaloneChipIns?: { id: number; label: string; cents: number }[];
  /** A branch's ONE shared special fee (separate from registration balances and the fund). */
  branchFee?: {
    branchId: number;
    branchName: string;
    label: string;
    remainingCents: number;
    /** Portion the member reported for the fee, allocated first. */
    reportedCents?: number;
    /** Organizer-only record of who paid. Omit when reconciling a report (the reporter is used). */
    payerRegistrationId?: number | null;
    payerOptions?: { id: number; label: string }[];
  };
}

const METHODS: { value: ReceiptInputMethod; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "check", label: "Check" },
  { value: "cashapp", label: "Cash App" },
  { value: "zelle", label: "Zelle" },
  { value: "other", label: "Other" },
];

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/**
 * Only an explicit server rejection proves nothing was written. Network
 * failures, timeouts, 5xx and unreadable responses are ambiguous: the receipt
 * may have committed and only the response was lost.
 */
export function isDefiniteRejection(err: unknown): boolean {
  const status = (err as { status?: unknown })?.status;
  const data = (err as { data?: { code?: unknown } | null })?.data;
  const hasBody = data != null;
  if (data?.code === "already_recorded") return false;
  return typeof status === "number" && hasBody && [400, 401, 403, 404, 409, 422].includes(status);
}

const newKey = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `k${Date.now()}${Math.random().toString(36).slice(2, 12)}`;

type Line = { key: string; registrationId?: number; contributionId?: number; branchId?: number; label: string; maxCents: number };

/**
 * Organizer receipt entry. Allocations default to the remaining balances
 * (capped by the preset amount when reconciling a reported payment) and must
 * add up to the amount received before saving.
 */
export function RecordPaymentDialog({
  reunionId,
  registrations,
  preset,
  onClose,
}: {
  reunionId: number;
  registrations: PayableRegistration[];
  preset?: RecordPaymentPreset;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const record = useRecordReceipt();
  const idempotencyKey = useRef(newKey());

  const lines: Line[] = useMemo(() => {
    const out: Line[] = [];
    const bf = preset?.branchFee;
    if (bf && bf.remainingCents > 0) out.push({ key: `b${bf.branchId}`, branchId: bf.branchId, label: `${bf.label} · ${bf.branchName} branch (shared, once per branch)`, maxCents: bf.remainingCents });
    for (const r of registrations) {
      if (!r.ledger.waived) out.push({ key: `r${r.id}`, registrationId: r.id, label: `${r.label} · fees`, maxCents: r.ledger.balanceCents });
      for (const c of r.ledger.contributions) {
        if (c.outstandingCents > 0) out.push({ key: `c${c.id}`, contributionId: c.id, label: `${r.label} · fund chip-in`, maxCents: c.outstandingCents });
      }
    }
    return out;
  }, [registrations, preset?.branchFee]);

  const initial = useMemo(() => {
    let budget = preset?.amountCents ?? Number.POSITIVE_INFINITY;
    const m: Record<string, string> = {};
    for (const l of lines) {
      // The branch fee line takes only what the member said was for it.
      const cap = l.branchId != null && preset?.branchFee?.reportedCents != null ? Math.min(l.maxCents, preset.branchFee.reportedCents) : l.maxCents;
      const take = Math.max(0, Math.min(cap, budget));
      budget -= take;
      m[l.key] = centsToInput(take);
    }
    return m;
  }, [lines, preset?.amountCents, preset?.branchFee?.reportedCents]);

  const chipIns = useMemo(() => preset?.standaloneChipIns ?? [], [preset?.standaloneChipIns]);
  const [alloc, setAlloc] = useState<Record<string, string>>(initial);
  // Standalone chip-ins: include the whole pledge or none of it. Pre-checked
  // only when the reported amount covers it after the registration lines.
  const [includeChip, setIncludeChip] = useState<Record<number, boolean>>(() => {
    let left = (preset?.amountCents ?? 0) - lines.reduce((s, l) => s + (parseCents(initial[l.key] ?? "") ?? 0), 0);
    const m: Record<number, boolean> = {};
    for (const c of chipIns) {
      m[c.id] = left >= c.cents;
      if (m[c.id]) left -= c.cents;
    }
    return m;
  });
  const allocCents = (k: string) => (alloc[k]?.trim() ? parseCents(alloc[k]) : 0);
  const chipTotal = chipIns.reduce((s, c) => s + (includeChip[c.id] ? c.cents : 0), 0);
  const allocTotal = lines.reduce((s, l) => s + (allocCents(l.key) ?? 0), 0) + chipTotal;
  const [amount, setAmount] = useState(preset?.amountCents ? centsToInput(preset.amountCents) : centsToInput(allocTotal));
  const [amountTouched, setAmountTouched] = useState(!!preset?.amountCents);
  const [method, setMethod] = useState<string>(preset?.method && METHODS.some((m) => m.value === preset.method) ? preset.method : "");
  const [receivedDate, setReceivedDate] = useState(preset?.receivedDate ?? today());
  const [reference, setReference] = useState(preset?.reference ?? "");
  const [note, setNote] = useState("");
  const [payerId, setPayerId] = useState<string>(preset?.branchFee?.payerRegistrationId ? String(preset.branchFee.payerRegistrationId) : "");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [doneCents, setDoneCents] = useState(0);
  // Frozen request for the current operation. After an ambiguous failure the
  // SAME key and SAME payload are re-sent (server returns the original receipt
  // if it had committed); the form is locked so nothing can change under that key.
  const frozen = useRef<ReceiptInput | null>(null);
  const [ambiguous, setAmbiguous] = useState(false);
  // Server says this money may already be on the books: stay locked, never rotate the key.
  const [alreadyRecorded, setAlreadyRecorded] = useState(false);
  const locked = ambiguous || alreadyRecorded || record.isPending;

  const soleLine = lines.length === 1 && chipIns.length === 0 ? lines[0] : null;
  const amountCents = parseCents(amount);
  const displayedAmount = amountTouched ? amountCents : allocTotal || null;
  const lineErrors = lines.map((l) => {
    const c = allocCents(l.key);
    if (c === null) return "Use dollars and cents, like 30 or 30.50.";
    if (c > l.maxCents) return `Only ${money(l.maxCents)} is owed here.`;
    return null;
  });
  const totalOwed = lines.reduce((s, l) => s + l.maxCents, 0) + chipIns.reduce((s, c) => s + c.cents, 0);
  const mismatch = displayedAmount != null && allocTotal !== displayedAmount;
  const canSave =
    !!method && !!receivedDate && displayedAmount != null && displayedAmount > 0 && !mismatch && lineErrors.every((e) => !e) && !record.isPending;

  const send = (data: ReceiptInput) => {
    setError(null);
    record.mutate(
      { reunionId, data },
      {
        onSuccess: () => {
          frozen.current = null;
          setAmbiguous(false);
          invalidateMoney(qc, reunionId, registrations.map((r) => r.id));
          setDoneCents(data.amountCents);
          setDone(true);
        },
        onError: (err) => {
          if ((err as { data?: { code?: unknown } | null })?.data?.code === "already_recorded") {
            setAmbiguous(false);
            setAlreadyRecorded(true);
            setError(errorMessage(err));
          } else if (isDefiniteRejection(err)) {
            // Rejected before anything was written: unlock, and the next
            // (possibly edited) attempt is a new operation with a new key.
            frozen.current = null;
            setAmbiguous(false);
            idempotencyKey.current = newKey();
            setError(errorMessage(err));
          } else {
            setAmbiguous(true);
            setError("We couldn't confirm whether this payment was saved. Retry sends the exact same payment and can't record it twice.");
          }
        },
      },
    );
  };

  const retrySame = () => {
    if (frozen.current) send(frozen.current);
  };

  const save = () => {
    if (alreadyRecorded) return;
    if (ambiguous) return retrySame();
    if (!canSave || displayedAmount == null) return;
    frozen.current = {
          amountCents: displayedAmount,
          method: method as ReceiptInputMethod,
          receivedDate,
          reference: reference.trim() || null,
          note: note.trim() || null,
          submissionId: preset?.submissionId ?? null,
          replacesReceiptId: preset?.replacesReceiptId ?? null,
          idempotencyKey: idempotencyKey.current,
          allocations: lines
            .filter((l) => (allocCents(l.key) ?? 0) > 0)
            .map((l) =>
              l.branchId != null
                ? { branchId: l.branchId, payerRegistrationId: payerId ? Number(payerId) : null, amountCents: allocCents(l.key)! }
                : { registrationId: l.registrationId ?? null, contributionId: l.contributionId ?? null, amountCents: allocCents(l.key)! },
            )
            .concat(chipIns.filter((c) => includeChip[c.id]).map((c) => ({ registrationId: null, contributionId: null, standaloneContributionId: c.id, amountCents: c.cents }))),
    };
    send(frozen.current);
  };

  const title = preset?.replacesReceiptId
    ? `Record replacement for #${preset.replacesReceiptId}`
    : preset?.submissionId
      ? "Confirm reported payment"
      : "Record payment";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="rounded-3xl p-6 sm:p-8 max-w-lg max-h-[92dvh] overflow-y-auto">
        {done ? (
          <div className="py-6 text-center">
            <CheckCircle2 className="w-12 h-12 mx-auto text-green-600 mb-3" />
            <h3 className="font-serif text-2xl font-bold">{money(doneCents)} recorded</h3>
            <p className="text-muted-foreground mt-1">Balances and reports are updated.</p>
            <Button className="mt-6 rounded-xl" onClick={onClose}>Done</Button>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="font-serif text-2xl">{title}</DialogTitle>
              <DialogDescription>
                Enter only money you actually received. {totalOwed > 0 ? `${money(totalOwed)} is still owed.` : "Nothing is owed right now."}
              </DialogDescription>
            </DialogHeader>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="rp-amount">Amount received ($)</Label>
                <Input
                  id="rp-amount"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={amountTouched ? amount : centsToInput(allocTotal)}
                  onChange={(e) => {
                    if (locked) return;
                    setAmountTouched(true);
                    setAmount(e.target.value);
                    // One place for the money to go: the split follows the amount
                    // (a $20 partial on $120 just works). Multiple lines stay explicit.
                    if (soleLine) {
                      const c = parseCents(e.target.value);
                      setAlloc((m) => ({ ...m, [soleLine.key]: c == null ? e.target.value : centsToInput(c) }));
                    }
                  }}
                  disabled={locked}
                  className="rounded-xl tabular-nums"
                />
                {amountTouched && amount.trim() && amountCents === null && (
                  <p className="text-xs text-destructive">Enter more than $0.00, up to two decimals.</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Method</Label>
                <Select value={method} onValueChange={setMethod} disabled={locked}>
                  <SelectTrigger className="rounded-xl"><SelectValue placeholder="How was it paid?" /></SelectTrigger>
                  <SelectContent>
                    {METHODS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rp-date">Date received</Label>
                <Input id="rp-date" type="date" max={today()} value={receivedDate} disabled={locked} onChange={(e) => setReceivedDate(e.target.value)} className="rounded-xl" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rp-ref">Reference (optional)</Label>
                <Input id="rp-ref" value={reference} maxLength={120} disabled={locked} onChange={(e) => setReference(e.target.value)} placeholder="Check #, $cashtag, Zelle ID" className="rounded-xl" />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-baseline justify-between">
                <Label>Apply to</Label>
                <span className={`text-xs tabular-nums ${mismatch ? "text-destructive font-bold" : "text-muted-foreground"}`}>
                  {money(allocTotal)} of {money(displayedAmount ?? 0)} allocated
                </span>
              </div>
              {chipIns.length > 0 && (
                <div className="rounded-2xl border divide-y">
                  {chipIns.map((c) => (
                    <label key={c.id} className="flex items-center gap-3 p-3 cursor-pointer">
                      <Checkbox disabled={locked} checked={!!includeChip[c.id]} onCheckedChange={(v) => setIncludeChip((m) => ({ ...m, [c.id]: v === true }))} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{c.label}</p>
                        <p className="text-xs text-muted-foreground">Standalone fund chip-in. Received in full, or leave unchecked.</p>
                      </div>
                      <span className="tabular-nums font-medium">{money(c.cents)}</span>
                    </label>
                  ))}
                </div>
              )}
              {lines.length === 0 && chipIns.length === 0 ? (
                <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                  Nothing is owed on these registrations. Excess money is not turned into a donation.
                </p>
              ) : (
                <div className="rounded-2xl border divide-y">
                  {lines.map((l, i) => (
                    <div key={l.key} className="flex items-center gap-3 p-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{l.label}</p>
                        <p className="text-xs text-muted-foreground">Owes {money(l.maxCents)}</p>
                        {lineErrors[i] && <p className="text-xs text-destructive">{lineErrors[i]}</p>}
                      </div>
                      <Input
                        aria-label={`Amount for ${l.label}`}
                        inputMode="decimal"
                        placeholder="0.00"
                        value={alloc[l.key] ?? ""}
                        disabled={locked}
                        onChange={(e) => setAlloc((a) => ({ ...a, [l.key]: e.target.value }))}
                        className="w-28 rounded-xl text-right tabular-nums"
                      />
                    </div>
                  ))}
                </div>
              )}
              {preset?.branchFee?.payerOptions && preset.branchFee.payerOptions.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  <Label>Who paid the {preset.branchFee.label}? (organizers only)</Label>
                  <Select value={payerId} onValueChange={setPayerId} disabled={locked}>
                    <SelectTrigger className="rounded-xl"><SelectValue placeholder="Not recorded" /></SelectTrigger>
                    <SelectContent>
                      {preset.branchFee.payerOptions.map((o) => <SelectItem key={o.id} value={String(o.id)}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {mismatch && (
                <p className="text-xs text-destructive">
                  Allocations must add up to the amount received. Record only what is owed; extra money is not counted as a donation.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="rp-note">Note (optional, organizers only)</Label>
              <Textarea id="rp-note" value={note} maxLength={500} disabled={locked} onChange={(e) => setNote(e.target.value)} className="rounded-xl" rows={2} />
            </div>

            {error && (
              <p className="flex items-start gap-2 rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> {error}
              </p>
            )}

            <DialogFooter>
              <Button variant="ghost" onClick={onClose}>{ambiguous || alreadyRecorded ? "Close and check history" : "Cancel"}</Button>
              {alreadyRecorded ? null : ambiguous ? (
                <Button disabled={record.isPending} onClick={retrySame} className="rounded-xl">
                  {record.isPending ? "Checking..." : `Retry the same ${money(frozen.current?.amountCents ?? 0)} payment`}
                </Button>
              ) : (
                <Button disabled={!canSave} onClick={save} className="rounded-xl">
                  {record.isPending ? "Saving..." : `Record ${displayedAmount ? money(displayedAmount) : "payment"}`}
                </Button>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
