import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetGraduateConfig, getGetGraduateConfigQueryKey, getGetGraduatePageQueryKey,
  useSaveGraduateContent, useSaveGraduateControls,
  useListGraduateSubmissions, getListGraduateSubmissionsQueryKey,
  useResendGraduateSubmission,
} from "@workspace/api-client-react";
import type { GraduateBlock, GraduateConfig, GraduateContent, GraduateQuestion, GraduateSubmission } from "@workspace/api-client-react";
import { format } from "date-fns";
import {
  ArrowDown, ArrowUp, Eye, GraduationCap, Heading, Link2, Mail, Monitor, Plus, RefreshCw,
  Smartphone, Trash2, Type, AlertTriangle, CheckCircle2, ShieldCheck,
} from "lucide-react";
import { OrganizerLayout } from "./OrganizerLayout";
import { Skeleton } from "../../components/ui/skeleton";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { Label } from "../../components/ui/label";
import { Switch } from "../../components/ui/switch";
import { GraduateBlocks } from "../../components/graduate/GraduateBlocks";
import {
  EMAIL_STATUS_COPY, HEX_RE, PALETTE, THEME_PRESETS, apiMessage, apiStatus, contrastLabel, contrastRatio,
  move, newBlock, newQuestion, safeHttpUrl, useDocumentTitle,
} from "../../lib/graduate";

export function OrganizerGraduateDollars({ params }: { params: { reunionId: string } }) {
  const reunionId = parseInt(params.reunionId, 10);
  return (
    <OrganizerLayout reunionId={reunionId} allowWithoutRoles>
      <GraduateWorkspace key={reunionId} reunionId={reunionId} />
    </OrganizerLayout>
  );
}

type Tab = "page" | "questions" | "settings" | "review";

function GraduateWorkspace({ reunionId }: { reunionId: number }) {
  const configQ = useGetGraduateConfig(reunionId, { query: { enabled: !!reunionId, retry: false, queryKey: getGetGraduateConfigQueryKey(reunionId) } });
  const [tab, setTab] = useState<Tab>("page");
  useDocumentTitle("Graduate Dollars · Organize");

  if (configQ.isLoading) {
    return <div className="flex flex-col gap-6"><Skeleton className="h-28 rounded-3xl" /><Skeleton className="h-[32rem] rounded-3xl" /></div>;
  }
  if (configQ.isError || !configQ.data) {
    const st = apiStatus(configQ.error);
    return (
      <div className="bg-card border rounded-3xl p-10 text-center flex flex-col items-center gap-4">
        <AlertTriangle className="w-8 h-8 text-destructive" />
        <h1 className="font-serif text-2xl font-bold">{st === 403 ? "You don't have access to Graduate Dollars" : "Couldn't load Graduate Dollars"}</h1>
        <p className="text-muted-foreground max-w-md">{apiMessage(configQ.error, "Something went wrong. Try again in a moment.")}</p>
        {st !== 403 && <Button className="rounded-full" onClick={() => configQ.refetch()} data-testid="button-retry-config"><RefreshCw className="w-4 h-4 mr-2" />Retry</Button>}
      </div>
    );
  }
  const config = configQ.data;
  const tabs: { id: Tab; label: string; show: boolean }[] = [
    { id: "page", label: "Page", show: true },
    { id: "questions", label: "Questions", show: true },
    { id: "settings", label: "Visibility & recipient", show: config.canAdmin },
    { id: "review", label: "Applications", show: config.canReview },
  ];

  return (
    <div className="flex flex-col gap-6">
      <header className="relative overflow-hidden rounded-3xl bg-[#0F3B5C] text-[#F4EFE3] p-7 md:p-9">
        <div className="absolute -right-10 -top-10 w-56 h-56 rounded-full border-[18px] border-[#D9A441]/25 pointer-events-none" />
        <div className="relative flex flex-col gap-3">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.25em] text-[#D9A441]"><GraduationCap className="w-4 h-4" />Graduate Dollars</div>
          <h1 className="font-serif text-3xl md:text-4xl font-bold">Supporting the family's students</h1>
          <div className="flex flex-wrap gap-2 text-xs font-bold">
            <StatusPill on={config.controls.visible} onLabel="Page visible" offLabel="Page hidden" />
            <StatusPill on={config.controls.open} onLabel="Applications open" offLabel="Applications closed" />
            {!config.recipientValid && <span className="px-3 py-1 rounded-full bg-red-200 text-red-900">Recipient needs attention</span>}
          </div>
        </div>
      </header>

      <div className="flex gap-1 p-1 bg-muted rounded-2xl overflow-x-auto" role="tablist">
        {tabs.filter((t) => t.show).map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} data-testid={`tab-${t.id}`}
            className={`flex-1 whitespace-nowrap px-4 py-2.5 rounded-xl text-sm font-bold transition-colors ${tab === t.id ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Kept mounted so unsaved edits survive tab switches; state is local and dies with this event's workspace. */}
      <div hidden={tab !== "page" && tab !== "questions"}>
        <ContentEditor reunionId={reunionId} config={config} mode={tab === "questions" ? "questions" : "page"} />
      </div>
      {config.canAdmin && <div hidden={tab !== "settings"}><ControlsPanel reunionId={reunionId} config={config} /></div>}
      {tab === "review" && config.canReview && <ReviewPanel reunionId={reunionId} />}
    </div>
  );
}

function StatusPill({ on, onLabel, offLabel }: { on: boolean; onLabel: string; offLabel: string }) {
  return <span className={`px-3 py-1 rounded-full ${on ? "bg-[#D9A441] text-[#1E2A33]" : "bg-white/15 text-white/80"}`}>{on ? onLabel : offLabel}</span>;
}

/* ---------------- Content editor ---------------- */

function useUnsavedGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const onBefore = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]");
      if (!a || a.getAttribute("target") === "_blank") return;
      if (!window.confirm("You have unsaved Graduate Dollars changes. Leave without saving?")) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", onBefore);
    document.addEventListener("click", onClick, true);
    return () => { window.removeEventListener("beforeunload", onBefore); document.removeEventListener("click", onClick, true); };
  }, [dirty]);
}

function validateContent(c: GraduateContent): string[] {
  const errs: string[] = [];
  [c.background, c.foreground, c.accent].forEach((h) => { if (!HEX_RE.test(h)) errs.push(`Theme color ${h || "(empty)"} must be a #RRGGBB hex value.`); });
  c.blocks.forEach((b, i) => {
    if (b.kind === "link" && !safeHttpUrl(b.url)) errs.push(`Block ${i + 1}: link must be a full http(s) address without credentials.`);
    if ((b.background && !HEX_RE.test(b.background)) || (b.foreground && !HEX_RE.test(b.foreground))) errs.push(`Block ${i + 1}: colors must be hex or inherited.`);
    if (b.size < 14 || b.size > 56) errs.push(`Block ${i + 1}: size must be 14 to 56.`);
  });
  c.questions.forEach((q, i) => { if (!q.label.trim()) errs.push(`Question ${i + 1} needs a label.`); });
  return errs;
}


function ContentEditor({ reunionId, config, mode }: { reunionId: number; config: GraduateConfig; mode: "page" | "questions" }) {
  const qc = useQueryClient();
  const save = useSaveGraduateContent();
  const [draft, setDraftState] = useState<GraduateContent>(config.content);
  const setDraft = (fn: (d: GraduateContent) => GraduateContent) => setDraftState(fn);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [conflict, setConflict] = useState(false);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [selected, setSelected] = useState<string | null>(null);
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(config.content), [draft, config.content]);
  useUnsavedGuard(dirty);
  const readOnly = !config.canEdit;
  const errors = validateContent(draft);

  const doSave = () => {
    if (save.isPending || errors.length) return;
    setMsg(null);
    save.mutate({ reunionId, data: { ...draft, questions: draft.questions.map((q) => ({ ...q, label: q.label.trim() })) } }, {
      onSuccess: (saved) => {
        qc.setQueryData(getGetGraduateConfigQueryKey(reunionId), (old: GraduateConfig | undefined) => old ? { ...old, content: saved } : old);
        qc.invalidateQueries({ queryKey: getGetGraduatePageQueryKey(reunionId) });
        setDraftState(saved);
        setConflict(false);
        setMsg({ tone: "ok", text: "Saved. Candidates will see this version." });
      },
      onError: (err) => {
        if (apiStatus(err) === 409) {
          setConflict(true);
          setMsg({ tone: "err", text: "Someone else saved changes first. Reload their version (your unsaved edits will be discarded) or copy your text before reloading." });
        } else setMsg({ tone: "err", text: apiMessage(err, "Save failed. Your edits are still here; try again.") });
      },
    });
  };
  const reloadLatest = async () => {
    const res = await qc.fetchQuery({ queryKey: getGetGraduateConfigQueryKey(reunionId) }) as GraduateConfig;
    setDraftState(res.content);
    setConflict(false);
    setMsg(null);
  };

  const updateBlock = (id: string, patch: Partial<GraduateBlock>) => setDraft((d) => ({ ...d, blocks: d.blocks.map((b) => b.id === id ? { ...b, ...patch } : b) }));
  const updateQ = (id: string, patch: Partial<GraduateQuestion>) => setDraft((d) => ({ ...d, questions: d.questions.map((q) => q.id === id ? { ...q, ...patch } : q) }));

  const saveBar = (
    <div className="sticky bottom-3 z-20 bg-card/95 backdrop-blur border shadow-lg rounded-2xl px-4 py-3 flex flex-wrap items-center gap-3 justify-between">
      <div className="text-sm min-w-0">
        {readOnly ? <span className="text-muted-foreground">View only. Owners, admins, and power users can edit.</span>
          : msg ? <span className={msg.tone === "ok" ? "text-emerald-700 font-bold" : "text-destructive font-bold"} data-testid="text-save-status">{msg.text}</span>
          : errors.length ? <span className="text-destructive font-bold">{errors[0]}{errors.length > 1 ? ` (+${errors.length - 1} more)` : ""}</span>
          : dirty ? <span className="text-amber-700 font-bold">Unsaved changes</span>
          : <span className="text-muted-foreground">All changes saved · revision {config.content.revision}</span>}
      </div>
      {!readOnly && (
        <div className="flex gap-2">
          {conflict && <Button variant="outline" className="rounded-full" onClick={reloadLatest} data-testid="button-reload-latest">Reload latest</Button>}
          {dirty && !conflict && <Button variant="ghost" className="rounded-full" onClick={() => { setDraftState(config.content); setMsg(null); }} data-testid="button-discard">Discard</Button>}
          <Button className="rounded-full" disabled={!dirty || save.isPending || errors.length > 0 || conflict} onClick={doSave} data-testid="button-save-content">{save.isPending ? "Saving..." : "Save changes"}</Button>
        </div>
      )}
    </div>
  );

  if (mode === "questions") {
    return (
      <fieldset disabled={save.isPending} className="flex flex-col gap-4 min-w-0">
        <div className="bg-card border rounded-3xl p-6">
          <h2 className="font-serif text-2xl font-bold">Application questions</h2>
          <p className="text-sm text-muted-foreground mt-1">Name and contact email are always collected, plus optional profile links and reference-only payout details. Submitted applications keep the labels they were answered under.</p>
        </div>
        {draft.questions.length === 0 && (
          <div className="border-2 border-dashed rounded-3xl p-10 text-center text-muted-foreground">No custom questions yet. Add eligibility questions like school, program, or graduation year.</div>
        )}
        {draft.questions.map((q, i) => (
          <div key={q.id} className="bg-card border rounded-3xl p-5 flex flex-col gap-3" data-testid={`card-question-${i}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Question {i + 1}</span>
              {!readOnly && (
                <div className="flex gap-1">
                  <IconBtn label="Move up" disabled={i === 0} onClick={() => setDraft((d) => ({ ...d, questions: move(d.questions, i, -1) }))}><ArrowUp className="w-4 h-4" /></IconBtn>
                  <IconBtn label="Move down" disabled={i === draft.questions.length - 1} onClick={() => setDraft((d) => ({ ...d, questions: move(d.questions, i, 1) }))}><ArrowDown className="w-4 h-4" /></IconBtn>
                  <IconBtn label="Remove" onClick={() => setDraft((d) => ({ ...d, questions: d.questions.filter((x) => x.id !== q.id) }))}><Trash2 className="w-4 h-4" /></IconBtn>
                </div>
              )}
            </div>
            <Input disabled={readOnly} placeholder="Question label" value={q.label} maxLength={300} onChange={(e) => updateQ(q.id, { label: e.target.value })} data-testid={`input-question-label-${i}`} />
            <Textarea disabled={readOnly} placeholder="Help text (optional)" rows={2} value={q.help} maxLength={1000} onChange={(e) => updateQ(q.id, { help: e.target.value })} data-testid={`input-question-help-${i}`} />
            <div className="flex flex-wrap items-center gap-4">
              <Segmented disabled={readOnly} value={q.kind} options={[["short", "Short answer"], ["long", "Long answer"], ["url", "Link"]]} onChange={(v) => updateQ(q.id, { kind: v as GraduateQuestion["kind"] })} />
              <label className="flex items-center gap-2 text-sm font-bold">
                <Switch disabled={readOnly} checked={q.required} onCheckedChange={(v) => updateQ(q.id, { required: v })} data-testid={`switch-question-required-${i}`} />
                {q.required ? "Required" : "Optional"}
              </label>
            </div>
          </div>
        ))}
        {!readOnly && draft.questions.length < 30 && (
          <Button variant="outline" className="rounded-full self-start" onClick={() => setDraft((d) => ({ ...d, questions: [...d.questions, newQuestion()] }))} data-testid="button-add-question"><Plus className="w-4 h-4 mr-1" />Add question</Button>
        )}
        {saveBar}
      </fieldset>
    );
  }

  return (
    <fieldset disabled={save.isPending} className="flex flex-col gap-5 min-w-0">
      <div className="grid xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-5 items-start">
        <div className="flex flex-col gap-4">
          <section className="bg-card border rounded-3xl p-5 flex flex-col gap-4">
            <h2 className="font-serif text-xl font-bold">Page theme</h2>
            <div className="flex flex-wrap gap-2">
              {THEME_PRESETS.map((p) => (
                <button key={p.name} disabled={readOnly} onClick={() => setDraft((d) => ({ ...d, background: p.background, foreground: p.foreground, accent: p.accent }))}
                  className="flex items-center gap-2 border rounded-full pl-1 pr-3 py-1 text-xs font-bold hover:border-primary disabled:opacity-50" data-testid={`button-preset-${p.name}`}>
                  <span className="w-6 h-6 rounded-full border flex items-center justify-center" style={{ background: p.background }}><span className="w-2.5 h-2.5 rounded-full" style={{ background: p.accent }} /></span>{p.name}
                </button>
              ))}
            </div>
            <ColorField label="Background" value={draft.background} disabled={readOnly} onChange={(v) => setDraft((d) => ({ ...d, background: v }))} />
            <ColorField label="Text" value={draft.foreground} disabled={readOnly} onChange={(v) => setDraft((d) => ({ ...d, foreground: v }))} />
            <ColorField label="Accent" value={draft.accent} disabled={readOnly} onChange={(v) => setDraft((d) => ({ ...d, accent: v }))} />
            <ContrastBadge fg={draft.foreground} bg={draft.background} />
          </section>

          <section className="flex flex-col gap-3">
            {draft.blocks.length === 0 && <div className="border-2 border-dashed rounded-3xl p-8 text-center text-muted-foreground">Start with a heading, then explain who can apply and how awards work.</div>}
            {draft.blocks.map((b, i) => (
              <BlockEditor key={b.id} block={b} index={i} count={draft.blocks.length} theme={draft} readOnly={readOnly}
                open={selected === b.id} onToggle={() => setSelected((s) => s === b.id ? null : b.id)}
                onChange={(p) => updateBlock(b.id, p)}
                onMove={(dir) => setDraft((d) => ({ ...d, blocks: move(d.blocks, i, dir) }))}
                onRemove={() => setDraft((d) => ({ ...d, blocks: d.blocks.filter((x) => x.id !== b.id) }))} />
            ))}
            {!readOnly && draft.blocks.length < 40 && (
              <div className="flex flex-wrap gap-2">
                {([["heading", Heading, "Heading"], ["text", Type, "Text"], ["link", Link2, "Link"]] as const).map(([k, Icon, label]) => (
                  <Button key={k} variant="outline" className="rounded-full" onClick={() => { const nb = newBlock(k); setDraft((d) => ({ ...d, blocks: [...d.blocks, nb] })); setSelected(nb.id); }} data-testid={`button-add-${k}`}>
                    <Plus className="w-4 h-4 mr-1" /><Icon className="w-4 h-4 mr-1" />{label}
                  </Button>
                ))}
              </div>
            )}
          </section>
        </div>

        <section className="xl:sticky xl:top-24 bg-muted/60 border rounded-3xl p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm font-bold"><Eye className="w-4 h-4" />Preview</span>
            <div className="flex gap-1 bg-card rounded-full p-1 border">
              <IconBtn label="Desktop preview" active={device === "desktop"} onClick={() => setDevice("desktop")}><Monitor className="w-4 h-4" /></IconBtn>
              <IconBtn label="Mobile preview" active={device === "mobile"} onClick={() => setDevice("mobile")}><Smartphone className="w-4 h-4" /></IconBtn>
            </div>
          </div>
          <div className={`mx-auto w-full transition-all ${device === "mobile" ? "max-w-[360px]" : ""}`}>
            <div className="rounded-2xl overflow-hidden border shadow-sm max-h-[70vh] overflow-y-auto" style={{ background: draft.background, color: draft.foreground }} data-testid="preview-graduate">
              <div className="px-5 pt-4 pb-2 text-[10px] font-bold uppercase tracking-[0.25em] flex items-center gap-2" style={{ borderBottom: `3px solid ${draft.accent}` }}>
                <GraduationCap className="w-4 h-4" style={{ color: draft.accent }} />Graduate Dollars
              </div>
              <div className={device === "mobile" ? "p-4" : "p-7"}><GraduateBlocks content={draft} compact={device === "mobile"} /></div>
            </div>
          </div>
        </section>
      </div>
      {saveBar}
    </fieldset>
  );
}

function BlockEditor({ block: b, index, count, theme, readOnly, open, onToggle, onChange, onMove, onRemove }: {
  block: GraduateBlock; index: number; count: number; theme: GraduateContent; readOnly: boolean; open: boolean;
  onToggle: () => void; onChange: (p: Partial<GraduateBlock>) => void; onMove: (d: -1 | 1) => void; onRemove: () => void;
}) {
  const kindLabel = b.kind === "heading" ? "Heading" : b.kind === "link" ? "Link" : "Text";
  const linkBad = b.kind === "link" && !safeHttpUrl(b.url);
  return (
    <div className={`bg-card border rounded-3xl overflow-hidden ${open ? "ring-2 ring-primary/30" : ""}`} data-testid={`card-block-${index}`}>
      <div className="flex items-center gap-2 px-4 py-3">
        <button onClick={onToggle} className="flex-1 min-w-0 text-left" data-testid={`button-toggle-block-${index}`}>
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{index + 1} · {kindLabel}</span>
          <span className="block truncate font-bold">{b.text || "Empty"}</span>
        </button>
        {!readOnly && <>
          <IconBtn label="Move up" disabled={index === 0} onClick={() => onMove(-1)}><ArrowUp className="w-4 h-4" /></IconBtn>
          <IconBtn label="Move down" disabled={index === count - 1} onClick={() => onMove(1)}><ArrowDown className="w-4 h-4" /></IconBtn>
          <IconBtn label="Remove block" onClick={onRemove}><Trash2 className="w-4 h-4" /></IconBtn>
        </>}
      </div>
      {open && (
        <div className="border-t px-4 py-4 flex flex-col gap-4 bg-muted/20">
          {b.kind === "heading"
            ? <Input disabled={readOnly} value={b.text} maxLength={10000} onChange={(e) => onChange({ text: e.target.value })} data-testid={`input-block-text-${index}`} />
            : <Textarea disabled={readOnly} rows={b.kind === "link" ? 1 : 5} value={b.text} maxLength={10000} placeholder={b.kind === "link" ? "Link label" : ""} onChange={(e) => onChange({ text: e.target.value })} data-testid={`input-block-text-${index}`} />}
          {b.kind === "link" && (
            <div>
              <Input disabled={readOnly} value={b.url} maxLength={2000} placeholder="https://" onChange={(e) => onChange({ url: e.target.value })} data-testid={`input-block-url-${index}`} />
              {linkBad && <p className="text-xs text-destructive mt-1">Use a full http:// or https:// address with no username or password.</p>}
            </div>
          )}
          <div className="grid sm:grid-cols-2 gap-3">
            <Labeled label="Font"><Segmented disabled={readOnly} value={b.font} options={[["sans", "Sans"], ["serif", "Serif"], ["mono", "Mono"]]} onChange={(v) => onChange({ font: v as GraduateBlock["font"] })} /></Labeled>
            <Labeled label={`Size · ${b.size}px`}>
              <input type="range" min={14} max={56} disabled={readOnly} value={b.size} onChange={(e) => onChange({ size: Number(e.target.value) })} className="w-full accent-[hsl(var(--primary))]" data-testid={`range-block-size-${index}`} />
            </Labeled>
            <Labeled label="Weight"><Segmented disabled={readOnly} value={b.weight} options={[["normal", "Regular"], ["bold", "Bold"]]} onChange={(v) => onChange({ weight: v as GraduateBlock["weight"] })} /></Labeled>
            <Labeled label="Align"><Segmented disabled={readOnly} value={b.align} options={[["left", "Left"], ["center", "Center"], ["right", "Right"]]} onChange={(v) => onChange({ align: v as GraduateBlock["align"] })} /></Labeled>
            <Labeled label="Width"><Segmented disabled={readOnly} value={b.width} options={[["full", "Full"], ["narrow", "Narrow"]]} onChange={(v) => onChange({ width: v as GraduateBlock["width"] })} /></Labeled>
            <Labeled label="Spacing"><Segmented disabled={readOnly} value={b.spacing} options={[["compact", "Compact"], ["comfortable", "Comfy"], ["spacious", "Spacious"]]} onChange={(v) => onChange({ spacing: v as GraduateBlock["spacing"] })} /></Labeled>
          </div>
          <ColorField label="Block background" value={b.background} allowInherit disabled={readOnly} onChange={(v) => onChange({ background: v })} />
          <ColorField label="Block text" value={b.foreground} allowInherit disabled={readOnly} onChange={(v) => onChange({ foreground: v })} />
          <ContrastBadge fg={b.foreground || theme.foreground} bg={b.background || theme.background} />
        </div>
      )}
    </div>
  );
}

function ColorField({ label, value, onChange, allowInherit, disabled }: { label: string; value: string; onChange: (v: string) => void; allowInherit?: boolean; disabled?: boolean }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{label}</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {allowInherit && (
          <button disabled={disabled} onClick={() => onChange("")} title="Inherit from page theme"
            className={`h-7 px-2 rounded-full border text-[11px] font-bold ${value === "" ? "ring-2 ring-primary" : ""}`}>Inherit</button>
        )}
        {PALETTE.map((c) => (
          <button key={c} disabled={disabled} onClick={() => onChange(c)} aria-label={`Use ${c}`} title={c}
            className={`w-7 h-7 rounded-full border ${value.toLowerCase() === c.toLowerCase() ? "ring-2 ring-primary ring-offset-1" : ""}`} style={{ background: c }} />
        ))}
        <input type="color" disabled={disabled} value={HEX_RE.test(value) ? value : "#ffffff"} onChange={(e) => onChange(e.target.value.toUpperCase())} className="w-8 h-8 rounded cursor-pointer bg-transparent" aria-label={`${label} custom color`} />
        <Input disabled={disabled} value={text} placeholder={allowInherit ? "inherit" : "#RRGGBB"} className="w-28 h-8 font-mono text-xs"
          onChange={(e) => { const v = e.target.value.trim(); setText(v); if (HEX_RE.test(v) || (allowInherit && v === "")) onChange(v.toUpperCase()); }} />
      </div>
    </div>
  );
}

function ContrastBadge({ fg, bg }: { fg: string; bg: string }) {
  const { label, tone } = contrastLabel(contrastRatio(fg, bg));
  const cls = tone === "good" ? "bg-emerald-100 text-emerald-900" : tone === "ok" ? "bg-amber-100 text-amber-900" : "bg-red-100 text-red-800";
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="px-3 py-1.5 rounded-lg border font-bold" style={{ background: HEX_RE.test(bg) ? bg : undefined, color: HEX_RE.test(fg) ? fg : undefined }}>Aa</span>
      <span className={`px-2.5 py-1 rounded-full font-bold ${cls}`} data-testid="text-contrast">Contrast {label}</span>
    </div>
  );
}

function Segmented({ value, options, onChange, disabled }: { value: string; options: readonly (readonly [string, string])[]; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <div className="inline-flex flex-wrap bg-muted rounded-xl p-0.5">
      {options.map(([v, l]) => (
        <button key={v} type="button" disabled={disabled} onClick={() => onChange(v)}
          className={`px-2.5 py-1 rounded-lg text-xs font-bold ${value === v ? "bg-card shadow-sm" : "text-muted-foreground"}`}>{l}</button>
      ))}
    </div>
  );
}
function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex flex-col gap-1"><span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{label}</span>{children}</div>;
}
function IconBtn({ label, onClick, disabled, active, children }: { label: string; onClick: () => void; disabled?: boolean; active?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick}
      className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors disabled:opacity-30 ${active ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground"}`}>
      {children}
    </button>
  );
}

/* ---------------- Admin controls ---------------- */

function ControlsPanel({ reunionId, config }: { reunionId: number; config: GraduateConfig }) {
  const qc = useQueryClient();
  const save = useSaveGraduateControls();
  const [visible, setVisible] = useState(config.controls.visible);
  const [open, setOpen] = useState(config.controls.open);
  const [recipientId, setRecipientId] = useState<string | null>(config.controls.recipientId);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const recipient = config.organizers.find((o) => o.id === recipientId);
  const recipientUsable = !!recipient?.eligible && !!recipient.email;
  const dirty = visible !== config.controls.visible || open !== config.controls.open || recipientId !== config.controls.recipientId;
  useUnsavedGuard(dirty);
  const savedRecipientMissing = config.controls.recipientId && !config.organizers.some((o) => o.id === config.controls.recipientId);

  const doSave = () => {
    if (open && !recipientUsable) { setMsg({ tone: "err", text: "Choose an eligible recipient with an email before opening applications." }); return; }
    setMsg(null);
    save.mutate({ reunionId, data: { visible, open, recipientId } }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetGraduateConfigQueryKey(reunionId) });
        qc.invalidateQueries({ queryKey: getGetGraduatePageQueryKey(reunionId) });
        setMsg({ tone: "ok", text: "Settings saved." });
      },
      onError: (err) => setMsg({ tone: "err", text: apiMessage(err, "Couldn't save settings. Try again.") }),
    });
  };

  return (
    <div className="flex flex-col gap-5">
      {!config.recipientValid && (
        <div className="rounded-3xl border border-red-200 bg-red-50 p-5 flex gap-3 text-red-900" data-testid="alert-recipient-invalid">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
          <div className="text-sm"><strong>The submission recipient needs attention.</strong> {savedRecipientMissing ? "The saved recipient is no longer an organizer of this event." : "No eligible recipient is selected."} New applications won't be emailed anywhere until you pick a current organizer.</div>
        </div>
      )}
      <section className="bg-card border rounded-3xl p-6 flex flex-col gap-5">
        <ToggleRow label="Show the Graduate Dollars page" body="Adds the card to the event home and allows direct links. Hidden pages are unavailable to candidates, but staff can still preview here." checked={visible} onChange={setVisible} testId="switch-visible" />
        <ToggleRow label="Accept applications" body="Closing keeps the information visible but stops new submissions." checked={open} onChange={(v) => { setOpen(v); if (v && !recipientUsable) setMsg({ tone: "err", text: "Pick an eligible recipient first." }); }} testId="switch-open" />
      </section>
      <section className="bg-card border rounded-3xl p-6 flex flex-col gap-3">
        <h2 className="font-serif text-xl font-bold flex items-center gap-2"><Mail className="w-5 h-5" />Submission recipient</h2>
        <p className="text-sm text-muted-foreground">Every new application is emailed to this one organizer. Candidates never see this address.</p>
        {config.organizers.length === 0 ? <p className="text-sm italic text-muted-foreground">No organizers are available for this event.</p> : (
          <div className="flex flex-col gap-2" role="radiogroup">
            {config.organizers.map((o) => (
              <label key={o.id} className={`flex items-center gap-3 border rounded-2xl px-4 py-3 cursor-pointer ${recipientId === o.id ? "border-primary bg-primary/5" : ""} ${!o.eligible ? "opacity-60" : ""}`} data-testid={`radio-recipient-${o.id}`}>
                <input type="radio" name="recipient" checked={recipientId === o.id} disabled={!o.eligible} onChange={() => setRecipientId(o.id)} className="accent-[hsl(var(--primary))]" />
                <span className="flex-1 min-w-0"><span className="font-bold block truncate">{o.name}</span><span className="text-xs text-muted-foreground break-all">{o.email || "No email on file"}</span></span>
                {!o.eligible && <span className="text-[10px] font-bold uppercase tracking-wide text-red-700">Not eligible</span>}
              </label>
            ))}
            {recipientId && <Button variant="ghost" size="sm" className="self-start rounded-full" onClick={() => { setRecipientId(null); setOpen(false); }} data-testid="button-clear-recipient">Clear recipient</Button>}
          </div>
        )}
      </section>
      <div className="flex flex-wrap items-center gap-3 justify-end">
        {msg && <span className={`text-sm font-bold ${msg.tone === "ok" ? "text-emerald-700" : "text-destructive"}`}>{msg.text}</span>}
        <Button className="rounded-full" disabled={!dirty || save.isPending} onClick={doSave} data-testid="button-save-controls">{save.isPending ? "Saving..." : "Save settings"}</Button>
      </div>
    </div>
  );
}

function ToggleRow({ label, body, checked, onChange, testId }: { label: string; body: string; checked: boolean; onChange: (v: boolean) => void; testId: string }) {
  return (
    <label className="flex items-start justify-between gap-4 cursor-pointer">
      <span><span className="font-bold block">{label}</span><span className="text-sm text-muted-foreground">{body}</span></span>
      <Switch checked={checked} onCheckedChange={onChange} data-testid={testId} />
    </label>
  );
}

/* ---------------- Private review ---------------- */

function ReviewPanel({ reunionId }: { reunionId: number }) {
  const q = useListGraduateSubmissions(reunionId, { query: { retry: false, queryKey: getListGraduateSubmissionsQueryKey(reunionId) } });
  if (q.isLoading) return <div className="flex flex-col gap-3"><Skeleton className="h-28 rounded-3xl" /><Skeleton className="h-28 rounded-3xl" /></div>;
  if (q.isError) {
    return (
      <div className="bg-card border rounded-3xl p-8 text-center flex flex-col items-center gap-3">
        <p className="text-muted-foreground">{apiMessage(q.error, "Couldn't load applications.")}</p>
        {apiStatus(q.error) !== 403 && <Button variant="outline" className="rounded-full" onClick={() => q.refetch()}>Retry</Button>}
      </div>
    );
  }
  const list = q.data ?? [];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground"><ShieldCheck className="w-4 h-4" />Private. Visible only to platform admins, the event owner, and the selected recipient.</div>
      {list.length === 0 ? (
        <div className="border-2 border-dashed rounded-3xl p-12 text-center flex flex-col items-center gap-2">
          <GraduationCap className="w-10 h-10 text-muted-foreground" />
          <h3 className="font-serif text-xl font-bold">No applications yet</h3>
          <p className="text-sm text-muted-foreground">When a student applies, it is saved here and an email to the selected recipient is attempted.</p>
        </div>
      ) : list.map((s) => <SubmissionCard key={s.id} reunionId={reunionId} s={s} />)}
    </div>
  );
}

function SubmissionCard({ reunionId, s }: { reunionId: number; s: GraduateSubmission }) {
  const qc = useQueryClient();
  const resend = useResendGraduateSubmission();
  const [note, setNote] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const copy = EMAIL_STATUS_COPY[s.emailStatus] ?? EMAIL_STATUS_COPY.pending;
  const doResend = () => {
    if (resend.isPending) return;
    setNote(null);
    resend.mutate({ reunionId, submissionId: s.id }, {
      onSuccess: (updated) => {
        qc.setQueryData(getListGraduateSubmissionsQueryKey(reunionId), (old: GraduateSubmission[] | undefined) => old?.map((x) => x.id === updated.id ? updated : x));
        setNote({ tone: "ok", text: "Resend requested." });
      },
      onError: (err) => setNote({ tone: "err", text: apiStatus(err) === 429 ? "Please wait a little before resending again." : apiMessage(err, "Resend failed.") }),
    });
  };
  return (
    <details className="bg-card border rounded-3xl group" data-testid={`card-submission-${s.id}`}>
      <summary className="list-none cursor-pointer p-5 flex flex-wrap items-center gap-3 justify-between">
        <span className="min-w-0"><span className="font-bold block">{s.name}</span><span className="text-xs text-muted-foreground">{format(new Date(s.createdAt), "MMM d, yyyy h:mm a")} · {s.email}</span></span>
        <span className={`text-[11px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full ${copy.className}`} data-testid={`status-email-${s.id}`}>{copy.label}</span>
      </summary>
      <div className="border-t p-5 flex flex-col gap-4 text-sm">
        <dl className="grid gap-3">
          {s.answers.map((a) => <div key={a.questionId}><dt className="font-bold">{a.label}</dt><dd className="text-muted-foreground whitespace-pre-wrap break-words">{a.value || "Left blank"}</dd></div>)}
          {s.links.length > 0 && <div><dt className="font-bold">Profile links</dt><dd className="flex flex-col">{s.links.map((l, i) => { const h = safeHttpUrl(l.url); return h ? <a key={i} href={h} target="_blank" rel="noopener noreferrer nofollow" className="text-primary underline break-all">{l.label}: {l.url}</a> : <span key={i} className="break-all">{l.label}: {l.url}</span>; })}</dd></div>}
          {(s.zelle || s.cashApp) && <div className="rounded-2xl bg-muted/50 p-3"><dt className="font-bold">Payout details (reference only)</dt><dd className="text-muted-foreground">{s.zelle && <div>Zelle: {s.zelle}</div>}{s.cashApp && <div>Cash App: {s.cashApp}</div>}</dd></div>}
        </dl>
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t">
          <div className="text-xs text-muted-foreground flex items-start gap-1.5">
            {s.emailStatus === "accepted" ? <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" /> : s.emailStatus === "failed" ? <AlertTriangle className="w-4 h-4 text-destructive shrink-0" /> : null}
            <span>{copy.detail} Attempts: {s.emailAttempts}.{s.emailError ? ` Last error: ${s.emailError}` : ""}</span>
          </div>
          <div className="flex items-center gap-2">
            {note && <span className={`text-xs font-bold ${note.tone === "ok" ? "text-emerald-700" : "text-destructive"}`}>{note.text}</span>}
            <Button size="sm" variant="outline" className="rounded-full" disabled={resend.isPending || s.emailStatus === "sending"} onClick={doResend} data-testid={`button-resend-${s.id}`}>
              <Mail className="w-4 h-4 mr-1" />{resend.isPending ? "Resending..." : "Resend to recipient"}
            </Button>
          </div>
        </div>
      </div>
    </details>
  );
}
