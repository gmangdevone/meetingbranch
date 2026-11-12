import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, registrationsTable, reunionsTable, reunionFeesTable, attendeesTable, registrationFeesTable, registrationItemRequestsTable } from "@workspace/db";
import { QuoteRegistrationItemsBody, AddRegistrationItemsBody, QuoteRegistrationItemsResponse } from "@workspace/api-zod";
import { hydrateAddOns, isAddOn, resolveAdditionalPurchase } from "./addOns";
import { ensureLedgerInitialized, LedgerError, loadLedger, lockReunionRow, syncLedgerStatus } from "./ledger";

type Input = ReturnType<typeof QuoteRegistrationItemsBody.parse>;
type Commit = ReturnType<typeof AddRegistrationItemsBody.parse>;
type ManagerCheck = (userId: string, reunionId: number) => Promise<boolean>;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

// Normalize ordering and ignore optional client-supplied labels. Labels/prices are server-owned.
export function canonicalItems(items: Input["items"]) {
  return items.map(i => ({
    attendeeId: i.attendeeId, feeId: i.feeId,
    choices: i.choices.map(c => ({ groupId: c.groupId, valueId: c.valueId }))
      .sort((a, b) => a.groupId.localeCompare(b.groupId)),
  })).sort((a, b) => (a.attendeeId ?? -1) - (b.attendeeId ?? -1) || a.feeId - b.feeId);
}

/** Quote and commit share identical validation under the event/registration money locks. */
export async function registrationItems(
  id: number, actor: string, input: Input | Commit, isManager: ManagerCheck, commit = false,
) {
  const items = canonicalItems(input.items);
  return db.transaction(async tx => {
    const [initial] = await tx.select().from(registrationsTable).where(eq(registrationsTable.id, id));
    if (!initial) throw new LedgerError(404, "Registration not found.");
    await lockReunionRow(tx, initial.reunionId);
    const [reg] = await tx.select().from(registrationsTable).where(eq(registrationsTable.id, id)).for("update");
    if (!reg) throw new LedgerError(404, "Registration not found.");
    const [event] = await tx.select().from(reunionsTable).where(eq(reunionsTable.id, reg.reunionId));
    const manager = await isManager(actor, reg.reunionId);
    if (!manager && reg.userId !== actor) throw new LedgerError(403, "You cannot add items to this registration.");

    const request = input as Commit;
    const fingerprint = digest(items);
    if (commit) {
      const [saved] = await tx.select().from(registrationItemRequestsTable).where(and(
        eq(registrationItemRequestsTable.registrationId, id),
        eq(registrationItemRequestsTable.actorId, actor),
        eq(registrationItemRequestsTable.requestId, request.requestId),
      ));
      if (saved) {
        if (saved.fingerprint !== fingerprint) throw new LedgerError(409, "This request was already used for different items. Reload the registration.");
        return QuoteRegistrationItemsResponse.parse(saved.result);
      }
    }
    if (reg.status !== "active") throw new LedgerError(409, "Cancelled registrations cannot receive new items.");
    if (!manager && !(event.allowPostRegistrationAddOns ?? event.allowRegistrantEdits)) {
      throw new LedgerError(403, "Post-registration add-ons are not enabled. Contact your organizer to add items.");
    }
    const fees = await tx.select().from(reunionFeesTable).where(eq(reunionFeesTable.reunionId, reg.reunionId));
    const selected = await tx.select().from(registrationFeesTable).where(eq(registrationFeesTable.registrationId, id));
    const people = await tx.select().from(attendeesTable).where(eq(attendeesTable.registrationId, id));
    const hydrated = hydrateAddOns(fees, selected.map(s => s.feeId), people);
    const seen = new Set<string>();
    const lines = items.map(item => {
      const key = `${item.attendeeId ?? "household"}:${item.feeId}`;
      if (seen.has(key)) throw new LedgerError(400, "Choose each item only once per recipient.");
      seen.add(key);
      const person = item.attendeeId === null ? null : hydrated.find(a => a.id === item.attendeeId);
      if (item.attendeeId !== null && !person) throw new LedgerError(400, "Choose an existing attendee from this registration.");
      const previous = person ? person.addOns : reg.addOns ?? [];
      if (previous.some(p => p.feeId === item.feeId)) throw new LedgerError(409, "This recipient already has that item. Reload to see saved purchases.");
      const fee = fees.find(f => f.id === item.feeId && isAddOn(f));
      if (!fee) throw new LedgerError(400, "Choose merchandise offered by this event.");
      try {
        return {
          attendeeId: item.attendeeId, recipient: person?.name ?? "Household",
          purchase: resolveAdditionalPurchase(fee, item, person ? "per_person" : "flat"),
        };
      } catch (error) {
        throw new LedgerError(400, (error as Error).message);
      }
    });
    // A quote is read-only, including for legacy paid registrations.
    const ledger = await loadLedger(tx, id);
    if (!ledger) throw new LedgerError(404, "Registration balance not found.");
    const addedCostCents = lines.reduce((s, l) => s + l.purchase.unitPriceCents, 0);
    const totalChargeCents = ledger.chargeCents + addedCostCents;
    if (!Number.isSafeInteger(totalChargeCents)) throw new LedgerError(400, "The item total is too large.");
    const net = totalChargeCents - ledger.confirmedCents - ledger.legacyCreditCents - ledger.sponsoredCents;
    const preview = {
      registrationId: id, lines, addedCostCents,
      currentChargeCents: ledger.chargeCents, totalChargeCents,
      confirmedCents: ledger.confirmedCents, legacyCreditCents: ledger.legacyCreditCents,
      sponsoredCents: ledger.sponsoredCents, waived: ledger.waived,
      balanceCents: ledger.waived ? 0 : Math.max(0, net), creditCents: Math.max(0, -net),
    };
    // Include saved purchases too: even equal-price concurrent edits need a new review.
    const quoteToken = digest({ preview, items, purchases: hydrated.map(a => [a.id, a.addOns]), household: reg.addOns });
    const result = QuoteRegistrationItemsResponse.parse({ ...preview, quoteToken });
    if (!commit) return result;
    if (quoteToken !== request.quoteToken) throw new LedgerError(409, "Prices, purchases, or your balance changed. Review a fresh quote and confirm again. Nothing was added.");

    // Freeze legacy credit BEFORE adding charges; otherwise old 'paid' would cover the new items.
    await ensureLedgerInitialized(tx, id, actor);
    const householdLines = lines.filter(l => l.attendeeId === null);
    if (householdLines.length) {
      await tx.update(registrationsTable).set({ addOns: [...(reg.addOns ?? []), ...householdLines.map(l => l.purchase)] })
        .where(eq(registrationsTable.id, id));
    }
    for (const person of hydrated) {
      const additions = lines.filter(l => l.attendeeId === person.id);
      if (!additions.length) continue;
      // Only the purchase snapshot changes: never touch attendee identity, dinner, or check-in.
      await tx.update(attendeesTable).set({ addOns: [...person.addOns, ...additions.map(l => l.purchase)] })
        .where(and(eq(attendeesTable.id, person.id), eq(attendeesTable.registrationId, id)));
    }
    await syncLedgerStatus(tx, id);
    const savedLedger = await loadLedger(tx, id);
    if (!savedLedger || savedLedger.chargeCents !== totalChargeCents || savedLedger.balanceCents !== result.balanceCents) {
      throw new LedgerError(409, "The registration balance changed. Nothing was added; reload and try again.");
    }
    await tx.insert(registrationItemRequestsTable).values({
      registrationId: id, actorId: actor, requestId: request.requestId, fingerprint,
      result,
    });
    return result;
  });
}
