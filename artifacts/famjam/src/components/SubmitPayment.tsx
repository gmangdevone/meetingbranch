import { useState } from "react";
import {
  getReunionPaymentRecipient,
  useCreatePaymentSubmission,
  useCreateContributionPaymentSubmission,
  getGetMyContributionsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { invalidateMoney } from "./payments/money";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { ZelleRecipientCard } from "./payments/ZelleRecipientCard";
import { SpecialInstructionsNote } from "./payments/SpecialInstructionsNote";
import { CheckCircle2, Info, Banknote, Landmark, DollarSign, FileText } from "lucide-react";

type Method = "cashapp" | "zelle" | "cash" | "check";

const METHOD_LABELS: Record<Method, string> = {
  cashapp: "Cash App",
  zelle: "Zelle",
  check: "Check",
  cash: "Cash",
};

/**
 * "Record a Payment" flow for registrants. Saving a submission never changes
 * the payment status — it stays Pending until an organizer confirms receipt
 * and marks the account Paid (or Waived).
 */
export interface PayableRegistration {
  id: number;
  label: string;
  amount: number;
}

/** A pending standalone fund chip-in (no registration attached). */
export interface PayableChipIn {
  id: number;
  label: string;
  amount: number;
}

/**
 * A branch's ONE shared special fee (once per branch, not per registration).
 * Always opt-in: it starts unchecked and is never folded into dues.
 */
export interface PayableBranchFee {
  /** The registrant's registration in that branch (the report is filed under it). */
  registrationId: number;
  branchId: number;
  branchName: string;
  label: string;
  remainingCents: number;
}

const centsOf = (v: string) => {
  const m = /^\$?(\d{1,7})(?:\.(\d{1,2}))?$/.exec(v.trim().replace(/,/g, ""));
  return m ? Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0")) : 0;
};

export function SubmitPayment({
  reunionId,
  registrations,
  chipIns = [],
  branchFees = [],
  cashAppAvailable,
  zelle = null,
  instructions = null,
  checkPayee,
}: {
  reunionId: number;
  /** Unpaid registrations (each amount includes its own fund chip-ins). */
  registrations: PayableRegistration[];
  /** Pending standalone fund chip-ins, payable like registrations. */
  chipIns?: PayableChipIn[];
  /** Branch special fees with money still owed. Opt-in only, default off. */
  branchFees?: PayableBranchFee[];
  /** Display hint only; the destination is always re-resolved from the server at handoff. */
  cashAppAvailable: boolean;
  /** Display hint only; re-resolved from the server after a Zelle submission. */
  zelle?: { name: string; contact: string } | null;
  /** Owner-approved special payment instructions (plain text). */
  instructions?: string | null;
  checkPayee: string | null;
}) {
  const [method, setMethod] = useState<Method | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>(registrations.map((r) => r.id));
  const [selectedChipInIds, setSelectedChipInIds] = useState<number[]>(chipIns.map((c) => c.id));
  const computeSelectedTotal = (regIds: number[], chipInIds: number[]) =>
    registrations.filter((r) => regIds.includes(r.id)).reduce((sum, r) => sum + r.amount, 0) +
    chipIns.filter((c) => chipInIds.includes(c.id)).reduce((sum, c) => sum + c.amount, 0);
  const selectedTotal = computeSelectedTotal(selectedIds, selectedChipInIds);
  const [amount, setAmount] = useState(selectedTotal > 0 ? selectedTotal.toFixed(2) : "");
  // Only one branch fee per report (it's filed under that branch's registration).
  const [feeBranchId, setFeeBranchId] = useState<number | null>(null);
  const [feeAmount, setFeeAmount] = useState("");
  const selectedFee = branchFees.find((f) => f.branchId === feeBranchId) ?? null;
  const feeCents = selectedFee ? centsOf(feeAmount) : 0;
  const syncAmount = (regIds: number[], chipInIds: number[], feeC: number) => {
    const total = Math.round(computeSelectedTotal(regIds, chipInIds) * 100) + feeC;
    setAmount(total > 0 ? (total / 100).toFixed(2) : "");
  };
  const toggleBranchFee = (fee: PayableBranchFee) => {
    if (feeBranchId === fee.branchId) {
      setFeeBranchId(null);
      setFeeAmount("");
      syncAmount(selectedIds, selectedChipInIds, 0);
    } else {
      setFeeBranchId(fee.branchId);
      setFeeAmount((fee.remainingCents / 100).toFixed(2));
      syncAmount(selectedIds, selectedChipInIds, fee.remainingCents);
    }
  };
  const changeFeeAmount = (v: string) => {
    setFeeAmount(v);
    syncAmount(selectedIds, selectedChipInIds, centsOf(v));
  };

  const toggleRegistration = (id: number) => {
    setSelectedIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      syncAmount(next, selectedChipInIds, feeCents);
      return next;
    });
  };
  const toggleChipIn = (id: number) => {
    setSelectedChipInIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      syncAmount(selectedIds, next, feeCents);
      return next;
    });
  };
  const [reference, setReference] = useState("");
  const [givenDate, setGivenDate] = useState("");
  const [note, setNote] = useState("");
  const [submitted, setSubmitted] = useState<Method | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Link resolved fresh from the server after the submission is saved.
  const [handoffUrl, setHandoffUrl] = useState<string | null>(null);
  const [handoffError, setHandoffError] = useState<string | null>(null);
  // Zelle destination re-resolved from the server after the submission is saved.
  const [freshZelle, setFreshZelle] = useState<{ name: string; contact: string } | null>(null);

  const queryClient = useQueryClient();
  const createSubmission = useCreatePaymentSubmission();
  const createChipInSubmission = useCreateContributionPaymentSubmission();
  const isSaving = createSubmission.isPending || createChipInSubmission.isPending;

  const methods: { id: Method; icon: React.ReactNode; available: boolean }[] = [
    { id: "cashapp", icon: <DollarSign className="w-4 h-4" />, available: cashAppAvailable },
    { id: "zelle", icon: <Landmark className="w-4 h-4" />, available: !!zelle },
    { id: "check", icon: <FileText className="w-4 h-4" />, available: !!checkPayee },
    { id: "cash", icon: <Banknote className="w-4 h-4" />, available: true },
  ];

  const pickMethod = (m: Method) => {
    setMethod(m);
    setSubmitted(null);
    setError(null);
    setReference("");
    setGivenDate("");
  };

  // Exact dollars and cents; never more than 2 decimals.
  const amountMatch = /^\$?(\d{1,7})(?:\.(\d{1,2}))?$/.exec(amount.trim().replace(/,/g, ""));
  const amountCents = amountMatch ? Number(amountMatch[1]) * 100 + Number((amountMatch[2] ?? "").padEnd(2, "0")) : 0;
  const amountNum = amountCents / 100;
  const validAmount = amountCents > 0;
  const referenceRequired = method === "cashapp" || method === "zelle" || method === "cash";
  const feeError = !selectedFee
    ? null
    : feeCents <= 0
      ? "Enter how much of the branch fee you're paying."
      : feeCents > selectedFee.remainingCents
        ? `Only $${(selectedFee.remainingCents / 100).toFixed(2)} is left on this branch fee.`
        : feeCents > amountCents
          ? "The branch fee portion can't be more than the total amount."
          : selectedIds.length > 0 && !selectedIds.includes(selectedFee.registrationId)
            ? `Include your ${selectedFee.branchName} registration, or report the branch fee by itself.`
            : selectedIds.length + selectedChipInIds.length === 0 && feeCents !== amountCents
              ? "For a branch fee payment, the amount must match the branch fee portion."
              : null;
  const canSubmit =
    !!method &&
    selectedIds.length + selectedChipInIds.length + (selectedFee ? 1 : 0) > 0 &&
    !feeError &&
    validAmount &&
    (!referenceRequired || reference.trim().length > 0) &&
    (method !== "cash" || givenDate.trim().length > 0) &&
    !isSaving;

  const handleSubmit = () => {
    if (!method || !canSubmit) return;
    setError(null);
    const callbacks = {
      onSuccess: () => {
        // Reported amounts show as "awaiting confirmation" right away; the
        // balance itself only changes when an organizer confirms receipt.
        invalidateMoney(queryClient, reunionId, selectedIds);
        queryClient.invalidateQueries({ queryKey: getGetMyContributionsQueryKey(reunionId) });
        setSubmitted(method);
        setHandoffUrl(null);
        setHandoffError(null);
        setFreshZelle(null);
        if (method === "zelle") {
          getReunionPaymentRecipient(reunionId)
            .then((r) => {
              if (r.status !== "approved" || !r.zelleRecipientName || !r.zelleContact) throw new Error("not configured");
              setFreshZelle({ name: r.zelleRecipientName, contact: r.zelleContact });
            })
            .catch(() =>
              setHandoffError("Zelle is not configured for this reunion right now. Do not send money until your organizers share current instructions."),
            );
        }
        if (method === "cashapp") {
          // Open a placeholder synchronously (keeps popup blockers happy), then
          // point it at the destination the server resolves right now. Opening
          // Cash App never marks anything paid.
          const win = window.open("", "_blank");
          getReunionPaymentRecipient(reunionId)
            .then((r) => {
              if (r.status !== "approved" || !r.cashAppUrl) throw new Error("not configured");
              const target = `${r.cashAppUrl}/${amountNum}`;
              setHandoffUrl(target);
              if (win) {
                win.opener = null;
                win.location.href = target;
              }
            })
            .catch(() => {
              win?.close();
              setHandoffError("Cash App is not configured for this reunion right now. Contact your organizers for payment instructions.");
            });
        }
      },
      onError: (err: any) =>
        setError(err?.error || "Could not save your payment details. Please try again."),
    };
    const data = {
      method,
      amount: amountNum,
      reference: reference.trim() || null,
      givenDate: method === "cash" ? givenDate : null,
      note: note.trim() || null,
    };
    if (selectedFee) {
      createSubmission.mutate(
        {
          id: selectedFee.registrationId,
          data: { ...data, registrationIds: selectedIds, contributionIds: selectedChipInIds, branchFeeAmount: feeCents / 100 },
        },
        callbacks,
      );
    } else if (selectedIds.length > 0) {
      createSubmission.mutate(
        {
          id: selectedIds[0],
          data: { ...data, registrationIds: selectedIds, contributionIds: selectedChipInIds },
        },
        callbacks,
      );
    } else {
      // Chip-ins only — no registration to attach the payment to.
      createChipInSubmission.mutate(
        { reunionId, data: { ...data, contributionIds: selectedChipInIds } },
        callbacks,
      );
    }
  };

  if (submitted) {
    return (
      <div className="bg-muted/50 border rounded-3xl p-6">
        <h3 className="font-bold text-sm uppercase tracking-widest text-muted-foreground mb-4">Submit a Payment</h3>
        <div className="flex items-start gap-3">
          <CheckCircle2 className="w-6 h-6 text-green-600 shrink-0 mt-0.5" />
          <div className="space-y-2">
            <p className="font-bold">Your {METHOD_LABELS[submitted]} payment details were saved.</p>
            {submitted === "cashapp" && handoffUrl && (
              <p className="text-sm text-muted-foreground">
                Cash App should have opened with the amount prefilled. Complete the payment there.
                If it didn't open,{" "}
                <button type="button" className="text-primary font-bold hover:underline" onClick={() => {
                  const win = window.open("", "_blank");
                  if (win) win.opener = null;
                  getReunionPaymentRecipient(reunionId).then((r) => {
                    if (r.status !== "approved" || !r.cashAppUrl) throw new Error("not configured");
                    const freshUrl = `${r.cashAppUrl}/${amountNum}`;
                    setHandoffUrl(freshUrl);
                    if (win) win.location.href = freshUrl;
                    else setHandoffError("Your browser blocked Cash App. Allow pop-ups for this site and try again.");
                  }).catch(() => {
                    win?.close();
                    setHandoffUrl(null);
                    setHandoffError("Cash App is not configured for this reunion right now. Contact your organizers for payment instructions.");
                  });
                }}>
                  tap here to open Cash App
                </button>.
              </p>
            )}
            {submitted === "cashapp" && handoffError && (
              <p className="text-sm text-destructive font-medium">{handoffError}</p>
            )}
            {submitted === "cashapp" && !handoffUrl && !handoffError && (
              <p className="text-sm text-muted-foreground">Getting the approved Cash App link...</p>
            )}
            {submitted === "zelle" && (
              <>
                <p className="text-sm text-muted-foreground">
                  Now open your <span className="font-bold text-foreground">banking app</span> and send your
                  Zelle payment. Once the organizers confirm it was received, they'll mark your account as paid.
                </p>
                {freshZelle && <ZelleRecipientCard name={freshZelle.name} contact={freshZelle.contact} amount={amountNum} />}
                {handoffError && <p className="text-sm text-destructive font-medium">{handoffError}</p>}
                {!freshZelle && !handoffError && <p className="text-sm text-muted-foreground">Getting the approved Zelle details...</p>}
              </>
            )}
            {instructions && <SpecialInstructionsNote text={instructions} compact />}
            {submitted === "check" && checkPayee && (
              <p className="text-sm text-muted-foreground">
                Remember to make your check out to{" "}
                <span className="font-bold text-foreground">{checkPayee}</span>.
              </p>
            )}
            {submitted === "cash" && (
              <p className="text-sm text-muted-foreground">
                Thanks! The organizers will use your note to confirm the hand-off.
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Your payment status stays <span className="font-bold uppercase">pending</span> until an
              organizer confirms the payment and marks it paid.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="rounded-full mt-1"
              onClick={() => {
                setSubmitted(null);
                setMethod(null);
                setNote("");
              }}
            >
              Record another payment
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-muted/50 border rounded-3xl p-6">
      <h3 className="font-bold text-sm uppercase tracking-widest text-muted-foreground mb-2">Submit a Payment</h3>
      <p className="text-sm text-muted-foreground mb-4">
        Choose how you're paying and add your details so the organizers can match your payment to
        your account. Your status stays pending until an organizer confirms it.
      </p>

      {instructions && (
        <div className="mb-5">
          <SpecialInstructionsNote text={instructions} compact />
        </div>
      )}

      {(registrations.length + chipIns.length > 1 || branchFees.length > 0) && (
        <div className="mb-5 space-y-2">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
            What does this payment cover?
          </p>
          {registrations.map((r) => (
            <label
              key={`reg-${r.id}`}
              className="flex items-center justify-between gap-3 rounded-xl border bg-background px-4 py-2.5 cursor-pointer hover:bg-muted/50 transition-colors"
            >
              <span className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={selectedIds.includes(r.id)}
                  onChange={() => toggleRegistration(r.id)}
                  className="w-4 h-4 accent-primary"
                />
                <span className="font-medium">{r.label}</span>
              </span>
              <span className="font-bold tabular-nums">${r.amount.toFixed(2)}</span>
            </label>
          ))}
          {chipIns.map((c) => (
            <label
              key={`chip-${c.id}`}
              className="flex items-center justify-between gap-3 rounded-xl border bg-background px-4 py-2.5 cursor-pointer hover:bg-muted/50 transition-colors"
            >
              <span className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={selectedChipInIds.includes(c.id)}
                  onChange={() => toggleChipIn(c.id)}
                  className="w-4 h-4 accent-primary"
                />
                <span className="font-medium">{c.label}</span>
              </span>
              <span className="font-bold tabular-nums">${c.amount.toFixed(2)}</span>
            </label>
          ))}
          {branchFees.map((f) => {
            const on = feeBranchId === f.branchId;
            return (
              <div key={`fee-${f.branchId}`} className={`rounded-xl border px-4 py-2.5 transition-colors ${on ? "bg-background border-primary/50" : "bg-background border-dashed"}`}>
                <label className="flex items-center justify-between gap-3 cursor-pointer">
                  <span className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggleBranchFee(f)}
                      className="w-4 h-4 accent-primary"
                      aria-label={`Add ${f.label} for the ${f.branchName} branch`}
                    />
                    <span>
                      <span className="font-medium">{f.label}</span>
                      <span className="block text-xs text-muted-foreground">
                        Once per branch, shared by everyone in {f.branchName}. Optional.
                      </span>
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="block font-bold tabular-nums">${(f.remainingCents / 100).toFixed(2)}</span>
                    <span className="block text-[10px] uppercase tracking-widest text-muted-foreground">left</span>
                  </span>
                </label>
                {on && (
                  <div className="mt-3 flex items-center gap-2 pl-7">
                    <Label htmlFor={`fee-amt-${f.branchId}`} className="text-xs text-muted-foreground shrink-0">Paying now ($)</Label>
                    <Input
                      id={`fee-amt-${f.branchId}`}
                      inputMode="decimal"
                      value={feeAmount}
                      onChange={(e) => changeFeeAmount(e.target.value)}
                      className="h-8 rounded-lg max-w-[120px] tabular-nums"
                    />
                    <span className="text-xs text-muted-foreground">Part payments are fine.</span>
                  </div>
                )}
              </div>
            );
          })}
          {feeError && method && <p className="text-sm text-destructive font-medium">{feeError}</p>}
          {selectedIds.length + selectedChipInIds.length === 0 && !selectedFee && (
            <p className="text-sm text-destructive font-medium">
              Select at least one item to pay.
            </p>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-5">
        {methods
          .filter((m) => m.available)
          .map((m) => (
            <Button
              key={m.id}
              type="button"
              variant={method === m.id ? "default" : "outline"}
              size="sm"
              className="rounded-full font-bold gap-1.5"
              onClick={() => pickMethod(m.id)}
            >
              {m.icon} {METHOD_LABELS[m.id]}
            </Button>
          ))}
      </div>

      {method && (
        <div className="space-y-4 animate-in fade-in slide-in-from-top-1 duration-200">
          {method === "cashapp" && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-900/50 p-3 flex gap-2 text-sm text-amber-900 dark:text-amber-200">
              <Info className="w-4 h-4 shrink-0 mt-0.5" />
              <p>
                <span className="font-bold">Heads up:</span> Cash App caps <span className="font-bold">unverified</span> accounts
                at <span className="font-bold">$250 per rolling 7-day window</span>. If you're sending more than $250,
                verify your Cash App account first to lift the limit. This limit is set by Cash App —
                not by this family reunion app.
              </p>
            </div>
          )}
          {method === "zelle" && zelle && (
            <ZelleRecipientCard name={zelle.name} contact={zelle.contact} amount={validAmount ? amountNum : null} />
          )}
          {method === "zelle" && (
            <p className="text-sm text-muted-foreground">
              Below, enter the Zelle ID (email or phone number) you'll be sending from. The organizers use it
              to confirm your payment arrived and mark your account as paid.
            </p>
          )}
          {method === "check" && checkPayee && (
            <div className="rounded-xl border bg-background p-3 text-sm">
              <span className="text-muted-foreground">Make payment out to</span>
              <span className="block font-bold text-lg">{checkPayee}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="pay-amount">Amount ($)</Label>
              <Input
                id="pay-amount"
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="rounded-xl bg-background"
              />
            </div>
            {method === "cashapp" && (
              <div className="space-y-1.5">
                <Label htmlFor="pay-ref">Your own $cashtag (who is paying)</Label>
                <Input
                  id="pay-ref"
                  placeholder="$yourcashtag"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  className="rounded-xl bg-background"
                />
                <p className="text-xs text-muted-foreground">Helps organizers match your payment. This does not change who receives it.</p>
              </div>
            )}
            {method === "zelle" && (
              <div className="space-y-1.5">
                <Label htmlFor="pay-ref">Your Zelle ID (email or phone)</Label>
                <Input
                  id="pay-ref"
                  placeholder="you@example.com or 555-123-4567"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  className="rounded-xl bg-background"
                />
              </div>
            )}
            {method === "check" && (
              <div className="space-y-1.5">
                <Label htmlFor="pay-ref">Check number (optional)</Label>
                <Input
                  id="pay-ref"
                  placeholder="e.g. 1042"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  className="rounded-xl bg-background"
                />
              </div>
            )}
            {method === "cash" && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="pay-ref">Who did you give the cash to?</Label>
                  <Input
                    id="pay-ref"
                    placeholder="e.g. Aunt Denise"
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    className="rounded-xl bg-background"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pay-date">Date given</Label>
                  <Input
                    id="pay-date"
                    type="date"
                    value={givenDate}
                    onChange={(e) => setGivenDate(e.target.value)}
                    className="rounded-xl bg-background"
                  />
                </div>
              </>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pay-note">Note (optional)</Label>
            <Textarea
              id="pay-note"
              placeholder="Anything that helps the organizers match your payment"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="rounded-xl bg-background min-h-[70px]"
            />
            <p className="text-xs text-muted-foreground">
              Your details and notes are saved for the organizers to reconcile payments.
            </p>
          </div>

          {error && <p className="text-sm text-destructive font-medium">{error}</p>}

          <Button
            className="w-full rounded-full py-5 font-bold"
            disabled={!canSubmit}
            onClick={handleSubmit}
          >
            {isSaving
              ? "Saving..."
              : method === "cashapp"
                ? "Submit & Open Cash App"
                : "Submit Payment"}
          </Button>
        </div>
      )}
    </div>
  );
}
