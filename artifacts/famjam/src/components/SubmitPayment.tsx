import { useState } from "react";
import {
  useCreatePaymentSubmission,
  useCreateContributionPaymentSubmission,
} from "@workspace/api-client-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
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

export function SubmitPayment({
  reunionId,
  registrations,
  chipIns = [],
  cashAppTag,
  checkPayee,
}: {
  reunionId: number;
  /** Unpaid registrations (each amount includes its own fund chip-ins). */
  registrations: PayableRegistration[];
  /** Pending standalone fund chip-ins, payable like registrations. */
  chipIns?: PayableChipIn[];
  cashAppTag: string | null;
  checkPayee: string | null;
}) {
  const [method, setMethod] = useState<Method | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>(registrations.map((r) => r.id));
  const [selectedChipInIds, setSelectedChipInIds] = useState<number[]>(chipIns.map((c) => c.id));
  const computeSelectedTotal = (regIds: number[], chipInIds: number[]) =>
    registrations.filter((r) => regIds.includes(r.id)).reduce((sum, r) => sum + r.amount, 0) +
    chipIns.filter((c) => chipInIds.includes(c.id)).reduce((sum, c) => sum + c.amount, 0);
  const selectedTotal = computeSelectedTotal(selectedIds, selectedChipInIds);
  const [amount, setAmount] = useState(String(selectedTotal > 0 ? selectedTotal : ""));

  const toggleRegistration = (id: number) => {
    setSelectedIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      const nextTotal = computeSelectedTotal(next, selectedChipInIds);
      setAmount(String(nextTotal > 0 ? nextTotal : ""));
      return next;
    });
  };
  const toggleChipIn = (id: number) => {
    setSelectedChipInIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      const nextTotal = computeSelectedTotal(selectedIds, next);
      setAmount(String(nextTotal > 0 ? nextTotal : ""));
      return next;
    });
  };
  const [reference, setReference] = useState("");
  const [givenDate, setGivenDate] = useState("");
  const [note, setNote] = useState("");
  const [submitted, setSubmitted] = useState<Method | null>(null);
  const [error, setError] = useState<string | null>(null);

  const createSubmission = useCreatePaymentSubmission();
  const createChipInSubmission = useCreateContributionPaymentSubmission();
  const isSaving = createSubmission.isPending || createChipInSubmission.isPending;

  const methods: { id: Method; icon: React.ReactNode; available: boolean }[] = [
    { id: "cashapp", icon: <DollarSign className="w-4 h-4" />, available: !!cashAppTag },
    { id: "zelle", icon: <Landmark className="w-4 h-4" />, available: true },
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

  const amountNum = Math.floor(Number(amount));
  const validAmount = Number.isFinite(amountNum) && amountNum >= 1;
  const referenceRequired = method === "cashapp" || method === "zelle" || method === "cash";
  const canSubmit =
    !!method &&
    selectedIds.length + selectedChipInIds.length > 0 &&
    validAmount &&
    (!referenceRequired || reference.trim().length > 0) &&
    (method !== "cash" || givenDate.trim().length > 0) &&
    !isSaving;

  const handleSubmit = () => {
    if (!method || !canSubmit) return;
    setError(null);
    const callbacks = {
      onSuccess: () => {
        setSubmitted(method);
        if (method === "cashapp" && cashAppTag) {
          // Deep link opens Cash App with the recipient and amount prefilled
          window.open(
            `https://cash.app/$${cashAppTag.replace(/^\$/, "")}/${amountNum}`,
            "_blank",
            "noopener",
          );
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
    if (selectedIds.length > 0) {
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
            {submitted === "cashapp" && (
              <p className="text-sm text-muted-foreground">
                Cash App should have opened with the amount prefilled — complete the payment there.
                If it didn't open,{" "}
                <a
                  href={`https://cash.app/$${(cashAppTag ?? "").replace(/^\$/, "")}/${amountNum}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary font-bold hover:underline"
                >
                  tap here to open Cash App
                </a>.
              </p>
            )}
            {submitted === "zelle" && (
              <p className="text-sm text-muted-foreground">
                Now open your <span className="font-bold text-foreground">banking app</span> and send your
                Zelle payment. Once the organizers confirm it was received, they'll mark your account as paid.
              </p>
            )}
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

      {registrations.length + chipIns.length > 1 && (
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
              <span className="font-bold tabular-nums">${r.amount}</span>
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
              <span className="font-bold tabular-nums">${c.amount}</span>
            </label>
          ))}
          {selectedIds.length + selectedChipInIds.length === 0 && (
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
          {method === "zelle" && (
            <p className="text-sm text-muted-foreground">
              Enter the Zelle ID (email or phone number) you'll be sending from. The organizers use it
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
                type="number"
                min="1"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="rounded-xl bg-background"
              />
            </div>
            {method === "cashapp" && (
              <div className="space-y-1.5">
                <Label htmlFor="pay-ref">Your Cash App $cashtag</Label>
                <Input
                  id="pay-ref"
                  placeholder="$yourcashtag"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  className="rounded-xl bg-background"
                />
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
