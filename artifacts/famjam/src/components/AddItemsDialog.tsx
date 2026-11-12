import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  getRegistration,
  getGetRegistrationQueryKey,
  getReunionByCode,
  getGetReunionByCodeQueryKey,
  useQuoteRegistrationItems,
  useAddRegistrationItems,
  type Registration,
  type ReunionFee,
  type RegistrationItemSelection,
  type RegistrationItemsQuote,
} from "@workspace/api-client-react";
import { AlertTriangle, CheckCircle2, Lock, PackagePlus, RefreshCw, ShoppingBag } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";
import { AddOnPicker, AddOnPurchaseList } from "./AddOnPicker";
import { centsLabel, offeredAddOns, type AddOnPicks } from "../lib/addOns";
import { invalidateRegistrationTotals } from "./payments/money";

type Draft = Record<string, AddOnPicks>; // "h" household, "a:<id>" attendee
type Snapshot = { reg: Registration; fees: ReunionFee[] };

const newRequestId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;

const errStatus = (e: unknown) => (e as { status?: number })?.status;
const errMessage = (e: unknown, fallback: string) =>
  (e as { data?: { error?: string } })?.data?.error ?? fallback;

function draftItems(draft: Draft): RegistrationItemSelection[] {
  const out: RegistrationItemSelection[] = [];
  for (const [key, picks] of Object.entries(draft)) {
    const attendeeId = key === "h" ? null : Number(key.slice(2));
    for (const [feeId, choices] of Object.entries(picks)) {
      out.push({
        attendeeId,
        feeId: Number(feeId),
        choices: Object.entries(choices).filter(([, v]) => !!v).map(([groupId, valueId]) => ({ groupId, valueId })),
      });
    }
  }
  return out;
}

function draftProblems(draft: Draft, fees: ReunionFee[]): string[] {
  const problems: string[] = [];
  for (const picks of Object.values(draft)) {
    for (const [k, choices] of Object.entries(picks)) {
      const fee = fees.find((f) => f.id === Number(k));
      if (!fee || fee.retired) { problems.push(`${fee?.label ?? "An item"} is no longer offered.`); continue; }
      for (const g of fee.optionGroups ?? []) {
        const v = g.values.find((x) => x.id === choices[g.id]);
        if (!v) problems.push(`Choose a ${g.label.toLowerCase()} for ${fee.label}.`);
        else if (!v.active) problems.push(`${v.label} is no longer available for ${fee.label}.`);
      }
    }
  }
  return [...new Set(problems)];
}

/** Drop picks the fresh registration/catalog no longer allows; keep valid choices. */
function reconcileDraft(draft: Draft, snap: Snapshot): { draft: Draft; removed: string[] } {
  const out: Draft = {};
  const removed: string[] = [];
  for (const [key, picks] of Object.entries(draft)) {
    const isHouse = key === "h";
    const attendee = isHouse ? null : snap.reg.attendees.find((a) => a.id === Number(key.slice(2)));
    const name = isHouse ? "the household" : attendee?.name ?? "a removed attendee";
    const saved = isHouse ? snap.reg.addOns ?? [] : attendee?.addOns ?? [];
    const offered = offeredAddOns(snap.fees, isHouse ? "household" : "attendee");
    const next: AddOnPicks = {};
    for (const [k, choices] of Object.entries(picks)) {
      const feeId = Number(k);
      const any = snap.fees.find((f) => f.id === feeId);
      const label = any?.label ?? "An item";
      if (!isHouse && !attendee) { removed.push(`${label} for ${name} was removed: that attendee is no longer on this registration.`); continue; }
      const fee = offered.find((f) => f.id === feeId);
      if (!fee) { removed.push(`${label} for ${name} was removed: it is no longer offered${any && !any.retired ? " for this recipient" : ""}.`); continue; }
      if (saved.some((p) => p.feeId === feeId)) { removed.push(`${label} for ${name} was removed: it is already purchased.`); continue; }
      const kept: Record<string, string> = {};
      let cleared = false;
      for (const [gid, vid] of Object.entries(choices)) {
        const g = (fee.optionGroups ?? []).find((x) => x.id === gid);
        const v = g?.values.find((x) => x.id === vid);
        if (g && v && v.active) kept[gid] = vid;
        else if (g) cleared = true;
      }
      if (cleared) removed.push(`A choice for ${label} (${name}) is no longer available. Pick again.`);
      next[feeId] = kept;
    }
    if (Object.keys(next).length > 0) out[key] = next;
  }
  return { draft: out, removed };
}

/**
 * Add-only merchandise flow shared by registrants and organizers. Loads a fresh
 * registration and catalog on every open; the draft is never overwritten by refetches.
 */
export function AddItemsDialog({
  registrationId,
  open,
  onOpenChange,
  paymentHref,
  onPaymentLink,
}: {
  registrationId: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Where the success state links to for paying the remaining balance. */
  paymentHref?: string;
  /** Called when the payment link is followed (e.g. to close and scroll). */
  onPaymentLink?: () => void;
}) {
  const qc = useQueryClient();
  const quoteMutation = useQuoteRegistrationItems();
  const addMutation = useAddRegistrationItems();

  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<Draft>({});
  const [quote, setQuote] = useState<RegistrationItemsQuote | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [ambiguous, setAmbiguous] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [removedNotes, setRemovedNotes] = useState<string[]>([]);
  const [saved, setSaved] = useState<RegistrationItemsQuote | null>(null);
  const requestId = useRef<string>(newRequestId());
  const loadSeq = useRef(0);

  const load = async (keepDraft: boolean) => {
    if (registrationId == null) return;
    const seq = ++loadSeq.current;
    setLoading(true);
    setLoadError(null);
    try {
      const reg = await qc.fetchQuery({
        queryKey: getGetRegistrationQueryKey(registrationId),
        queryFn: () => getRegistration(registrationId),
        staleTime: 0,
      });
      const reunion = reg.reunionCode
        ? await qc.fetchQuery({
            queryKey: getGetReunionByCodeQueryKey(reg.reunionCode),
            queryFn: () => getReunionByCode(reg.reunionCode!),
            staleTime: 0,
          })
        : null;
      if (seq !== loadSeq.current) return;
      const fresh = { reg, fees: reunion?.fees ?? [] };
      setSnap(fresh);
      if (!keepDraft) setDraft({});
      else {
        setDraft((d) => {
          const { draft: next, removed } = reconcileDraft(d, fresh);
          setRemovedNotes(removed);
          return next;
        });
      }
    } catch (e) {
      if (seq !== loadSeq.current) return;
      setLoadError(errMessage(e, "We couldn't load this registration and the item list."));
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  };

  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    if (!open) return;
    setSnap(null);
    setDraft({});
    setQuote(null);
    setConfirmed(false);
    setError(null);
    setNotice(null);
    setAmbiguous(false);
    setShowErrors(false);
    setSaved(null);
    setRemovedNotes([]);
    requestId.current = newRequestId();
    loadRef.current(false);
  }, [open, registrationId]);

  const pending = quoteMutation.isPending || addMutation.isPending;
  const locked = pending || ambiguous;

  const changeDraft = (key: string, picks: AddOnPicks) => {
    if (locked) return;
    setDraft((d) => {
      const next = { ...d };
      if (Object.keys(picks).length === 0) delete next[key];
      else next[key] = picks;
      return next;
    });
    setQuote(null);
    setConfirmed(false);
    setError(null);
    setRemovedNotes([]);
    requestId.current = newRequestId();
  };

  const reg = snap?.reg;
  const fees = snap?.fees ?? [];
  const items = draftItems(draft);
  const problems = snap ? draftProblems(draft, fees) : [];
  const attendeeOffered = offeredAddOns(fees, "attendee");
  const householdOffered = offeredAddOns(fees, "household");
  const recipients = reg
    ? [
        ...reg.attendees
          .filter((a) => a.id != null)
          .map((a) => ({ key: `a:${a.id}`, name: a.name, saved: a.addOns ?? [], scope: "attendee" as const })),
        { key: "h", name: "Household", saved: reg.addOns ?? [], scope: "household" as const },
      ]
    : [];
  const anyAvailable = recipients.some((r) =>
    (r.scope === "attendee" ? attendeeOffered : householdOffered).some((f) => !r.saved.some((p) => p.feeId === f.id)),
  );

  const requestQuote = async () => {
    if (!reg) return;
    setShowErrors(true);
    setError(null);
    setNotice(null);
    if (items.length === 0) { setError("Choose at least one item to add."); return; }
    if (problems.length > 0) { setError(problems[0]); return; }
    try {
      const q = await quoteMutation.mutateAsync({ id: reg.id, data: { items } });
      setQuote(q);
      setConfirmed(false);
      requestId.current = newRequestId();
    } catch (e) {
      setQuote(null);
      setConfirmed(false);
      const st = errStatus(e);
      if (st === 409 || st === 400) {
        setNotice(errMessage(e, "The item list changed. We refreshed it. Review your picks and get a new total."));
        await load(true);
      } else setError(errMessage(e, "We couldn't price these items. Check your connection and try again."));
    }
  };

  const save = async () => {
    if (!reg || !quote || !confirmed) return;
    setError(null);
    setNotice(null);
    try {
      const result = await addMutation.mutateAsync({
        id: reg.id,
        data: { items, quoteToken: quote.quoteToken, requestId: requestId.current },
      });
      setAmbiguous(false);
      setSaved(result);
      invalidateRegistrationTotals(qc, reg.reunionId, reg.id);
      qc.invalidateQueries({ queryKey: getGetRegistrationQueryKey(reg.id) });
    } catch (e) {
      const status = errStatus(e);
      if (status === 409 || status === 400) {
        setAmbiguous(false);
        setQuote(null);
        setConfirmed(false);
        requestId.current = newRequestId();
        setNotice(errMessage(e, "Prices or availability changed since your total was shown. We refreshed the list. Review and confirm the new total."));
        await load(true);
      } else if (status && status >= 400 && status < 500) {
        setAmbiguous(false);
        setQuote(null);
        setConfirmed(false);
        requestId.current = newRequestId();
        setError(errMessage(e, "These items couldn't be added."));
      } else {
        // Unknown outcome: keep the same request ID so a retry can't duplicate.
        setAmbiguous(true);
        setError("We couldn't confirm whether the save went through. Retrying is safe and will not add the items twice.");
      }
    }
  };

  const close = () => { if (!pending) onOpenChange(false); };

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(true) : close())}>
      <DialogContent
        className="rounded-3xl p-0 max-w-xl w-[calc(100vw-1.5rem)] max-h-[92dvh] flex flex-col overflow-hidden"
        data-testid="dialog-add-items"
      >
        <DialogHeader className="px-6 pt-6 pb-3 text-left">
          <DialogTitle className="font-serif text-2xl flex items-center gap-2">
            <PackagePlus className="w-5 h-5 text-primary" aria-hidden /> Add items
          </DialogTitle>
          <DialogDescription>
            Add merchandise to this registration. Attendees, dinners, and what's already purchased stay exactly as they are.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto overscroll-contain px-6 pb-4 space-y-5">
          {loading && !snap && (
            <div className="space-y-3" data-testid="status-add-items-loading">
              <Skeleton className="h-16 rounded-2xl" />
              <Skeleton className="h-24 rounded-2xl" />
              <Skeleton className="h-16 rounded-2xl" />
            </div>
          )}

          {loadError && (
            <div role="alert" className="rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm">
              <p className="font-bold text-destructive">{loadError}</p>
              <Button variant="outline" size="sm" className="mt-3 rounded-xl" onClick={() => load(true)} data-testid="button-add-items-retry-load">
                <RefreshCw className="w-4 h-4 mr-2" /> Try again
              </Button>
            </div>
          )}

          {saved && reg && (
            <div className="space-y-4" data-testid="status-add-items-success">
              <div className="rounded-2xl border border-emerald-300 bg-emerald-50 p-4 flex gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" aria-hidden />
                <div className="text-sm text-emerald-950">
                  <p className="font-bold">Items added to registration #{reg.id}.</p>
                  <p>Saving is not a payment. Nothing has been charged or marked paid.</p>
                </div>
              </div>
              <QuoteLines quote={saved} />
              <QuoteTotals quote={saved} />
              {saved.balanceCents > 0 && paymentHref && (
                <Link
                  href={paymentHref}
                  onClick={() => { onOpenChange(false); onPaymentLink?.(); }}
                  className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground hover:bg-primary/90"
                  data-testid="link-add-items-payment"
                >
                  See payment instructions for the {centsLabel(saved.balanceCents)} still due
                </Link>
              )}
            </div>
          )}

          {!saved && reg && (
            <>
              {reg.status !== "active" ? (
                <Blocked text="This registration is cancelled, so items can't be added." />
              ) : reg.canAddItems === false ? (
                <Blocked text="Adding items after registering is turned off for this event. Contact an organizer and they can add items for you." />
              ) : !anyAvailable ? (
                <div className="rounded-2xl border border-dashed p-6 text-center" data-testid="status-add-items-empty">
                  <ShoppingBag className="w-8 h-8 mx-auto text-muted-foreground mb-2" aria-hidden />
                  <p className="font-bold">Nothing new to add right now</p>
                  <p className="text-sm text-muted-foreground">Every item currently offered is already on this registration, or the organizers haven't listed any.</p>
                </div>
              ) : (
                recipients.map((r) => {
                  const offered = (r.scope === "attendee" ? attendeeOffered : householdOffered).filter((f) => !r.saved.some((p) => p.feeId === f.id));
                  if (offered.length === 0 && r.saved.length === 0) return null;
                  return (
                    <section key={r.key} className="rounded-2xl border bg-card p-4 space-y-3" data-testid={`section-add-items-${r.key.replace(":", "-")}`}>
                      <div className="flex items-baseline justify-between gap-2">
                        <h3 className="font-bold break-words">{r.name}</h3>
                        <span className="text-[11px] uppercase tracking-widest text-muted-foreground">{r.scope === "household" ? "Household items" : "Attendee items"}</span>
                      </div>
                      {r.saved.length > 0 && (
                        <div className="rounded-xl bg-muted/40 p-3">
                          <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5">
                            <Lock className="w-3 h-3" aria-hidden /> Already purchased
                          </div>
                          <AddOnPurchaseList items={r.saved} testIdPrefix={`add-items-saved-${r.key.replace(":", "-")}`} />
                        </div>
                      )}
                      {offered.length > 0 ? (
                        <AddOnPicker
                          fees={fees}
                          scope={r.scope}
                          picks={draft[r.key] ?? {}}
                          onChange={(next) => changeDraft(r.key, next)}
                          saved={r.saved}
                          addOnly
                          disabled={locked}
                          showErrors={showErrors}
                          testIdPrefix={`add-items-${r.key.replace(":", "-")}`}
                        />
                      ) : (
                        <p className="text-sm text-muted-foreground">Everything offered is already purchased here.</p>
                      )}
                    </section>
                  );
                })
              )}

              {quote && (
                <div className="space-y-3 rounded-2xl border-2 border-primary/40 bg-primary/[0.04] p-4" data-testid="panel-add-items-quote">
                  <h3 className="font-serif text-lg font-bold">Review before saving</h3>
                  <QuoteLines quote={quote} />
                  <QuoteTotals quote={quote} />
                  <label className="flex items-start gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 accent-[var(--fj-brand)]"
                      checked={confirmed}
                      disabled={pending || ambiguous}
                      onChange={(e) => setConfirmed(e.target.checked)}
                      data-testid="checkbox-add-items-confirm"
                    />
                    <span>I confirm adding these items for {centsLabel(quote.addedCostCents)}. I understand saving does not pay for them.</span>
                  </label>
                </div>
              )}
            </>
          )}

          {notice && (
            <div role="status" className="rounded-2xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 flex gap-2" data-testid="status-add-items-notice">
              <RefreshCw className="w-4 h-4 shrink-0 mt-0.5" aria-hidden /> {notice}
            </div>
          )}
          {removedNotes.length > 0 && !saved && (
            <div role="status" className="rounded-2xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950" data-testid="status-add-items-removed">
              <p className="font-bold mb-1">Some picks changed after refreshing:</p>
              <ul className="list-disc pl-5 space-y-0.5">{removedNotes.map((n, i) => <li key={i}>{n}</li>)}</ul>
            </div>
          )}
          {error && (
            <div role="alert" className="rounded-2xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive font-medium flex gap-2" data-testid="status-add-items-error">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden /> {error}
            </div>
          )}
        </div>

        <div className="border-t bg-card px-6 py-4 flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <Button variant="ghost" className="rounded-xl" onClick={close} disabled={pending} data-testid="button-add-items-close">
            {saved ? "Done" : "Cancel"}
          </Button>
          {!saved && reg && reg.status === "active" && reg.canAddItems !== false && anyAvailable && (
            quote ? (
              <Button className="rounded-xl" onClick={save} disabled={!confirmed || pending} data-testid="button-add-items-save">
                {addMutation.isPending ? "Saving..." : ambiguous ? "Retry save" : `Save items (${centsLabel(quote.addedCostCents)})`}
              </Button>
            ) : (
              <Button className="rounded-xl" onClick={requestQuote} disabled={pending || loading || items.length === 0} data-testid="button-add-items-quote">
                {quoteMutation.isPending ? "Checking prices..." : items.length === 0 ? "Choose items" : `Review total (${items.length} item${items.length === 1 ? "" : "s"})`}
              </Button>
            )
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Blocked({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed p-5 flex gap-3 text-sm" data-testid="status-add-items-blocked">
      <Lock className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" aria-hidden />
      <p>{text}</p>
    </div>
  );
}

function QuoteLines({ quote }: { quote: RegistrationItemsQuote }) {
  return (
    <ul className="space-y-2 text-sm" data-testid="list-add-items-lines">
      {quote.lines.map((l, i) => (
        <li key={`${l.attendeeId ?? "h"}-${l.purchase.feeId}-${i}`}>
          <div className="text-[11px] uppercase tracking-widest text-muted-foreground">{l.recipient}</div>
          <AddOnPurchaseList items={[l.purchase]} testIdPrefix={`add-items-line-${i}`} />
        </li>
      ))}
    </ul>
  );
}

function Row({ label, cents, strong, testId, negative }: { label: string; cents: number; strong?: boolean; testId: string; negative?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${strong ? "font-bold text-base border-t pt-2 mt-1" : ""}`}>
      <span>{label}</span>
      <span className="tabular-nums" data-testid={testId}>{negative && cents > 0 ? "-" : ""}{centsLabel(cents)}</span>
    </div>
  );
}

function QuoteTotals({ quote }: { quote: RegistrationItemsQuote }) {
  return (
    <div className="rounded-xl bg-card border p-3 text-sm space-y-1" data-testid="panel-add-items-totals">
      <Row label="Current charges" cents={quote.currentChargeCents} testId="text-quote-current" />
      <Row label="Items being added" cents={quote.addedCostCents} testId="text-quote-added" />
      <Row label="New total charges" cents={quote.totalChargeCents} testId="text-quote-total" />
      {quote.confirmedCents > 0 && <Row label="Payments already confirmed" cents={quote.confirmedCents} testId="text-quote-confirmed" negative />}
      {quote.legacyCreditCents > 0 && <Row label="Earlier paid credit" cents={quote.legacyCreditCents} testId="text-quote-legacy" negative />}
      {quote.sponsoredCents > 0 && <Row label="Sponsored" cents={quote.sponsoredCents} testId="text-quote-sponsored" negative />}
      <Row label="Balance still due" cents={quote.balanceCents} testId="text-quote-balance" strong />
      {quote.creditCents > 0 && (
        <p className="text-xs text-muted-foreground" data-testid="text-quote-credit">
          {centsLabel(quote.creditCents)} of earlier overpayment remains as credit after these items.
        </p>
      )}
      {quote.waived && (
        <p className="text-xs text-muted-foreground" data-testid="text-quote-waived">
          This registration's fees are waived, so the organizers' waiver rules decide what, if anything, is owed for added items.
        </p>
      )}
    </div>
  );
}
