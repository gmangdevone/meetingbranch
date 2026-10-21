import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useUpdateMyRegistrationView, type RegistrationView } from "@workspace/api-client-react";
import { AlertTriangle, Check, Loader2, RotateCcw } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import {
  ACTION_FIELDS, DEFAULT_FIELDS, FIELD_LABEL, PRESETS, VIEW_FIELDS,
  matchPreset, normalizeFields, sameFields, type PresetKey, type ViewField,
} from "../../lib/registrationView";

function errorText(err: unknown) {
  const e = err as { data?: { error?: string }; error?: string; message?: string } | null;
  return e?.data?.error || e?.error || e?.message || "The server did not accept the change.";
}

export function CustomizeViewDialog({
  open, onOpenChange, current, queryKey, onSaved, needsRepair = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  current: ViewField[];
  queryKey: readonly unknown[];
  onSaved: () => void;
  needsRepair?: boolean;
}) {
  const queryClient = useQueryClient();
  const save = useUpdateMyRegistrationView();
  const [draft, setDraft] = useState<ViewField[]>(current);
  const [error, setError] = useState<string | null>(null);

  // Fresh draft every time the dialog opens; never carry stale edits forward.
  useEffect(() => {
    if (open) {
      setDraft(normalizeFields(current));
      setError(null);
      save.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const preset = matchPreset(draft);
  const toggle = (f: ViewField, on: boolean) =>
    setDraft((d) => normalizeFields(on ? [...d, f] : d.filter((x) => x !== f)));

  const submit = () => {
    setError(null);
    const fields = normalizeFields(draft);
    save.mutate({ data: { fields } }, {
      onSuccess: (res: RegistrationView) => {
        queryClient.setQueryData(queryKey, { ...res, fields: normalizeFields(res.fields) });
        onSaved();
        onOpenChange(false);
      },
      onError: (err) => setError(errorText(err)),
    });
  };

  const unchanged = !needsRepair && sameFields(draft, current);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!save.isPending) onOpenChange(o); }}>
      <DialogContent className="rounded-3xl p-6 sm:p-7 max-w-md max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl">Customize view</DialogTitle>
          <DialogDescription>
            Choose what shows in your registration list. This only changes your own view, across every event you manage.
            Hidden items stay in each registration's menu.
          </DialogDescription>
        </DialogHeader>

        <fieldset className="mt-1">
          <legend className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground mb-2">Presets</legend>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2" role="radiogroup" aria-label="View presets">
            {(Object.keys(PRESETS) as PresetKey[]).map((key) => {
              const active = preset === key;
              return (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  data-testid={`button-preset-${key}`}
                  onClick={() => setDraft([...PRESETS[key].fields])}
                  className={`text-left rounded-xl border px-3 py-2 text-sm transition-colors ${active ? "border-primary bg-primary/5 text-primary font-bold" : "hover:bg-muted/40"}`}
                >
                  <span className="flex items-center gap-1.5">{active && <Check className="w-3.5 h-3.5" aria-hidden />}{PRESETS[key].label}</span>
                  <span className="block text-[11px] font-normal text-muted-foreground mt-0.5">
                    {["Registrant", ...PRESETS[key].fields.map((f) => FIELD_LABEL[f])].join(", ")}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground mt-2" data-testid="text-preset-state">
            {preset ? `Using the ${PRESETS[preset].label} preset.` : "Custom selection."}
          </p>
        </fieldset>

        <fieldset className="mt-2">
          <legend className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground mb-2">Columns and actions</legend>
          <div className="rounded-xl border divide-y">
            <div className="flex items-center gap-3 px-3 py-2 text-sm text-muted-foreground">
              <Checkbox checked disabled aria-label="Registrant (always shown)" />
              <span>Registrant and registration menu <span className="text-[11px]">(always shown)</span></span>
            </div>
            {VIEW_FIELDS.map((f) => (
              <label key={f} className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-muted/30 transition-colors">
                <Checkbox
                  checked={draft.includes(f)}
                  onCheckedChange={(c) => toggle(f, c === true)}
                  data-testid={`checkbox-field-${f}`}
                  aria-label={FIELD_LABEL[f]}
                />
                <span className="flex-1">{FIELD_LABEL[f]}</span>
                {ACTION_FIELDS.includes(f) && <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Action</span>}
              </label>
            ))}
          </div>
        </fieldset>

        {error && (
          <div role="alert" data-testid="text-save-error" className="flex gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />
            <span>Your view was not saved. {error}</span>
          </div>
        )}

        <div className="flex flex-wrap justify-between gap-2 pt-3 border-t">
          <Button
            type="button"
            variant="ghost"
            className="rounded-xl"
            data-testid="button-reset-view"
            onClick={() => setDraft([...DEFAULT_FIELDS])}
            disabled={save.isPending}
          >
            <RotateCcw className="w-4 h-4 mr-2" aria-hidden /> Reset to default
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="rounded-xl" onClick={() => onOpenChange(false)} disabled={save.isPending}>Cancel</Button>
            <Button type="button" className="rounded-xl" onClick={submit} disabled={save.isPending || unchanged} data-testid="button-save-view">
              {save.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden /> Saving</> : "Save view"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
