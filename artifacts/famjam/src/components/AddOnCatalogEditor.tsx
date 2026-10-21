import type { AddOnOptionGroup, ReunionFee } from "@workspace/api-client-react";
import { Plus, Trash2, Layers } from "lucide-react";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { Switch } from "./ui/switch";
import { adjustmentLabel, centsLabel } from "../lib/addOns";

type ValueRow = { id: string; label: string; adjustment: string; active: boolean; saved: boolean };
type GroupRow = { id: string; label: string; saved: boolean; values: ValueRow[] };
export type AddOnDraft = { basePrice: string; retired: boolean; groups: GroupRow[] };

export function emptyAddOnDraft(): AddOnDraft {
  return { basePrice: "", retired: false, groups: [] };
}

const dollars = (cents: number) => (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2);

export function addOnDraftFromFee(fee: ReunionFee): AddOnDraft {
  return {
    basePrice: dollars(fee.basePriceCents ?? Math.round(fee.amount * 100)),
    retired: !!fee.retired,
    groups: (fee.optionGroups ?? []).map((g) => ({
      id: g.id,
      label: g.label,
      saved: true,
      values: g.values.map((v) => ({ id: v.id, label: v.label, adjustment: v.adjustmentCents ? dollars(v.adjustmentCents) : "", active: v.active, saved: true })),
    })),
  };
}

/** Parse "$12.50" style input into integer cents. */
export function parseCents(raw: string): number | null {
  const t = raw.trim().replace(/^\$/, "");
  if (t === "") return 0;
  if (!/^-?\d+(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}

export function slugId(label: string, taken: string[]): string {
  const base = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "option";
  let id = base;
  let n = 2;
  while (taken.includes(id)) id = `${base}-${n++}`;
  return id;
}

export function addOnDraftToPayload(d: AddOnDraft): { basePriceCents: number; optionGroups: AddOnOptionGroup[] } | { error: string } {
  const base = parseCents(d.basePrice);
  if (base == null || base < 0) return { error: "Enter a valid base price (for example 10 or 12.50)." };
  const groupIds = new Set<string>();
  const optionGroups: AddOnOptionGroup[] = [];
  for (const g of d.groups) {
    const label = g.label.trim();
    if (!label) return { error: "Every option group needs a name." };
    const gid = g.id.trim() || slugId(label, [...groupIds]);
    if (groupIds.has(gid)) return { error: `Two option groups share the ID "${gid}".` };
    groupIds.add(gid);
    if (g.values.length === 0) return { error: `"${label}" needs at least one choice.` };
    const valueIds = new Set<string>();
    const values = [];
    for (const v of g.values) {
      const vl = v.label.trim();
      if (!vl) return { error: `Every choice in "${label}" needs a name.` };
      const adj = parseCents(v.adjustment);
      if (adj == null) return { error: `"${vl}" has an invalid price adjustment.` };
      if (base + adj < 0) return { error: `"${vl}" would make the price negative.` };
      const vid = v.id.trim() || slugId(vl, [...valueIds]);
      if (valueIds.has(vid)) return { error: `Two choices in "${label}" share the ID "${vid}".` };
      valueIds.add(vid);
      values.push({ id: vid, label: vl, adjustmentCents: adj, active: v.active });
    }
    if (!values.some((v) => v.active)) return { error: `"${label}" needs at least one active choice.` };
    optionGroups.push({ id: gid, label, values });
  }
  return { basePriceCents: base, optionGroups };
}

/** Organizer editor for one generic add-on: base price, option groups, choices, adjustments. */
export function AddOnCatalogEditor({ value, onChange }: { value: AddOnDraft; onChange: (next: AddOnDraft) => void }) {
  const base = parseCents(value.basePrice) ?? 0;
  const setGroup = (gi: number, patch: Partial<GroupRow>) =>
    onChange({ ...value, groups: value.groups.map((g, i) => (i === gi ? { ...g, ...patch } : g)) });
  const setValue = (gi: number, vi: number, patch: Partial<ValueRow>) =>
    setGroup(gi, { values: value.groups[gi].values.map((v, i) => (i === vi ? { ...v, ...patch } : v)) });
  const addGroup = () =>
    onChange({ ...value, groups: [...value.groups, { id: "", label: "", saved: false, values: [{ id: "", label: "", adjustment: "", active: true, saved: false }] }] });
  const addValue = (gi: number) =>
    setGroup(gi, { values: [...value.groups[gi].values, { id: "", label: "", adjustment: "", active: true, saved: false }] });

  const extremes = value.groups.reduce(
    (acc, g) => {
      const adj = g.values.filter((v) => v.active).map((v) => parseCents(v.adjustment) ?? 0);
      return adj.length ? [acc[0] + Math.min(...adj), acc[1] + Math.max(...adj)] : acc;
    },
    [base, base],
  );

  return (
    <div className="rounded-2xl border border-primary/25 bg-primary/[0.03] p-4 space-y-4" data-testid="addon-catalog-editor">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-bold block mb-1">Base price ($)</label>
          <Input
            inputMode="decimal"
            className="rounded-xl bg-background"
            placeholder="e.g. 10 or 12.50"
            value={value.basePrice}
            onChange={(e) => onChange({ ...value, basePrice: e.target.value })}
            data-testid="input-addon-base-price"
          />
        </div>
        <div className="flex items-center justify-between gap-3 rounded-xl border bg-background px-3 py-2">
          <div>
            <div className="text-sm font-bold">Retired</div>
            <div className="text-xs text-muted-foreground">Stops new orders. Saved purchases stay billed.</div>
          </div>
          <Switch checked={value.retired} onCheckedChange={(v) => onChange({ ...value, retired: v })} data-testid="switch-addon-retired" />
        </div>
      </div>

      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-bold"><Layers className="h-4 w-4 text-primary" /> Option groups</div>
        <div className="text-xs text-muted-foreground tabular-nums" data-testid="text-addon-price-range">
          Charges {extremes[0] === extremes[1] ? centsLabel(extremes[0]) : `${centsLabel(Math.max(0, extremes[0]))} to ${centsLabel(extremes[1])}`}
        </div>
      </div>
      {value.groups.length === 0 && (
        <p className="text-xs text-muted-foreground">No options. Families just say yes or no. Add a group for things like size, color, or material.</p>
      )}

      {value.groups.map((g, gi) => (
        <div key={gi} className="rounded-xl border bg-background p-3 space-y-2" data-testid={`addon-group-${gi}`}>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[10rem]">
              <label className="text-xs font-bold block mb-1">Group name</label>
              <Input className="rounded-lg h-9" placeholder="e.g. Size, Color, Material" value={g.label}
                onChange={(e) => setGroup(gi, { label: e.target.value })} data-testid={`input-group-label-${gi}`} />
            </div>
            <div className="w-36">
              <label className="text-xs font-bold block mb-1">ID</label>
              <Input className="rounded-lg h-9 font-mono text-xs" placeholder="auto" value={g.id} disabled={g.saved}
                title={g.saved ? "Saved IDs stay fixed so past purchases still match" : "Leave blank to generate from the name"}
                onChange={(e) => setGroup(gi, { id: e.target.value })} data-testid={`input-group-id-${gi}`} />
            </div>
            {!g.saved && (
              <Button type="button" variant="ghost" size="icon" className="text-destructive hover:text-destructive" aria-label="Remove group"
                onClick={() => onChange({ ...value, groups: value.groups.filter((_, i) => i !== gi) })}>
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
          <div className="space-y-1.5">
            {g.values.map((v, vi) => {
              const adj = parseCents(v.adjustment) ?? 0;
              return (
                <div key={vi} className={`flex flex-wrap items-center gap-2 rounded-lg px-2 py-1.5 ${v.active ? "bg-muted/40" : "bg-muted/20 opacity-70"}`}>
                  <Input className="h-8 flex-1 min-w-[7rem] rounded-md" placeholder="Choice, e.g. XL" value={v.label}
                    onChange={(e) => setValue(gi, vi, { label: e.target.value })} data-testid={`input-value-label-${gi}-${vi}`} />
                  <Input className="h-8 w-24 rounded-md font-mono text-xs" placeholder="id" value={v.id} disabled={v.saved}
                    onChange={(e) => setValue(gi, vi, { id: e.target.value })} data-testid={`input-value-id-${gi}-${vi}`} />
                  <div className="relative w-24">
                    <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">+$</span>
                    <Input className="h-8 pl-7 rounded-md tabular-nums" inputMode="decimal" placeholder="0" value={v.adjustment}
                      onChange={(e) => setValue(gi, vi, { adjustment: e.target.value })} data-testid={`input-value-adjust-${gi}-${vi}`} />
                  </div>
                  <span className="w-16 text-right text-xs tabular-nums text-muted-foreground">{centsLabel(Math.max(0, base + adj))}</span>
                  <label className="flex items-center gap-1.5 text-xs">
                    <Switch checked={v.active} onCheckedChange={(on) => setValue(gi, vi, { active: on })} data-testid={`switch-value-active-${gi}-${vi}`} />
                    {v.active ? "Active" : "Retired"}
                  </label>
                  {!v.saved && g.values.length > 1 && (
                    <button type="button" className="text-muted-foreground hover:text-destructive" aria-label="Remove choice"
                      onClick={() => setGroup(gi, { values: g.values.filter((_, i) => i !== vi) })}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {adj !== 0 && <span className="sr-only">{adjustmentLabel(adj)}</span>}
                </div>
              );
            })}
          </div>
          <Button type="button" variant="ghost" size="sm" className="rounded-full gap-1 text-xs" onClick={() => addValue(gi)} data-testid={`button-add-value-${gi}`}>
            <Plus className="h-3.5 w-3.5" /> Add choice
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" className="rounded-full gap-2 font-bold" onClick={addGroup} disabled={value.groups.length >= 10} data-testid="button-add-option-group">
        <Plus className="h-4 w-4" /> Add option group
      </Button>
      <p className="text-xs text-muted-foreground">Saved choices can be retired but not deleted, so past orders keep their labels and prices.</p>
    </div>
  );
}
