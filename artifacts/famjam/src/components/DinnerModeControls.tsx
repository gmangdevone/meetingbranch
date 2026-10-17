import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useUpdateDinnerMode, type ReunionFee } from "@workspace/api-client-react";
import { Utensils } from "lucide-react";
import { isDinnerFee } from "../lib/fees";

type Mode = "hidden" | "optional" | "mandatory";

const MODES: { value: Mode; label: string; hint: string }[] = [
  { value: "hidden", label: "Hidden", hint: "Not offered on new registrations. Saved selections stay." },
  { value: "optional", label: "Optional", hint: "Selected for each attendee by default; members can uncheck." },
  { value: "mandatory", label: "Mandatory", hint: "Included for everyone. Only organizers can exempt an attendee." },
];

/** Dinner visibility/requirement only. Never touches pricing. */
export function DinnerModeControls({ reunionId, fees }: { reunionId: number; fees: ReunionFee[] }) {
  const dinners = fees.filter(isDinnerFee);
  if (dinners.length === 0) return null;
  return (
    <section className="rounded-2xl border bg-muted/30 p-4 space-y-3" aria-label="Dinner settings">
      <div className="flex items-center gap-2">
        <Utensils className="w-4 h-4 text-primary" />
        <h3 className="font-bold">Dinner settings</h3>
      </div>
      <p className="text-xs text-muted-foreground">
        Choose whether each dinner is hidden, optional, or required. Changing this never removes dinners already saved on registrations.
      </p>
      {dinners.map((fee) => <DinnerModeRow key={fee.id} reunionId={reunionId} fee={fee} />)}
    </section>
  );
}

function DinnerModeRow({ reunionId, fee }: { reunionId: number; fee: ReunionFee }) {
  const queryClient = useQueryClient();
  const mutation = useUpdateDinnerMode();
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const current = (fee.dinnerMode ?? null) as Mode | null;

  const choose = (mode: Mode) => {
    if (mode === current) return;
    setFeedback(null);
    mutation.mutate(
      { reunionId, feeId: fee.id, data: { dinnerMode: mode } },
      {
        onSuccess: async () => {
          // Mode affects reunion fees, registration forms, lists, totals and reports.
          await queryClient.invalidateQueries();
          setFeedback({ ok: true, text: `${fee.label} is now ${mode}.` });
        },
        onError: () => setFeedback({ ok: false, text: "Could not save the dinner setting. Please try again." }),
      },
    );
  };

  return (
    <div className="rounded-xl border bg-card p-3 space-y-2" data-testid={`dinner-mode-${fee.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{fee.label}</span>
        {current == null && (
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Legacy: follows the fee's optional setting</span>
        )}
      </div>
      <div role="radiogroup" aria-label={`${fee.label} mode`} className="grid grid-cols-3 gap-1 rounded-xl bg-muted p-1">
        {MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            role="radio"
            aria-checked={current === m.value}
            disabled={mutation.isPending}
            onClick={() => choose(m.value)}
            title={m.hint}
            className={`rounded-lg px-2 py-1.5 text-sm font-medium transition-colors disabled:opacity-60 ${current === m.value ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            {m.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{MODES.find((m) => m.value === current)?.hint ?? "Pick a mode to manage this dinner per attendee."}</p>
      {mutation.isPending && <p role="status" className="text-xs">Saving...</p>}
      {feedback && (
        <p role={feedback.ok ? "status" : "alert"} className={`text-xs font-medium ${feedback.ok ? "text-emerald-700 dark:text-emerald-300" : "text-destructive"}`}>
          {feedback.text}
        </p>
      )}
    </div>
  );
}
