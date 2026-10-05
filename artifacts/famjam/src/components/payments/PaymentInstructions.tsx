import type { PaymentRecipientPublic } from "@workspace/api-client-react";
import { ZelleRecipientCard } from "./ZelleRecipientCard";

export function PaymentInstructions({ recipient, checkPayee }: {
  recipient?: PaymentRecipientPublic | null;
  checkPayee?: string | null;
}) {
  const approved = recipient?.status === "approved";
  return (
    <div className="space-y-4">
      <h4 className="font-bold">Payment instructions</h4>
      {approved ? (
        <>
          {recipient.cashAppTag && <div>
            <p className="font-bold">Cash App</p>
            <p>Send to <span className="font-mono font-bold break-all">${recipient.cashAppTag}</span>.</p>
            {recipient.cashAppUrl && <a href={recipient.cashAppUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline">Open Cash App</a>}
          </div>}
          {recipient.zelleRecipientName && recipient.zelleContact && (
            <ZelleRecipientCard name={recipient.zelleRecipientName} contact={recipient.zelleContact} />
          )}
          {recipient.paymentHandle && <p className="break-words">Payment recipient: <strong>{recipient.paymentHandle}</strong></p>}
          {recipient.paymentUrl && recipient.paymentUrl !== recipient.cashAppUrl && (
            <a href={recipient.paymentUrl} target="_blank" rel="noopener noreferrer" className="block text-primary underline">Open approved payment link</a>
          )}
        </>
      ) : <p>Online payment instructions are not available yet. Contact your organizers before sending payment.</p>}
      {checkPayee && <p>For checks, make payable to <strong>{checkPayee}</strong>. Contact your organizers for delivery instructions.</p>}
      <p className="text-sm text-muted-foreground">Send payment using your chosen method. Your organizers will confirm receipt and update your payment status.</p>
    </div>
  );
}