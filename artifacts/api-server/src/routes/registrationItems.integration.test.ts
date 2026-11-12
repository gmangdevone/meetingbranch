import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";

const auth = vi.hoisted(() => ({ id: "" }));
vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: auth.id, sessionClaims: { userId: auth.id } }),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  clerkClient: { users: { getUser: async () => ({ emailAddresses: [] }) } },
}));
vi.mock("../lib/email", () => ({ sendRegistrationConfirmation: vi.fn(), sendPaymentConfirmation: vi.fn() }));
const {
  db, usersTable, reunionsTable, reunionFeesTable, registrationsTable, attendeesTable,
  reunionOrganizersTable, paymentReceiptsTable, paymentReceiptAllocationsTable, sponsorshipAllocationsTable,
} = await import("@workspace/db");
const { default: router } = await import("./index");
const app = express();
app.use(express.json()); app.use("/api", router);
const tag = `items_${randomUUID()}`;
const owner = `${tag}_owner`, member = `${tag}_member`, outsider = `${tag}_other`, manager = `${tag}_manager`;
const as = (id: string) => { auth.id = id; return request(app); };
const events: number[] = [];
let eventId: number, shirtId: number, mugId: number, foreignFee: number;
const choose = (feeId: number, attendeeId: number | null) => ({
  feeId, attendeeId, choices: feeId === shirtId ? [{ groupId: "size", valueId: "XL" }] : [],
});
async function fixture(status: "paid" | "pending" | "waived" = "paid", received?: number) {
  const [r] = await db.insert(registrationsTable).values({
    reunionId: eventId, userId: member, branchName: "Family", attendeeCount: 1,
    paymentStatus: status, addOns: [], ledgerInitializedAt: received === undefined ? null : new Date(),
  }).returning();
  const [a] = await db.insert(attendeesTable).values({
    registrationId: r.id, name: "Existing Attendee", age: 40, dietaryRestrictions: "Vegetarian",
    includeDinner: false, addOns: [], checkedInAt: new Date(),
  }).returning();
  if (received) {
    const [receipt] = await db.insert(paymentReceiptsTable).values({
      reunionId: eventId, kind: "payment", amountCents: received, recordedBy: owner, method: "cash",
    }).returning();
    await db.insert(paymentReceiptAllocationsTable).values({
      receiptId: receipt.id, reunionId: eventId, registrationId: r.id, amountCents: received,
    });
  }
  return { r, a };
}
async function quote(id: number, items: ReturnType<typeof choose>[], actor = member) {
  return as(actor).post(`/api/registrations/${id}/add-items/quote`).send({ items });
}
async function save(id: number, items: ReturnType<typeof choose>[], token: string, key = randomUUID(), actor = member) {
  return as(actor).post(`/api/registrations/${id}/add-items`).send({ items, quoteToken: token, requestId: key });
}

describe.skipIf(!process.env.DATABASE_URL)("post-registration add-only purchases", () => {
  beforeAll(async () => {
    await db.insert(usersTable).values([owner, member, outsider, manager].map(id => ({ id, email: `${id}@example.test` })));
    for (let i = 0; i < 2; i++) {
      const [event] = await db.insert(reunionsTable).values({
        name: "Disposable item tests", code: `IT${Date.now()}${i}*`, startDate: "2027-07-01",
        endDate: "2027-07-02", organizerId: owner, paymentHandle: "", allowRegistrantEdits: false,
        allowPostRegistrationAddOns: true,
      }).returning();
      events.push(event.id);
    }
    eventId = events[0];
    await db.insert(reunionOrganizersTable).values({ reunionId: eventId, userId: manager, roles: ["registration"] });
    await db.insert(reunionFeesTable).values({
      reunionId: eventId, label: "Registration", amount: 100, chargeType: "flat", isOptional: false, isShirt: false, isDinner: false,
    });
    const [shirt] = await db.insert(reunionFeesTable).values({
      reunionId: eventId, label: "T-shirt", amount: 20, chargeType: "per_person", isOptional: true,
      isAddOn: true, isShirt: false, isDinner: false, basePriceCents: 1700,
      optionGroups: [{ id: "size", label: "Size", values: [{ id: "XL", label: "XL", adjustmentCents: 300, active: true }] }],
    }).returning(); shirtId = shirt.id;
    const [mug] = await db.insert(reunionFeesTable).values({
      reunionId: eventId, label: "Mug", amount: 5, chargeType: "flat", isOptional: false,
      isAddOn: true, isShirt: false, isDinner: false, basePriceCents: 500, optionGroups: [],
    }).returning(); mugId = mug.id;
    const [foreign] = await db.insert(reunionFeesTable).values({ reunionId: events[1], label: "Other mug", amount: 1, isAddOn: true }).returning();
    foreignFee = foreign.id;
  });
  afterAll(async () => {
    if (events.length) await db.delete(reunionsTable).where(inArray(reunionsTable.id, events));
    await db.delete(usersTable).where(inArray(usersTable.id, [owner, member, outsider, manager]));
  });

  it("keeps a paid legacy registration and attendees intact, charging only the added shirt", async () => {
    const { r, a } = await fixture();
    const items = [choose(shirtId, a.id)];
    const q = await quote(r.id, items);
    expect(q.status, JSON.stringify(q.body)).toBe(200);
    expect(q.body).toMatchObject({ addedCostCents: 2000, currentChargeCents: 10000, totalChargeCents: 12000, legacyCreditCents: 10000, balanceCents: 2000 });
    const [untouched] = await db.select().from(registrationsTable).where(eq(registrationsTable.id, r.id));
    expect(untouched.ledgerInitializedAt).toBeNull();
    const key = randomUUID();
    const saved = await save(r.id, items, q.body.quoteToken, key);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const replay = await save(r.id, items, q.body.quoteToken, key);
    expect(replay.body).toEqual(saved.body);
    const reg = await as(member).get(`/api/registrations/${r.id}`);
    expect(reg.body.attendeeCount).toBe(1);
    expect(reg.body.attendees).toHaveLength(1);
    expect(reg.body.attendees[0]).toMatchObject({ id: a.id, name: a.name, age: a.age, includeDinner: false, checkedInAt: a.checkedInAt!.toISOString() });
    expect(reg.body.attendees[0].addOns).toHaveLength(1);
    expect(reg.body.addOns).toEqual([]); // Required catalog mug was NOT added retroactively.
    expect(reg.body.ledger).toMatchObject({ chargeCents: 12000, legacyCreditCents: 10000, balanceCents: 2000, status: "partial" });
    const reports = await as(owner).get(`/api/reunions/${eventId}/reports`);
    expect(reports.body.addOnSummary.some((s: any) => s.totalCents === 2000)).toBe(true);
    expect((await quote(r.id, items)).status).toBe(409);
    expect((await save(r.id, [choose(mugId, null)], q.body.quoteToken, key)).status).toBe(409);
  });

  it.each([
    ["paid", 10000, 2000], ["pending", 4000, 8000], ["paid", 15000, 0], ["waived", 0, 0],
  ] as const)("preserves %s receipts of %i cents", async (status, amount, balance) => {
    const { r, a } = await fixture(status, amount);
    const q = await quote(r.id, [choose(shirtId, a.id)]);
    expect(q.status).toBe(200);
    expect(q.body.balanceCents).toBe(balance);
    expect(q.body.confirmedCents).toBe(amount);
    expect((await save(r.id, [choose(shirtId, a.id)], q.body.quoteToken)).status).toBe(200);
    const reg = (await as(member).get(`/api/registrations/${r.id}`)).body;
    expect(reg.ledger.confirmedCents).toBe(amount);
    expect(reg.ledger.balanceCents).toBe(balance);
    expect(reg.ledger.waived).toBe(status === "waived");
    if (amount === 15000) expect(reg.ledger.creditCents).toBe(3000);
  });

  it("preserves sponsorship allocations", async () => {
    const { r, a } = await fixture("pending", 4000);
    await db.insert(sponsorshipAllocationsTable).values({
      reunionId: eventId, registrationId: r.id, amount: 60, createdBy: owner, fundedFrom: "direct",
    });
    const q = await quote(r.id, [choose(shirtId, a.id)]);
    expect(q.body).toMatchObject({ sponsoredCents: 6000, balanceCents: 2000 });
    expect((await save(r.id, [choose(shirtId, a.id)], q.body.quoteToken)).status).toBe(200);
  });

  it("requires fresh confirmation when catalog pricing changes; rejects retired choices", async () => {
    const { r, a } = await fixture();
    const items = [choose(shirtId, a.id)];
    const q = await quote(r.id, items);
    await db.update(reunionFeesTable).set({ basePriceCents: 1800 }).where(eq(reunionFeesTable.id, shirtId));
    expect((await save(r.id, items, q.body.quoteToken)).status).toBe(409);
    const refreshed = await quote(r.id, items);
    expect(refreshed.body.addedCostCents).toBe(2100);
    await db.update(reunionFeesTable).set({ retired: true }).where(eq(reunionFeesTable.id, shirtId));
    expect((await save(r.id, items, refreshed.body.quoteToken)).status).toBe(400);
    await db.update(reunionFeesTable).set({ retired: false, basePriceCents: 1700 }).where(eq(reunionFeesTable.id, shirtId));
    const reg = (await as(member).get(`/api/registrations/${r.id}`)).body;
    expect(reg.attendees[0].addOns).toEqual([]);
    expect(reg.ledger.chargeCents).toBe(10000);
  });

  it("keeps cent-priced purchases exact and preserves saved prices after catalog edits", async () => {
    const { r, a } = await fixture();
    await db.update(reunionFeesTable).set({ basePriceCents: 2501 }).where(eq(reunionFeesTable.id, shirtId));
    const items = [choose(shirtId, a.id)];
    const q = await quote(r.id, items);
    expect(q.body.totalChargeCents).toBe(12801);
    expect((await save(r.id, items, q.body.quoteToken)).status).toBe(200);
    await db.update(reunionFeesTable).set({ basePriceCents: 1700 }).where(eq(reunionFeesTable.id, shirtId));
    const mug = await quote(r.id, [choose(mugId, null)]);
    expect(mug.body.currentChargeCents).toBe(12801);
    expect((await save(r.id, [choose(mugId, null)], mug.body.quoteToken)).status).toBe(200);
    const reg = (await as(member).get(`/api/registrations/${r.id}`)).body;
    expect(reg.ledger).toMatchObject({ chargeCents: 13301, balanceCents: 3301, legacyCreditCents: 10000 });
    expect(reg.attendees[0].addOns[0].unitPriceCents).toBe(2801);
  });

  it("enforces owner, manager, same-event recipient and active-registration boundaries", async () => {
    const { r, a } = await fixture();
    expect((await quote(r.id, [choose(shirtId, a.id)], outsider)).status).toBe(403);
    expect((await quote(r.id, [choose(foreignFee, a.id)])).status).toBe(400);
    expect((await quote(r.id, [choose(shirtId, null)])).status).toBe(400);
    expect((await quote(r.id, [choose(shirtId, a.id + 100000)])).status).toBe(400);
    expect((await quote(r.id, [choose(shirtId, a.id), choose(shirtId, a.id)])).status).toBe(400);
    expect((await quote(r.id, [{ ...choose(shirtId, a.id), choices: [{ groupId: "size", valueId: "bogus" }] }])).status).toBe(400);
    await db.update(reunionsTable).set({ allowPostRegistrationAddOns: false }).where(eq(reunionsTable.id, eventId));
    expect((await quote(r.id, [choose(shirtId, a.id)])).status).toBe(403);
    expect((await as(member).get(`/api/registrations/${r.id}`)).body.canAddItems).toBe(false);
    const q = await quote(r.id, [choose(mugId, null)], manager);
    expect(q.status).toBe(200);
    expect((await save(r.id, [choose(mugId, null)], q.body.quoteToken, randomUUID(), manager)).status).toBe(200);
    await db.update(registrationsTable).set({ status: "cancelled" }).where(eq(registrationsTable.id, r.id));
    expect((await quote(r.id, [choose(shirtId, a.id)], manager)).status).toBe(409);
    await db.update(reunionsTable).set({ allowPostRegistrationAddOns: true }).where(eq(reunionsTable.id, eventId));
  });

  it("serializes concurrent additions and does not overwrite another purchase", async () => {
    const { r, a } = await fixture();
    const items = [choose(shirtId, a.id)];
    const q = await quote(r.id, items);
    const results = await Promise.all([save(r.id, items, q.body.quoteToken), save(r.id, items, q.body.quoteToken)]);
    expect(results.map(r => r.status).sort()).toEqual([200, 409]);
    const mug = await quote(r.id, [choose(mugId, null)]);
    expect((await save(r.id, [choose(mugId, null)], mug.body.quoteToken)).status).toBe(200);
    const reg = (await as(member).get(`/api/registrations/${r.id}`)).body;
    expect(reg.attendees[0].addOns).toHaveLength(1);
    expect(reg.addOns).toHaveLength(1);
    expect(reg.ledger.balanceCents).toBe(2500);
  });

  it("inherits safely and then configures post-registration permission independently", async () => {
    await db.update(reunionsTable).set({ allowPostRegistrationAddOns: null, allowRegistrantEdits: false }).where(eq(reunionsTable.id, eventId));
    const { r, a } = await fixture();
    expect((await quote(r.id, [choose(shirtId, a.id)])).status).toBe(403);
    const edit = await as(owner).put(`/api/reunions/${eventId}`).send({ allowRegistrantEdits: true });
    expect(edit.status).toBe(200);
    expect(edit.body.allowPostRegistrationAddOns).toBe(false);
    const setting = await as(owner).put(`/api/reunions/${eventId}`).send({ allowPostRegistrationAddOns: true, allowRegistrantEdits: false });
    expect(setting.status).toBe(200);
    expect((await quote(r.id, [choose(shirtId, a.id)])).status).toBe(200);
  });
});
