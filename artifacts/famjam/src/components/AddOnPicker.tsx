import type { AddOnPurchase, ReunionFee } from "@workspace/api-client-react";
import { Check, Lock, History } from "lucide-react";
import { Switch } from "./ui/switch";
import {
  adjustmentLabel,
  autoChoices,
  centsLabel,
  describeChoices,
  isRepriced,
  offeredAddOns,
  previewPurchase,
  type AddOnPicks,
  type AddOnScope,
} from "../lib/addOns";

/**
 * Generic add-on selector for one attendee or the household. Every item is
 * configured by organizers; nothing here knows what kind of product it is.
 */
export function AddOnPicker({
  fees,
  scope,
  picks,
  onChange,
  saved = [],
  testIdPrefix,
  showErrors = false,
}: {
  fees: ReunionFee[];
  scope: AddOnScope;
  picks: AddOnPicks;
  onChange: (next: AddOnPicks) => void;
  saved?: AddOnPurchase[];
  testIdPrefix: string;
  showErrors?: boolean;
}) {
  const offered = offeredAddOns(fees, scope);
  // Saved items no longer offered (retired / removed) stay visible and kept as-is.
  const legacy = saved.filter((p) => p.feeId in picks && !offered.some((f) => f.id === p.feeId));
  if (offered.length === 0 && legacy.length === 0) return null;

  const setChoice = (fee: ReunionFee, groupId: string, valueId: string) =>
    onChange({ ...picks, [fee.id]: { ...(picks[fee.id] ?? {}), [groupId]: valueId } });
  const toggle = (fee: ReunionFee, on: boolean) => {
    const next = { ...picks };
    if (on) {
      const prior = saved.find((p) => p.feeId === fee.id);
      next[fee.id] = prior ? Object.fromEntries(prior.choices.map((c) => [c.groupId, c.valueId])) : autoChoices(fee);
    } else delete next[fee.id];
    onChange(next);
  };

  return (
    <div className="space-y-2" data-testid={`${testIdPrefix}-addons`}>
      {offered.map((fee) => {
        const on = fee.id in picks;
        const required = !fee.isOptional;
        const choices = picks[fee.id] ?? {};
        const preview = previewPurchase(fee, fee.id, choices, saved);
        const priorSaved = saved.some((p) => p.feeId === fee.id);
        const repriced = on && isRepriced(fees, fee.id, choices, saved);
        const newlyRequired = required && saved.length > 0 && !priorSaved;
        return (
          <div
            key={fee.id}
            className={`rounded-2xl border transition-colors ${on ? "border-primary/50 bg-primary/[0.04]" : "border-border bg-muted/30"}`}
            data-testid={`${testIdPrefix}-addon-${fee.id}`}
          >
            <div className="flex items-center gap-3 p-3">
              {required ? (
                <span className="flex h-6 w-11 items-center justify-center rounded-full bg-primary/15 text-primary" aria-label="Required">
                  <Lock className="h-3.5 w-3.5" />
                </span>
              ) : (
                <Switch
                  checked={on}
                  onCheckedChange={(v) => toggle(fee, v)}
                  data-testid={`${testIdPrefix}-toggle-addon-${fee.id}`}
                  aria-label={`Include ${fee.label}`}
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold break-words">{fee.label}</span>
                  {required && <span className="text-[10px] font-bold uppercase tracking-wider text-primary">Required</span>}
                  {newlyRequired && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-900">Newly required</span>}
                </div>
                {on && preview && preview.choices.length > 0 && (
                  <div className="text-xs text-muted-foreground">{describeChoices(preview)}</div>
                )}
              </div>
              <span
                className={`shrink-0 font-bold tabular-nums ${on ? "" : "text-muted-foreground"}`}
                data-testid={`${testIdPrefix}-price-addon-${fee.id}`}
              >
                {on && preview ? (preview.unitPriceCents === 0 ? "Free" : centsLabel(preview.unitPriceCents)) : `from ${centsLabel(fee.basePriceCents ?? Math.round(fee.amount * 100))}`}
              </span>
            </div>
            {on && (fee.optionGroups ?? []).length > 0 && (
              <div className="space-y-3 border-t border-dashed px-3 pb-3 pt-3">
                {(fee.optionGroups ?? []).map((g) => {
                  const current = choices[g.id];
                  const missing = showErrors && !current;
                  return (
                    <div key={g.id}>
                      <div className={`mb-1.5 text-[11px] font-bold uppercase tracking-widest ${missing ? "text-destructive" : "text-muted-foreground"}`}>
                        {g.label}{missing && " · choose one"}
                      </div>
                      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={`${fee.label} ${g.label}`}>
                        {g.values
                          .filter((v) => v.active || v.id === current)
                          .map((v) => {
                            const sel = v.id === current;
                            return (
                              <button
                                type="button"
                                role="radio"
                                aria-checked={sel}
                                key={v.id}
                                onClick={() => setChoice(fee, g.id, v.id)}
                                data-testid={`${testIdPrefix}-choice-${fee.id}-${g.id}-${v.id}`}
                                className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-sm transition-all active:scale-95 ${
                                  sel ? "border-primary bg-primary text-primary-foreground shadow-sm" : "border-border bg-background hover:border-primary/50"
                                } ${!v.active ? "opacity-70" : ""}`}
                              >
                                {sel && <Check className="h-3 w-3" />}
                                <span>{v.label}</span>
                                {v.adjustmentCents !== 0 && (
                                  <span className={`text-xs tabular-nums ${sel ? "text-primary-foreground/80" : "text-muted-foreground"}`}>{adjustmentLabel(v.adjustmentCents)}</span>
                                )}
                                {!v.active && <span className="text-[10px] uppercase">retired</span>}
                              </button>
                            );
                          })}
                      </div>
                    </div>
                  );
                })}
                {repriced && (
                  <p className="text-xs text-amber-800" data-testid={`${testIdPrefix}-repriced-${fee.id}`}>
                    Changing this choice uses today's price. Your saved price was {centsLabel(saved.find((p) => p.feeId === fee.id)!.unitPriceCents)}.
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
      {legacy.map((p) => (
        <div key={`legacy-${p.feeId}`} className="flex items-center gap-3 rounded-2xl border border-dashed p-3 text-sm" data-testid={`${testIdPrefix}-saved-addon-${p.feeId}`}>
          <History className="h-4 w-4 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <span className="font-bold">{p.label}</span>
            {p.choices.length > 0 && <span className="text-muted-foreground"> · {describeChoices(p)}</span>}
            <div className="text-xs text-muted-foreground">No longer offered. Your saved purchase is kept.</div>
          </div>
          <span className="tabular-nums font-bold">{centsLabel(p.unitPriceCents)}</span>
        </div>
      ))}
    </div>
  );
}

/** Read-only list of purchased add-ons. */
export function AddOnPurchaseList({ items, testIdPrefix, emptyText }: { items: AddOnPurchase[] | null | undefined; testIdPrefix: string; emptyText?: string }) {
  if (!items || items.length === 0) return emptyText ? <p className="text-sm text-muted-foreground">{emptyText}</p> : null;
  return (
    <ul className="space-y-1 text-sm" data-testid={`${testIdPrefix}-purchases`}>
      {items.map((p, i) => (
        <li key={`${p.feeId}-${i}`} className="flex justify-between gap-3">
          <span className="min-w-0 break-words">
            <span className="font-medium">{p.label}</span>
            {p.choices.length > 0 && <span className="text-muted-foreground"> · {describeChoices(p)}</span>}
          </span>
          <span className="shrink-0 tabular-nums">{centsLabel(p.unitPriceCents)}</span>
        </li>
      ))}
    </ul>
  );
}
