import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetMyPaymentOwnerCapability,
  useOwnerListPaymentRecipients,
  useOwnerGetPaymentRecipient,
  useOwnerListPaymentRecipientHistory,
  useOwnerSavePaymentRecipient,
  useOwnerDisablePaymentRecipient,
  getOwnerListPaymentRecipientsQueryKey,
  getOwnerGetPaymentRecipientQueryKey,
  getOwnerListPaymentRecipientHistoryQueryKey,
  type OwnerRecipientDetail,
  type PaymentRecipientValues,
  type PaymentRecipientStatus,
} from "@workspace/api-client-react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Textarea } from "../../components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { ArrowLeft, History, Lock, Search, ShieldCheck, AlertTriangle, RefreshCw, ExternalLink } from "lucide-react";

/* Owner-only screen. The server enforces authority; this UI only reflects it. */

const STATUS_STYLE: Record<PaymentRecipientStatus, { label: string; bg: string; fg: string }> = {
  approved: { label: "Approved", bg: "#E3F0E6", fg: "#24653A" },
  pending_review: { label: "Needs review", bg: "#FCEFD2", fg: "#8A5A00" },
  disabled: { label: "Disabled", bg: "#F3DDE3", fg: "#9E3A54" },
};

function StatusPill({ status }: { status: PaymentRecipientStatus }) {
  const s = STATUS_STYLE[status];
  return (
    <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-extrabold uppercase tracking-wider" style={{ background: s.bg, color: s.fg }}>
      {s.label}
    </span>
  );
}

function errorMessage(err: unknown, fallback: string) {
  const e = err as { status?: number; data?: { error?: string } } | null;
  return { status: e?.status, message: e?.data?.error ?? fallback };
}

// Client-side preview mirrors the server rules; the server remains authoritative.
function previewCashAppUrl(tag: string) {
  const t = tag.trim().replace(/^\$/, "");
  return /^(?=.*[A-Za-z])[A-Za-z0-9]{1,20}$/.test(t) ? `https://cash.app/$${t}` : null;
}

function ValuesTable({ values, emptyLabel = "Not set" }: { values: PaymentRecipientValues; emptyLabel?: string }) {
  const rows: [string, string | null][] = [
    ["Cash App tag", values.cashAppTag ? `$${values.cashAppTag}` : null],
    ["Payment label", values.paymentHandle],
    ["Payment link", values.paymentUrl],
  ];
  return (
    <dl className="space-y-1.5 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="grid grid-cols-[110px_1fr] gap-2">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className={v ? "font-mono break-all" : "text-muted-foreground italic"}>{v ?? emptyLabel}</dd>
        </div>
      ))}
    </dl>
  );
}

function RecipientEditor({ detail, onBack }: { detail: OwnerRecipientDetail; onBack: () => void }) {
  const qc = useQueryClient();
  const id = detail.reunionId;
  const history = useOwnerListPaymentRecipientHistory(id, { query: { queryKey: getOwnerListPaymentRecipientHistoryQueryKey(id) } });
  const save = useOwnerSavePaymentRecipient();
  const disable = useOwnerDisablePaymentRecipient();

  const [tag, setTag] = useState(detail.current.cashAppTag ?? "");
  const [handle, setHandle] = useState(detail.current.paymentHandle ?? "");
  const [url, setUrl] = useState(detail.current.paymentUrl ?? "");
  const [note, setNote] = useState("");
  const [confirmSave, setConfirmSave] = useState(false);
  const [confirmDisable, setConfirmDisable] = useState<"cashapp" | "all" | null>(null);
  const [error, setError] = useState<{ status?: number; message: string } | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  // Reset the form whenever a different version is loaded (after save or reload).
  useEffect(() => {
    setTag(detail.current.cashAppTag ?? "");
    setHandle(detail.current.paymentHandle ?? "");
    setUrl(detail.current.paymentUrl ?? "");
  }, [detail.reunionId, detail.version]); // eslint-disable-line react-hooks/exhaustive-deps

  const proposed: PaymentRecipientValues = {
    cashAppTag: tag.trim().replace(/^\$/, "") || null,
    paymentHandle: handle.trim() || null,
    paymentUrl: url.trim() || null,
  };
  const hasAny = !!(proposed.cashAppTag || proposed.paymentHandle || proposed.paymentUrl);
  const cashPreview = proposed.cashAppTag ? previewCashAppUrl(proposed.cashAppTag) : null;
  const effectiveLink = proposed.paymentUrl ?? cashPreview;
  const unchanged =
    detail.status === "approved" &&
    proposed.cashAppTag === detail.current.cashAppTag &&
    proposed.paymentHandle === detail.current.paymentHandle &&
    proposed.paymentUrl === detail.current.paymentUrl;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: getOwnerGetPaymentRecipientQueryKey(id) });
    qc.invalidateQueries({ queryKey: getOwnerListPaymentRecipientHistoryQueryKey(id) });
    qc.invalidateQueries({ queryKey: getOwnerListPaymentRecipientsQueryKey() });
  };
  const onDone = (msg: string) => (next: OwnerRecipientDetail) => {
    qc.setQueryData(getOwnerGetPaymentRecipientQueryKey(id), next);
    refresh();
    setNote("");
    setError(null);
    setSaved(msg);
  };
  const onFail = (err: unknown) => {
    setError(errorMessage(err, "Could not save. Nothing was changed."));
    setConfirmSave(false);
    setConfirmDisable(null);
  };

  const doSave = () =>
    save.mutate(
      { reunionId: id, data: { ...proposed, expectedVersion: detail.version, confirm: true, note: note.trim() || null } },
      { onSuccess: (d) => { setConfirmSave(false); onDone("Recipient saved. Payers now see the new destination.")(d); }, onError: onFail },
    );
  const doDisable = (scope: "cashapp" | "all") =>
    disable.mutate(
      { reunionId: id, data: { scope, expectedVersion: detail.version, confirm: true, note: note.trim() || null } },
      {
        onSuccess: (d) => {
          setConfirmDisable(null);
          onDone(scope === "all" ? "All payment links disabled." : "Cash App disabled.")(d);
        },
        onError: onFail,
      },
    );

  const hasLegacy = !!(detail.legacy.cashAppTag || detail.legacy.paymentHandle || detail.legacy.paymentUrl);
  const cashAppOn = detail.status === "approved" && !!detail.current.cashAppTag;
  const genericKept = cashAppOn && !!(
    (detail.current.paymentHandle && !/^\$/.test(detail.current.paymentHandle)) ||
    (detail.current.paymentUrl && !/^https:\/\/(www\.)?cash\.app\//i.test(detail.current.paymentUrl))
  );

  return (
    <div className="space-y-5">
      <button onClick={onBack} className="md:hidden inline-flex items-center gap-1 text-sm font-bold" style={{ color: "var(--fj-brand)" }}>
        <ArrowLeft className="w-4 h-4" /> All reunions
      </button>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-2xl font-semibold leading-tight" style={{ fontFamily: "var(--font-serif)" }}>{detail.reunionName}</h2>
          <p className="text-sm text-muted-foreground font-mono">{detail.reunionCode} · v{detail.version}</p>
        </div>
        <StatusPill status={detail.status} />
      </header>

      {error && (
        <div role="alert" className="rounded-2xl border p-4 text-sm flex gap-3" style={{ background: "#FBEAEE", borderColor: "var(--fj-berry-soft)", color: "var(--fj-berry-shadow)" }}>
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="space-y-2">
            <p className="font-bold">{error.status === 409 ? "Someone else changed this recipient." : "Not saved."}</p>
            <p>{error.message}</p>
            {error.status === 409 && (
              <Button size="sm" variant="outline" className="rounded-full gap-1.5" onClick={() => { setError(null); refresh(); }}>
                <RefreshCw className="w-3.5 h-3.5" /> Reload latest
              </Button>
            )}
          </div>
        </div>
      )}
      {saved && !error && (
        <p role="status" className="rounded-2xl px-4 py-3 text-sm font-bold" style={{ background: "#E3F0E6", color: "#24653A" }}>{saved}</p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border bg-card p-4">
          <h3 className="text-xs font-extrabold uppercase tracking-widest text-muted-foreground mb-3">Live for payers</h3>
          {detail.resolved.status === "approved" ? (
            <ValuesTable values={{ cashAppTag: detail.resolved.cashAppTag, paymentHandle: detail.resolved.paymentHandle, paymentUrl: detail.resolved.paymentUrl }} />
          ) : (
            <p className="text-sm text-muted-foreground">Nothing. Payers see "payment is not configured" and are told to contact organizers.</p>
          )}
        </section>
        {hasLegacy && (
          <section className="rounded-2xl border p-4" style={{ background: "#FFF8E8", borderColor: "#F1DDAA" }}>
            <h3 className="text-xs font-extrabold uppercase tracking-widest mb-1" style={{ color: "#8A5A00" }}>Legacy values (review only)</h3>
            <p className="text-xs mb-3" style={{ color: "#8A5A00" }}>Entered before owner control. Never shown to payers. Verify independently before copying.</p>
            <ValuesTable values={detail.legacy} />
            <Button size="sm" variant="outline" className="rounded-full mt-3" onClick={() => {
              setTag(detail.legacy.cashAppTag ?? "");
              setHandle(detail.legacy.paymentHandle ?? "");
              setUrl(detail.legacy.paymentUrl ?? "");
            }}>
              Copy into form
            </Button>
          </section>
        )}
      </div>

      <section className="rounded-2xl border bg-card p-4 space-y-4">
        <h3 className="text-xs font-extrabold uppercase tracking-widest text-muted-foreground">Approved destination</h3>
        <p className="text-sm text-muted-foreground">Fill any combination. Cash App needs a $Cashtag. Use the label and link for a non-Cash App destination such as a bank or fundraising page.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="own-tag">Cash App $Cashtag</Label>
            <Input id="own-tag" value={tag} onChange={(e) => setTag(e.target.value)} placeholder="$FamilyFund" autoComplete="off" className="rounded-xl text-base" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="own-handle">Payment label (optional)</Label>
            <Input id="own-handle" value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="Family Fund at First Bank" maxLength={120} className="rounded-xl text-base" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="own-url">Payment link (optional, https)</Label>
            <Input id="own-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." inputMode="url" maxLength={300} className="rounded-xl text-base" />
            <p className="text-xs text-muted-foreground">Any cash.app link must use the same $Cashtag. Lookalike Cash App domains are rejected.</p>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="own-note">Audit note (optional)</Label>
            <Textarea id="own-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Verified with the treasurer by phone" className="rounded-xl min-h-[60px] text-base" />
          </div>
        </div>
        <div className="rounded-xl border border-dashed p-3 text-sm">
          <p className="text-xs font-extrabold uppercase tracking-widest text-muted-foreground mb-1">Payer preview</p>
          {hasAny ? (
            <p className="break-all">
              Send to <span className="font-bold">{proposed.paymentHandle ?? (proposed.cashAppTag ? `$${proposed.cashAppTag}` : "the link")}</span>
              {effectiveLink && <> · <span className="font-mono text-xs">{effectiveLink}</span></>}
              {proposed.cashAppTag && !cashPreview && <span className="block text-destructive text-xs mt-1">That $Cashtag is not valid.</span>}
            </p>
          ) : (
            <p className="text-muted-foreground">Enter at least one destination.</p>
          )}
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <Button className="rounded-full font-bold" disabled={!hasAny || unchanged || save.isPending} onClick={() => { setSaved(null); setConfirmSave(true); }}>
            Review and save
          </Button>
          {cashAppOn && (
            <Button variant="outline" className="rounded-full" onClick={() => { setSaved(null); setConfirmDisable("cashapp"); }}>
              Disable Cash App only
            </Button>
          )}
          {detail.status === "approved" && (
            <Button variant="outline" className="rounded-full" style={{ color: "var(--fj-berry-shadow)" }} onClick={() => { setSaved(null); setConfirmDisable("all"); }}>
              Disable all payment links
            </Button>
          )}
        </div>
      </section>

      <section className="rounded-2xl border bg-card p-4">
        <h3 className="text-xs font-extrabold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-1.5"><History className="w-3.5 h-3.5" /> History</h3>
        {history.isLoading ? (
          <div className="space-y-2">{[0, 1].map((i) => <div key={i} className="h-12 rounded-xl bg-muted animate-pulse" />)}</div>
        ) : history.isError ? (
          <p className="text-sm text-destructive">Could not load history. <button className="underline" onClick={() => history.refetch()}>Retry</button></p>
        ) : !history.data?.length ? (
          <p className="text-sm text-muted-foreground">No owner changes yet.</p>
        ) : (
          <ol className="space-y-3">
            {history.data.map((h) => (
              <li key={h.id} className="rounded-xl border p-3 text-sm">
                <div className="flex flex-wrap justify-between gap-2 mb-1">
                  <span className="font-bold capitalize">{h.action.replace("_", " ")} · v{h.versionAfter}</span>
                  <span className="text-xs text-muted-foreground">{new Date(h.createdAt).toLocaleString()} · {h.actor}</span>
                </div>
                <p className="text-xs text-muted-foreground break-all">
                  {h.previousValue ? `${h.previousValue.cashAppTag ? "$" + h.previousValue.cashAppTag : "-"} / ${h.previousValue.paymentUrl ?? "-"}` : "none"}
                  {" -> "}
                  {h.newValue.status === "disabled" ? "disabled" : `${h.newValue.cashAppTag ? "$" + h.newValue.cashAppTag : "-"} / ${h.newValue.paymentUrl ?? "-"}`}
                </p>
                {h.note && <p className="text-xs mt-1 italic">{h.note}</p>}
              </li>
            ))}
          </ol>
        )}
      </section>

      <Dialog open={confirmSave} onOpenChange={setConfirmSave}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Confirm payment destination</DialogTitle>
            <DialogDescription>Money for {detail.reunionName} will go here. Check every character.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border p-3"><p className="text-xs font-bold uppercase text-muted-foreground mb-2">Before</p><ValuesTable values={detail.status === "approved" ? detail.current : { cashAppTag: null, paymentHandle: null, paymentUrl: null }} /></div>
            <div className="rounded-xl border p-3" style={{ borderColor: "var(--fj-brand)" }}><p className="text-xs font-bold uppercase mb-2" style={{ color: "var(--fj-brand)" }}>After</p><ValuesTable values={proposed} /></div>
          </div>
          {effectiveLink && (
            <a href={effectiveLink} target="_blank" rel="noopener noreferrer" className="text-sm font-bold inline-flex items-center gap-1" style={{ color: "var(--fj-brand)" }}>
              Test the link <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" className="rounded-full" onClick={() => setConfirmSave(false)}>Cancel</Button>
            <Button className="rounded-full font-bold" disabled={save.isPending} onClick={doSave}>{save.isPending ? "Saving..." : "Approve destination"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDisable !== null} onOpenChange={(o) => !o && setConfirmDisable(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{confirmDisable === "all" ? "Disable all payment links?" : "Disable Cash App?"}</DialogTitle>
            <DialogDescription>
              {confirmDisable === "all"
                ? "Payers will see no Cash App or payment link for this reunion and will be told to contact organizers. Existing payment records are not changed."
                : genericKept
                  ? "Cash App will be removed. The approved non-Cash App label and link stay live for payers."
                  : "Cash App will be removed. No other destination is approved, so payers will see no payment link at all."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="rounded-full" onClick={() => setConfirmDisable(null)}>Cancel</Button>
            <Button className="rounded-full font-bold" style={{ background: "var(--fj-berry)" }} disabled={disable.isPending} onClick={() => confirmDisable && doDisable(confirmDisable)}>
              {disable.isPending ? "Disabling..." : "Disable"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DetailPane({ reunionId, onBack }: { reunionId: number; onBack: () => void }) {
  const q = useOwnerGetPaymentRecipient(reunionId, { query: { queryKey: getOwnerGetPaymentRecipientQueryKey(reunionId) } });
  if (q.isLoading) return <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-24 rounded-2xl bg-muted animate-pulse" />)}</div>;
  if (q.isError || !q.data)
    return (
      <div className="rounded-2xl border p-6 text-sm">
        <p className="font-bold mb-2">Could not load this reunion.</p>
        <Button size="sm" variant="outline" className="rounded-full" onClick={() => q.refetch()}>Retry</Button>
      </div>
    );
  return <RecipientEditor detail={q.data} onBack={onBack} />;
}

export function PaymentRecipients() {
  const cap = useGetMyPaymentOwnerCapability();
  const isOwner = cap.data?.isPaymentOwner === true;
  const list = useOwnerListPaymentRecipients({ query: { queryKey: getOwnerListPaymentRecipientsQueryKey(), enabled: isOwner } });
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | PaymentRecipientStatus>("all");
  const [selected, setSelected] = useState<number | null>(null);

  const items = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (list.data ?? []).filter(
      (r) => (filter === "all" || r.status === filter) && (!s || r.reunionName.toLowerCase().includes(s) || r.reunionCode.toLowerCase().includes(s)),
    );
  }, [list.data, search, filter]);
  const pendingCount = (list.data ?? []).filter((r) => r.status === "pending_review").length;

  if (cap.isLoading) return <div className="max-w-5xl mx-auto p-6"><div className="h-40 rounded-3xl bg-muted animate-pulse" /></div>;
  if (!isOwner)
    return (
      <div className="max-w-lg mx-auto p-6 text-center">
        <Lock className="w-8 h-8 mx-auto mb-3" style={{ color: "var(--fj-ink-soft)" }} />
        <h1 className="text-2xl font-semibold mb-2" style={{ fontFamily: "var(--font-serif)" }}>Platform owner only</h1>
        <p className="text-muted-foreground mb-4">Payment destinations are managed by the platform owner. Organizers and admins can contact the platform owner to request a change.</p>
        <Link href="/dashboard" className="font-bold" style={{ color: "var(--fj-brand)" }}>Back to dashboard</Link>
      </div>
    );

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 md:py-10 pb-28">
      <div className="mb-6">
        <p className="text-xs font-extrabold uppercase tracking-widest flex items-center gap-1.5" style={{ color: "var(--fj-brand)" }}><ShieldCheck className="w-4 h-4" /> Owner controls</p>
        <h1 className="text-3xl md:text-4xl font-semibold" style={{ fontFamily: "var(--font-serif)" }}>Payment recipients</h1>
        <p className="text-muted-foreground mt-1 max-w-2xl">Where each reunion's money goes. Only approved destinations are shown to payers or in emails.{pendingCount > 0 && <> <span className="font-bold" style={{ color: "#8A5A00" }}>{pendingCount} need review.</span></>}</p>
      </div>
      <div className="grid gap-6 md:grid-cols-[320px_1fr]">
        <aside className={selected ? "hidden md:block" : ""}>
          <div className="relative mb-3">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or code" className="pl-9 rounded-full text-base" aria-label="Search reunions" />
          </div>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {(["all", "pending_review", "approved", "disabled"] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)} className="rounded-full px-3 py-1 text-xs font-bold border"
                style={filter === f ? { background: "var(--fj-brand)", color: "var(--fj-surface)", borderColor: "var(--fj-brand)" } : { color: "var(--fj-ink-soft)" }}>
                {f === "all" ? "All" : STATUS_STYLE[f].label}
              </button>
            ))}
          </div>
          {list.isLoading ? (
            <div className="space-y-2">{[0, 1, 2, 3].map((i) => <div key={i} className="h-16 rounded-2xl bg-muted animate-pulse" />)}</div>
          ) : list.isError ? (
            <div className="rounded-2xl border p-4 text-sm">Could not load reunions. <button className="underline font-bold" onClick={() => list.refetch()}>Retry</button></div>
          ) : items.length === 0 ? (
            <div className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">{list.data?.length ? "No reunions match." : "No reunions yet."}</div>
          ) : (
            <ul className="space-y-2">
              {items.map((r) => (
                <li key={r.reunionId}>
                  <button onClick={() => setSelected(r.reunionId)} className="w-full text-left rounded-2xl border bg-card px-4 py-3 transition-colors hover:bg-muted/50"
                    style={selected === r.reunionId ? { borderColor: "var(--fj-brand)", boxShadow: "inset 3px 0 0 var(--fj-brand)" } : undefined}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold truncate">{r.reunionName}</span>
                      <StatusPill status={r.status} />
                    </div>
                    <span className="text-xs text-muted-foreground font-mono">{r.reunionCode}{r.cashAppTag ? ` · $${r.cashAppTag}` : ""}{r.hasLegacyValues && r.status === "pending_review" ? " · legacy values" : ""}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
        <main className={selected ? "" : "hidden md:block"}>
          {selected ? (
            <DetailPane key={selected} reunionId={selected} onBack={() => setSelected(null)} />
          ) : (
            <div className="rounded-3xl border border-dashed p-10 text-center text-muted-foreground">Select a reunion to review its payment destination.</div>
          )}
        </main>
      </div>
    </div>
  );
}
