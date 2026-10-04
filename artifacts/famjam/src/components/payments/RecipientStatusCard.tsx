import type { PaymentRecipientPublic } from "@workspace/api-client-react";
import { Lock } from "lucide-react";

/** Read-only view of the owner-approved destination for organizers. */
export function RecipientStatusCard({ recipient }: { recipient: PaymentRecipientPublic | null | undefined }) {
  const approved = recipient?.status === "approved";
  return (
    <div className="rounded-2xl border bg-muted/40 p-4 space-y-2" data-testid="recipient-status-card">
      <div className="flex items-center gap-2 font-bold text-sm">
        <Lock className="w-4 h-4" /> Payment destination (managed by the platform owner)
      </div>
      {approved ? (
        <dl className="text-sm space-y-1">
          {recipient?.cashAppTag && <div><dt className="inline text-muted-foreground">Cash App: </dt><dd className="inline font-mono font-bold">${recipient.cashAppTag}</dd></div>}
          {recipient?.paymentHandle && <div><dt className="inline text-muted-foreground">Label: </dt><dd className="inline font-bold">{recipient.paymentHandle}</dd></div>}
          {recipient?.zelleContact && <div><dt className="inline text-muted-foreground">Zelle: </dt><dd className="inline font-bold">{recipient.zelleRecipientName}</dd> <dd className="inline font-mono">{recipient.zelleContact}</dd></div>}
          {recipient?.paymentUrl && <div><dt className="inline text-muted-foreground">Link: </dt><dd className="inline font-mono break-all">{recipient.paymentUrl}</dd></div>}
        </dl>
      ) : (
        <p className="text-sm text-muted-foreground">
          {recipient?.status === "disabled" ? "Online payment is disabled for this reunion." : "Online payment is not configured yet (pending platform owner review)."}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Organizers cannot change where money is sent. To set up or change the destination, contact the platform owner.
      </p>
    </div>
  );
}
