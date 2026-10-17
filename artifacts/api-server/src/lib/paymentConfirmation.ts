import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { loadLedgers, rows } from "./ledger";
import { sendPaymentConfirmation } from "./email";
import { logger } from "./logger";

/** Called only for a newly committed receipt, never for an idempotent retry. */
export async function emailRecordedPayment(receiptId: number): Promise<void> {
  try {
    const recipients = await rows<{
      registration_id: number; amount_cents: string; email: string;
      first_name: string | null; reunion_name: string; method: string; received_date: string;
    }>(db, sql`
      SELECT g.id AS registration_id, sum(a.amount_cents)::text AS amount_cents,
        u.email, u.first_name, e.name AS reunion_name, r.method, r.received_date::text
      FROM payment_receipts r
      JOIN payment_receipt_allocations a ON a.receipt_id = r.id
      JOIN registrations g ON g.id = a.registration_id
      JOIN users u ON u.id = g.user_id
      JOIN reunions e ON e.id = g.reunion_id
      WHERE r.id = ${receiptId} AND r.kind = 'payment'
        AND u.is_managed = false AND trim(coalesce(u.email, '')) <> ''
      GROUP BY g.id, u.email, u.first_name, e.name, r.method, r.received_date
    `);
    const ledgers = await loadLedgers(db, recipients.map(r => r.registration_id));
    for (const recipient of recipients) {
      try {
        const ledger = ledgers.get(recipient.registration_id);
        if (!ledger) throw new Error("Registration balance unavailable");
        await sendPaymentConfirmation({
          toEmail: recipient.email, toName: recipient.first_name || "Family Member",
          reunionName: recipient.reunion_name, receiptId, registrationId: recipient.registration_id,
          amountCents: Number(recipient.amount_cents),
          balanceCents: ledger.balanceCents + ledger.contributions.reduce((sum, c) => sum + (c.waived ? 0 : c.outstandingCents), 0),
          receivedDate: recipient.received_date, method: recipient.method,
        });
      } catch (err) {
        logger.error({ err, receiptId, registrationId: recipient.registration_id }, "Payment recorded but confirmation email failed");
      }
    }
  } catch (err) {
    logger.error({ err, receiptId }, "Payment recorded but confirmation recipients could not be loaded");
  }
}
