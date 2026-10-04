import { useEffect, useRef, useState } from "react";
import { Check, Copy, Landmark } from "lucide-react";

/**
 * Owner-approved Zelle destination for payers. Zelle has no universal payment
 * link, so this only shows who to send to and how; payers send from their own
 * banking app. Nothing here records or settles a payment.
 */
export function ZelleRecipientCard({
  name,
  contact,
  amount,
  compact = false,
}: {
  name: string;
  contact: string;
  amount?: number | null;
  compact?: boolean;
}) {
  const [copied, setCopied] = useState<"ok" | "fail" | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(contact);
      setCopied("ok");
    } catch {
      setCopied("fail");
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(null), 2200);
  };

  return (
    <div className="rounded-2xl border bg-background p-4 space-y-3" data-testid="zelle-recipient-card">
      <div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-widest text-muted-foreground">
        <Landmark className="w-3.5 h-3.5" /> Send with Zelle
      </div>
      <div>
        <span className="text-muted-foreground text-sm block">Recipient name</span>
        <span className="font-bold text-lg leading-tight break-words">{name}</span>
      </div>
      <div>
        <span className="text-muted-foreground text-sm block mb-1">Zelle email or phone</span>
        <div className="flex items-stretch gap-2">
          <code className="flex-1 min-w-0 font-mono font-bold bg-muted/60 border px-3 py-2 rounded-lg break-all">{contact}</code>
          <button
            type="button"
            onClick={copy}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border px-3 text-sm font-bold hover:bg-muted transition-colors"
            aria-label={`Copy Zelle contact ${contact}`}
          >
            {copied === "ok" ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            {copied === "ok" ? "Copied" : "Copy"}
          </button>
        </div>
        <p className="sr-only" aria-live="polite">{copied === "ok" ? "Copied" : copied === "fail" ? "Copy failed" : ""}</p>
        {copied === "fail" && <p className="text-xs text-destructive mt-1">Could not copy. Select the text and copy it manually.</p>}
      </div>
      {!compact && (
        <ol className="text-sm text-muted-foreground list-decimal pl-5 space-y-1">
          <li>Open your own bank's app and choose Send with Zelle.</li>
          <li>Paste the email or phone above{amount ? <>, and enter <span className="font-bold text-foreground">${amount}</span></> : null}.</li>
          <li>Before you send, check that your bank shows the name <span className="font-bold text-foreground">{name}</span>. If it doesn't match, stop and contact your organizers.</li>
        </ol>
      )}
    </div>
  );
}
