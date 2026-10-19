import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useUser } from "@clerk/react";
import {
  useGetMyChecklist,
  getGetMyChecklistQueryKey,
  useSetChecklistCompletion,
  type MemberChecklist,
  type ChecklistItem,
} from "@workspace/api-client-react";
import { AlertTriangle, Check, ChevronDown, ExternalLink, ListChecks, Loader2, RotateCw, X } from "lucide-react";
import { checklistButtonLabel, errorMessage, isAutomatic, safeChecklistLink } from "../../lib/checklist";

/** Query key scoped to both the reunion and the signed-in identity. */
export function memberChecklistKey(reunionId: number, userId: string | null | undefined) {
  return [...getGetMyChecklistQueryKey(reunionId), { user: userId ?? "anon" }] as const;
}

export function useMemberChecklist(reunionId: number | undefined) {
  const { isSignedIn, user } = useUser();
  const id = reunionId ?? 0;
  return useGetMyChecklist(id, {
    query: {
      enabled: !!isSignedIn && !!reunionId,
      queryKey: memberChecklistKey(id, user?.id),
      refetchOnMount: "always",
      refetchOnWindowFocus: true,
      refetchInterval: 30_000,
      retry: 1,
    },
  });
}

export function visibleItems(data: MemberChecklist | undefined): ChecklistItem[] {
  return (data?.items ?? []).filter((i) => i.visible).sort((a, b) => a.sortOrder - b.sortOrder);
}

export function ChecklistHeroButton({
  data, isError, isRefetching, open, onToggle, onRetry,
}: {
  data: MemberChecklist | undefined;
  isError: boolean;
  isRefetching: boolean;
  open: boolean;
  onToggle: () => void;
  onRetry: () => void;
}) {
  if (isError && !data) {
    return (
      <div role="alert" data-testid="status-checklist-error" className="inline-flex items-center gap-3 rounded-2xl border border-white/25 bg-black/30 backdrop-blur-sm px-4 py-2.5 text-sm font-medium text-white">
        <AlertTriangle className="w-4 h-4 shrink-0 text-amber-300" />
        <span>Checklist could not load.</span>
        <button type="button" onClick={onRetry} disabled={isRefetching} data-testid="button-checklist-retry"
          className="inline-flex items-center gap-1 font-bold underline underline-offset-2 hover:text-white/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60 rounded">
          <RotateCw className={`w-3.5 h-3.5 ${isRefetching ? "animate-spin" : ""}`} /> Retry
        </button>
      </div>
    );
  }
  const items = visibleItems(data);
  if (!data?.enabled || items.length === 0) return null;
  const done = items.filter((i) => i.completed).length;
  const all = done === items.length;
  const pct = Math.round((done / items.length) * 100);
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls="member-checklist-panel"
      data-testid="button-my-checklist"
      className="group inline-flex items-center gap-3 rounded-2xl border border-white/25 bg-white/15 backdrop-blur-sm pl-3 pr-4 py-2.5 text-left text-white shadow-lg transition-colors hover:bg-white/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
    >
      <span className="relative grid place-items-center w-10 h-10 shrink-0">
        <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90" aria-hidden="true">
          <circle cx="18" cy="18" r="15.5" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
          <circle cx="18" cy="18" r="15.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"
            strokeDasharray={`${(pct / 100) * 97.4} 97.4`} className="transition-all duration-700" />
        </svg>
        {all ? <Check className="w-4 h-4" /> : <ListChecks className="w-4 h-4" />}
      </span>
      <span className="font-bold text-sm md:text-base">{checklistButtonLabel(done, items.length)}</span>
      <ChevronDown className={`w-4 h-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
    </button>
  );
}

export function ChecklistPanel({
  data, pendingItemId, itemErrors, onToggleItem, onClose, isError,
}: {
  data: MemberChecklist;
  pendingItemId: number | null;
  itemErrors: Record<number, string>;
  onToggleItem: (item: ChecklistItem, completed: boolean) => void;
  onClose: () => void;
  isError: boolean;
}) {
  const items = visibleItems(data);
  const done = items.filter((i) => i.completed).length;
  const pct = items.length ? Math.round((done / items.length) * 100) : 0;
  return (
    <section id="member-checklist-panel" data-testid="panel-member-checklist" aria-labelledby="checklist-heading"
      className="bg-green-100/60 dark:bg-green-950/30 border border-green-200/60 dark:border-green-800/40 shadow-sm rounded-3xl p-6 md:p-8 animate-in fade-in slide-in-from-top-2 duration-300">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-1">My Checklist</p>
          <h2 id="checklist-heading" className="font-serif text-2xl font-bold">Your current checklist</h2>
        </div>
        <button type="button" onClick={onClose} aria-label="Close checklist" data-testid="button-close-checklist"
          className="rounded-full p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="mb-6">
        <div className="flex justify-between text-sm font-semibold mb-2">
          <span data-testid="text-checklist-progress">{done} of {items.length} complete</span>
          <span className="tabular-nums text-muted-foreground">{pct}%</span>
        </div>
        <div className="h-2.5 rounded-full bg-muted overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={done} aria-label="Checklist progress">
          <div className="h-full rounded-full bg-primary transition-transform duration-700 origin-left" style={{ transform: `scaleX(${pct / 100})` }} />
        </div>
      </div>

      {isError && (
        <p role="alert" className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
          Could not refresh your checklist. Showing the last known status.
        </p>
      )}

      <ol className="flex flex-col gap-3">
        {items.map((item) => {
          const auto = isAutomatic(item.kind);
          const link = safeChecklistLink(item.link);
          const pending = pendingItemId === item.id;
          const err = item.id != null ? itemErrors[item.id] : undefined;
          return (
            <li key={item.id ?? item.title} data-testid={`row-checklist-item-${item.id}`}
              className={`flex gap-4 rounded-2xl border p-4 transition-colors ${item.completed ? "bg-muted/40" : "bg-background"}`}>
              {auto ? (
                <span aria-hidden="true" className={`mt-0.5 grid place-items-center w-6 h-6 shrink-0 rounded-full border-2 ${item.completed ? "bg-primary border-primary text-primary-foreground" : "border-dashed border-muted-foreground/50"}`}>
                  {item.completed && <Check className="w-3.5 h-3.5" />}
                </span>
              ) : (
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={!!item.completed}
                  aria-label={`Mark ${item.title} ${item.completed ? "not done" : "done"}`}
                  disabled={pendingItemId !== null || item.id == null}
                  onClick={() => onToggleItem(item, !item.completed)}
                  data-testid={`checkbox-checklist-item-${item.id}`}
                  className={`mt-0.5 grid place-items-center w-6 h-6 shrink-0 rounded-md border-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait ${item.completed ? "bg-primary border-primary text-primary-foreground" : "border-muted-foreground/60 hover:border-primary"}`}
                >
                  {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : item.completed ? <Check className="w-3.5 h-3.5" /> : null}
                </button>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className={`font-bold ${item.completed ? "text-muted-foreground line-through decoration-2" : ""}`}>{item.title}</span>
                  {auto && (
                    <span data-testid={`status-checklist-auto-${item.id}`}
                      className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${item.completed ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"}`}>
                      {item.statusText || (item.completed ? "Done" : "Not yet")}
                    </span>
                  )}
                </div>
                {item.description && <p className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap break-words">{item.description}</p>}
                {link && (
                  <a href={link} target="_blank" rel="noopener noreferrer" data-testid={`link-checklist-item-${item.id}`}
                    className="mt-2 inline-flex items-center gap-1 text-sm font-bold text-primary hover:underline break-all">
                    Open link <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
                {auto && <p className="mt-1 text-xs text-muted-foreground">Updates automatically.</p>}
                {err && <p role="alert" className="mt-2 text-sm font-medium text-destructive">{err}</p>}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** Hook wiring query + completion mutation for the hub page. */
export function useChecklistController(reunionId: number | undefined) {
  const { user } = useUser();
  const queryClient = useQueryClient();
  const query = useMemberChecklist(reunionId);
  const mutation = useSetChecklistCompletion();
  const [pendingItemId, setPendingItemId] = useState<number | null>(null);
  const [itemErrors, setItemErrors] = useState<Record<number, string>>({});
  const saving = useRef(false);

  const toggleItem = (item: ChecklistItem, completed: boolean) => {
    if (saving.current || !reunionId || item.id == null || isAutomatic(item.kind)) return;
    saving.current = true;
    const itemId = item.id;
    setPendingItemId(itemId);
    setItemErrors((e) => { const n = { ...e }; delete n[itemId]; return n; });
    mutation.mutate(
      { reunionId, itemId, data: { completed } },
      {
        // The checkbox only changes after the server confirms, via a fresh read.
        onSuccess: () => queryClient.invalidateQueries({ queryKey: memberChecklistKey(reunionId, user?.id) }),
        onError: (error) => setItemErrors((e) => ({ ...e, [itemId]: errorMessage(error, "Could not save. Check your connection and try again.") })),
        onSettled: () => { saving.current = false; setPendingItemId(null); },
      },
    );
  };

  return { query, pendingItemId, itemErrors, toggleItem };
}
