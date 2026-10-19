import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetChecklistConfig,
  getGetChecklistConfigQueryKey,
  useSaveChecklistConfig,
  type ChecklistItemKind,
} from "@workspace/api-client-react";
import { ArrowDown, ArrowUp, Eye, EyeOff, Lock, Plus, RotateCw, Sparkles, Trash2 } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Switch } from "../ui/switch";
import { Skeleton } from "../ui/skeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "../ui/alert-dialog";
import { useToast } from "../../hooks/use-toast";
import {
  CHECKLIST_TEMPLATES, KIND_LABELS, draftError, draftToItems, errorMessage, newDraftKey, toDraft, type DraftItem,
} from "../../lib/checklist";

const MAX_ITEMS = 50;

export function ChecklistEditor({ reunionId }: { reunionId: number }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const configQ = useGetChecklistConfig(reunionId, {
    query: { queryKey: getGetChecklistConfigQueryKey(reunionId), enabled: !isNaN(reunionId) },
  });
  const save = useSaveChecklistConfig();

  const [enabled, setEnabled] = useState(false);
  const [drafts, setDrafts] = useState<DraftItem[]>([]);
  const [baseline, setBaseline] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<DraftItem | null>(null);
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const initFor = useRef<number | null>(null);

  const snapshot = (e: boolean, d: DraftItem[]) => JSON.stringify({ e, items: draftToItems(d) });

  useEffect(() => {
    if (configQ.data && initFor.current !== reunionId) {
      initFor.current = reunionId;
      const d = toDraft(configQ.data.items);
      setEnabled(configQ.data.enabled);
      setDrafts(d);
      setBaseline(snapshot(configQ.data.enabled, d));
    }
  }, [configQ.data, reunionId]);

  const dirty = useMemo(() => baseline !== "" && snapshot(enabled, drafts) !== baseline, [enabled, drafts, baseline]);
  const visibleCount = drafts.filter((d) => d.visible).length;
  const missingTemplates = CHECKLIST_TEMPLATES.filter(
    (t) => !drafts.some((d) => d.title.trim().toLowerCase() === t.title.toLowerCase()),
  );

  const update = (key: string, patch: Partial<DraftItem>) => {
    setFeedback(null);
    setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  };
  const add = (seed?: Partial<DraftItem>) => {
    setFeedback(null);
    setDrafts((ds) => ds.length >= MAX_ITEMS ? ds : [...ds, { key: newDraftKey(), title: "", description: "", link: "", kind: "manual", visible: true, ...seed }]);
  };
  const move = (index: number, dir: -1 | 1) => {
    setDrafts((ds) => {
      const t = index + dir;
      if (t < 0 || t >= ds.length) return ds;
      const n = [...ds];
      [n[index], n[t]] = [n[t], n[index]];
      return n;
    });
  };
  const remove = (key: string) => setDrafts((ds) => ds.filter((d) => d.key !== key));

  const onSave = () => {
    setShowErrors(true);
    if (drafts.some((d) => draftError(d))) {
      setFeedback({ kind: "error", message: "Fix the highlighted items before saving." });
      return;
    }
    setFeedback(null);
    save.mutate(
      { reunionId, data: { enabled, items: draftToItems(drafts) } },
      {
        onSuccess: (saved) => {
          const d = toDraft(saved.items);
          setEnabled(saved.enabled);
          setDrafts(d);
          setBaseline(snapshot(saved.enabled, d));
          setShowErrors(false);
          queryClient.setQueryData(getGetChecklistConfigQueryKey(reunionId), saved);
          setFeedback({ kind: "success", message: "Checklist saved. Members see the change within a minute." });
          toast({ title: "Checklist saved" });
        },
        onError: (error) => {
          const message = errorMessage(error, "Could not save the checklist. Your edits are still here; try again.");
          setFeedback({ kind: "error", message });
          toast({ title: "Could not save checklist", description: message, variant: "destructive" });
        },
      },
    );
  };

  return (
    <section className="bg-card border shadow-sm rounded-3xl p-6 md:p-8 space-y-6" data-testid="section-checklist-editor">
      <div>
        <h2 className="font-serif text-2xl font-bold">Member Checklist</h2>
        <p className="text-sm text-muted-foreground mt-1">
          A short to-do list every signed-in member sees from the event hub. Automatic items tick themselves off from registration and payment records.
        </p>
      </div>

      {configQ.isLoading ? (
        <div className="space-y-3"><Skeleton className="h-16 rounded-xl" /><Skeleton className="h-28 rounded-xl" /></div>
      ) : configQ.isError && !configQ.data ? (
        <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive flex items-center justify-between gap-3">
          <span className="font-medium">Could not load the checklist settings.</span>
          <Button type="button" variant="outline" size="sm" onClick={() => configQ.refetch()} className="rounded-full gap-1.5" data-testid="button-retry-checklist-config">
            <RotateCw className="w-3.5 h-3.5" /> Retry
          </Button>
        </div>
      ) : (
        <fieldset disabled={save.isPending} className="space-y-6 min-w-0">
          <div className="flex flex-row items-center justify-between rounded-xl border p-4">
            <div className="space-y-0.5">
              <label htmlFor="checklist-enabled" className="font-bold text-base">Show checklist to members</label>
              <div className="text-sm text-muted-foreground">
                {enabled
                  ? visibleCount > 0 ? `Members will see ${visibleCount} visible ${visibleCount === 1 ? "item" : "items"}.` : "On, but members see nothing until at least one item is visible."
                  : "Off. Members do not see a checklist button."}
              </div>
            </div>
            <Switch id="checklist-enabled" checked={enabled} onCheckedChange={(v) => { setFeedback(null); setEnabled(v); }} data-testid="switch-checklist-enabled" />
          </div>

          {drafts.length === 0 && (
            <div className="rounded-2xl border border-dashed bg-muted/30 p-6 text-center">
              <p className="font-semibold">No checklist items yet.</p>
              <p className="text-sm text-muted-foreground mt-1">Start blank or pull in the suggested items below. Nothing is saved until you press Save.</p>
            </div>
          )}

          <ol className="space-y-3">
            {drafts.map((d, i) => {
              const err = showErrors ? draftError(d) : null;
              const saved = d.id != null;
              return (
                <li key={d.key} data-testid={`row-checklist-draft-${i}`} className={`rounded-2xl border p-4 space-y-3 ${d.visible ? "" : "bg-muted/40"} ${err ? "border-destructive/60" : ""}`}>
                  <div className="flex items-start gap-2">
                    <span className="mt-2 w-6 text-sm font-bold tabular-nums text-muted-foreground">{i + 1}.</span>
                    <Input value={d.title} maxLength={160} placeholder="Item title" aria-label={`Item ${i + 1} title`}
                      onChange={(e) => update(d.key, { title: e.target.value })} className="rounded-xl bg-muted/50 font-semibold" data-testid={`input-checklist-title-${i}`} />
                    <div className="flex shrink-0">
                      <Button type="button" variant="ghost" size="icon" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move item ${i + 1} up`}><ArrowUp className="w-4 h-4" /></Button>
                      <Button type="button" variant="ghost" size="icon" disabled={i === drafts.length - 1} onClick={() => move(i, 1)} aria-label={`Move item ${i + 1} down`}><ArrowDown className="w-4 h-4" /></Button>
                      <Button type="button" variant="ghost" size="icon" onClick={() => update(d.key, { visible: !d.visible })}
                        aria-label={d.visible ? `Hide item ${i + 1}` : `Show item ${i + 1}`} aria-pressed={!d.visible} data-testid={`button-checklist-visibility-${i}`}>
                        {d.visible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                      </Button>
                      <Button type="button" variant="ghost" size="icon" className="text-destructive hover:text-destructive"
                        onClick={() => (saved ? setConfirmRemove(d) : remove(d.key))} aria-label={`Remove item ${i + 1}`} data-testid={`button-checklist-remove-${i}`}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="pl-8 space-y-3">
                    <Textarea value={d.description} rows={2} maxLength={2000} placeholder="Description (optional)" aria-label={`Item ${i + 1} description`}
                      onChange={(e) => update(d.key, { description: e.target.value })} className="rounded-xl bg-muted/50" />
                    <Input value={d.link} maxLength={2048} placeholder="https://link (optional)" aria-label={`Item ${i + 1} link`} inputMode="url"
                      onChange={(e) => update(d.key, { link: e.target.value })} className="rounded-xl bg-muted/50" data-testid={`input-checklist-link-${i}`} />
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      {saved ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 font-semibold text-muted-foreground" title="Type is fixed once saved">
                          <Lock className="w-3.5 h-3.5" /> {KIND_LABELS[d.kind]}
                        </span>
                      ) : (
                        <label className="inline-flex items-center gap-2">
                          <span className="font-semibold">Type</span>
                          <select value={d.kind} onChange={(e) => update(d.key, { kind: e.target.value as ChecklistItemKind })}
                            className="rounded-xl border bg-muted/50 px-3 py-1.5" data-testid={`select-checklist-kind-${i}`}>
                            {(Object.keys(KIND_LABELS) as ChecklistItemKind[]).map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
                          </select>
                          <span className="text-xs text-muted-foreground">Fixed after saving.</span>
                        </label>
                      )}
                      {!d.visible && <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Hidden from members</span>}
                      {!saved && <span className="text-xs font-bold uppercase tracking-wide text-primary">New</span>}
                    </div>
                    {err && <p role="alert" className="text-sm font-medium text-destructive">{err}</p>}
                  </div>
                </li>
              );
            })}
          </ol>

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => add()} disabled={drafts.length >= MAX_ITEMS} className="rounded-full font-bold gap-2" data-testid="button-add-checklist-item">
              <Plus className="w-4 h-4" /> Add item
            </Button>
          </div>

          {missingTemplates.length > 0 && drafts.length < MAX_ITEMS && (
            <div className="rounded-2xl border bg-muted/30 p-4">
              <p className="flex items-center gap-2 text-sm font-bold"><Sparkles className="w-4 h-4 text-primary" /> Suggestions</p>
              <p className="text-xs text-muted-foreground mt-0.5 mb-3">Tap to add to your draft. Nothing changes for members until you save.</p>
              <div className="flex flex-wrap gap-2">
                {missingTemplates.map((t) => (
                  <button key={t.title} type="button" onClick={() => add({ title: t.title, description: t.description ?? "", kind: t.kind })}
                    className="inline-flex items-center gap-1.5 rounded-full border bg-background px-3 py-1.5 text-sm font-semibold hover:border-primary hover:text-primary transition-colors"
                    data-testid={`button-template-${t.kind}-${t.title.replace(/\s+/g, "-").toLowerCase()}`}>
                    <Plus className="w-3.5 h-3.5" /> {t.title}
                    <span className="text-xs font-medium text-muted-foreground">{t.kind === "manual" ? "manual" : "automatic"}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {feedback && (
            <div role={feedback.kind === "error" ? "alert" : "status"} aria-live="polite" data-testid="status-checklist-save"
              className={feedback.kind === "error"
                ? "rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm font-medium text-destructive"
                : "rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm font-medium text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-100"}>
              {feedback.message}
            </div>
          )}

          <Button type="button" onClick={onSave} disabled={save.isPending || !dirty} className="rounded-full w-full py-6 font-bold text-lg shadow-md" data-testid="button-save-checklist">
            {save.isPending ? "Saving..." : dirty ? "Save Checklist" : "Checklist saved"}
          </Button>
        </fieldset>
      )}

      <AlertDialog open={!!confirmRemove} onOpenChange={(o) => !o && setConfirmRemove(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove "{confirmRemove?.title || "this item"}"?</AlertDialogTitle>
            <AlertDialogDescription>
              When you save, every member's progress on this item is erased. To keep progress but stop showing it, hide the item instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep item</AlertDialogCancel>
            <AlertDialogAction data-testid="button-confirm-remove-checklist" className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (confirmRemove) remove(confirmRemove.key); setConfirmRemove(null); }}>
              Remove item
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
