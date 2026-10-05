import { NotebookPen } from "lucide-react";

/** Approved owner note text, or null when payers must not see it. */
export function approvedInstructions(r: { status?: string; paymentInstructions?: string | null } | null | undefined): string | null {
  return r?.status === "approved" && r.paymentInstructions?.trim() ? r.paymentInstructions.trim() : null;
}

/**
 * Owner-approved special payment instructions. Rendered strictly as a React
 * text node with pre-wrap, so line breaks show and HTML is never interpreted.
 */
export function SpecialInstructionsNote({ text, compact = false }: { text: string; compact?: boolean }) {
  return (
    <div
      className={`relative rounded-2xl border border-amber-300/70 bg-amber-50/80 dark:bg-amber-900/15 dark:border-amber-800/60 ${compact ? "p-3" : "p-4"} pl-5 overflow-hidden`}
      data-testid="special-payment-instructions"
    >
      <span aria-hidden className="absolute inset-y-0 left-0 w-1.5 bg-amber-400/80" />
      <div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-widest text-amber-900/80 dark:text-amber-200/80 mb-1.5">
        <NotebookPen className="w-3.5 h-3.5" /> Special payment instructions
      </div>
      <p className={`whitespace-pre-wrap break-words text-amber-950 dark:text-amber-100 ${compact ? "text-sm" : "text-[15px] leading-relaxed"}`}>{text}</p>
      {!compact && <p className="mt-2 text-xs text-amber-900/70 dark:text-amber-200/70">From the platform owner for this reunion.</p>}
    </div>
  );
}
