import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";

const auth = vi.hoisted(() => ({ id: "" }));
vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: auth.id, sessionClaims: { userId: auth.id } }),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  clerkClient: { users: { getUser: async () => ({ emailAddresses: [] }) } },
}));
vi.mock("../lib/email", () => ({ sendRegistrationConfirmation: vi.fn().mockResolvedValue(undefined), sendPaymentConfirmation: vi.fn().mockResolvedValue(undefined) }));
const { db, usersTable, reunionsTable, reunionFeesTable, registrationsTable, attendeesTable, registrationFeesTable } = await import("@workspace/db");
const { default: router } = await import("./index");
const app = express();
app.use(express.json()); app.use("/api", router);
const tag = `addon_${Date.now()}`;
const owner = `${tag}_owner`, member = `${tag}_member`;
const as = (id: string) => { auth.id = id; return request(app); };
let reunionId: number;
const group = { id: "size", label: "Size", values: ["S", "M", "L", "XL", "2XL", "3XL"].map((label, i) => ({ id: label, label, adjustmentCents: i < 3 ? 0 : 300, active: true })) };
const input = { label: "Merchandise", isAddOn: true, chargeType: "per_person", isOptional: true, amount: 10, basePriceCents: 1000, optionGroups: [group], isShirt: false, isDinner: false };
const choose = (feeId: number, size: string) => ({ feeId, choices: [{ groupId: "size", valueId: size }] });
describe.skipIf(!process.env.DATABASE_URL)("add-on catalog and registration integration", () => {
  beforeAll(async () => {
    await db.insert(usersTable).values([owner, member].map(id => ({ id, email: `${id}@example.test`, isAdmin: false })));
    const [r] = await db.insert(reunionsTable).values({ code: `AO${Date.now()}*`, name: "Add-on test", startDate: "2027-07-01", endDate: "2027-07-02", organizerId: owner, paymentHandle: "", allowRegistrantEdits: true }).returning();
    reunionId = r.id;
  });
  afterAll(async () => {
    const regs = await db.select().from(registrationsTable).where(eq(registrationsTable.reunionId, reunionId));
    if (regs.length) await db.delete(attendeesTable).where(inArray(attendeesTable.registrationId, regs.map(r => r.id)));
    await db.delete(reunionsTable).where(eq(reunionsTable.id, reunionId));
    await db.delete(usersTable).where(inArray(usersTable.id, [owner, member]));
  });
  it("persists server-priced choices through edits, reports, rename, mandatory changes and retirement", async () => {
    expect((await as(member).post(`/api/reunions/${reunionId}/fees`).send(input)).status).toBe(403);
    const created = await as(owner).post(`/api/reunions/${reunionId}/fees`).send(input);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.id;
    const saved = await as(member).post("/api/registrations").send({
      reunionId, branchName: "Family", addOns: [], attendees: [
        { name: "Small", age: 30, addOns: [{ ...choose(id, "S"), unitPriceCents: 1 }] },
        { name: "Large", age: 40, addOns: [choose(id, "XL")] },
      ],
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(201);
    expect(saved.body.ledger.chargeCents).toBe(2300);
    expect(saved.body.attendees.map((a: any) => a.addOns[0].unitPriceCents)).toEqual([1000, 1300]);
    let current = saved.body;
    const changed = await as(owner).put(`/api/reunions/${reunionId}/fees/${id}`).send({ ...input, label: "Jacket", basePriceCents: 2000 });
    expect(changed.status, JSON.stringify(changed.body)).toBe(200);
    current = (await as(member).get(`/api/registrations/${current.id}`)).body;
    expect(current.ledger.chargeCents).toBe(2300);
    expect(current.attendees[0].addOns[0].label).toBe("Merchandise");
    const edited = await as(member).put(`/api/registrations/${current.id}`).send({
      branchName: "Family", addOns: [], attendees: current.attendees.map((a: any, i: number) => ({ id: a.id, name: a.name, age: a.age, addOns: [choose(id, i ? "XL" : "M")] })),
    });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    expect(edited.body.attendees.map((a: any) => a.id).sort()).toEqual(current.attendees.map((a: any) => a.id).sort());
    expect(edited.body.ledger.chargeCents).toBe(3300);
    current = edited.body;
    const reports = await as(owner).get(`/api/reunions/${reunionId}/reports`);
    expect(reports.status).toBe(200);
    expect(reports.body.addOnSummary.reduce((s: number, r: any) => s + r.totalCents, 0)).toBe(3300);
    const required = await as(owner).put(`/api/reunions/${reunionId}/fees/${id}`).send({ ...input, isOptional: false });
    expect(required.status).toBe(200);
    expect((await as(member).post("/api/registrations").send({ reunionId, branchName: "Family", attendees: [{ name: "Missing", addOns: [] }] })).status).toBe(400);
    expect((await as(member).get(`/api/registrations/${current.id}`)).body.ledger.chargeCents).toBe(3300);
    expect((await as(owner).delete(`/api/reunions/${reunionId}/fees/${id}`)).status).toBe(204);
    expect((await as(member).post("/api/registrations").send({ reunionId, branchName: "Family", attendees: [{ name: "New", addOns: [choose(id, "S")] }] })).status).toBe(400);
    expect((await as(member).get(`/api/registrations/${current.id}`)).body.ledger.chargeCents).toBe(3300);
    const kept = await as(member).put(`/api/registrations/${current.id}`).send({ branchName: "Family", addOns: [], attendees: current.attendees.map((a: any) => ({ id: a.id, name: a.name, age: a.age, addOns: a.addOns })) });
    expect(kept.status, JSON.stringify(kept.body)).toBe(200);
    expect(kept.body.ledger.chargeCents).toBe(3300);
  });
  it("maps legacy shirts and freezes charges before conversion or deletion", async () => {
    const [f] = await db.insert(reunionFeesTable).values({ reunionId, label: "T-shirt", amount: 10, isShirt: true, isOptional: true }).returning();
    const [r] = await db.insert(registrationsTable).values({ reunionId, userId: member, branchName: "Family", attendeeCount: 1 }).returning();
    await db.insert(attendeesTable).values({ registrationId: r.id, name: "Legacy", shirtSize: "XL", includeShirt: true, age: 30 });
    await db.insert(registrationFeesTable).values({ registrationId: r.id, feeId: f.id });
    const before = (await as(member).get(`/api/registrations/${r.id}`)).body;
    expect(before.ledger.chargeCents).toBe(1000);
    expect(before.attendees[0].addOns[0].choices[0].valueId).toBe("XL");
    const countBefore = (await db.select().from(registrationsTable).where(eq(registrationsTable.reunionId, reunionId))).length;
    for (const attendee of [
      { name: "Old page", includeShirt: true, shirtSize: "L" },
      { name: "Old page without shirt fields" },
    ]) {
      const outdated = await as(member).post("/api/registrations").send({
        reunionId, branchName: "Family", selectedFeeIds: [f.id], attendees: [attendee],
      });
      expect(outdated.status, JSON.stringify(outdated.body)).toBe(400);
      expect(outdated.body.error).toMatch(/Refresh/);
    }
    const managedOutdated = await as(owner).post(`/api/reunions/${reunionId}/registrations`).send({
      memberFirstName: "Old page", branchName: "Family", selectedFeeIds: [f.id],
      attendees: [{ name: "Old page", includeShirt: true, shirtSize: "L" }],
    });
    expect(managedOutdated.status).toBe(400);
    expect((await db.select().from(registrationsTable).where(eq(registrationsTable.reunionId, reunionId))).length).toBe(countBefore);
    const oldOptOut = await as(member).put(`/api/registrations/${r.id}`).send({
      branchName: "Family", selectedFeeIds: [], attendees: [{ id: before.attendees[0].id, name: "Legacy", includeShirt: false }],
    });
    expect(oldOptOut.status).toBe(400);
    expect(oldOptOut.body.error).toMatch(/Refresh/);
    const unchanged = (await as(member).get(`/api/registrations/${r.id}`)).body;
    expect(unchanged.ledger.chargeCents).toBe(1000);
    expect(unchanged.attendees[0].addOns).toEqual(before.attendees[0].addOns);
    const catalog = (await as(owner).get(`/api/reunions/${reunionId}`)).body.reunion.fees.find((x: any) => x.id === f.id);
    expect(catalog.isAddOn).toBe(true);
    expect(catalog.isShirt).toBe(false);
    const changed = await as(owner).put(`/api/reunions/${reunionId}/fees/${f.id}`).send({ ...catalog, label: "Pants", amount: 20, basePriceCents: 2000, dinnerMode: undefined });
    expect(changed.status, JSON.stringify(changed.body)).toBe(200);
    expect((await as(member).get(`/api/registrations/${r.id}`)).body.ledger.chargeCents).toBe(1000);
    const migratedOldOptOut = await as(member).put(`/api/registrations/${r.id}`).send({
      branchName: "Family", attendees: [{ id: before.attendees[0].id, name: "Legacy", includeShirt: false }],
    });
    expect(migratedOldOptOut.status).toBe(400);
    expect((await as(member).get(`/api/registrations/${r.id}`)).body.ledger.chargeCents).toBe(1000);
    await as(owner).delete(`/api/reunions/${reunionId}/fees/${f.id}`);
    expect((await as(member).get(`/api/registrations/${r.id}`)).body.ledger.chargeCents).toBe(1000);
  });
  it("keeps flat purchases once per household and does not retroactively add mandatory items", async () => {
    const create = await as(owner).post(`/api/reunions/${reunionId}/fees`).send({ ...input, label: "Mug", chargeType: "flat", optionGroups: [], isOptional: false, basePriceCents: 1250 });
    expect(create.status).toBe(201);
    const reg = await as(owner).post(`/api/reunions/${reunionId}/registrations`).send({ memberFirstName: "Managed", branchName: "Family", attendees: [{ name: "One" }, { name: "Two" }] });
    expect(reg.status, JSON.stringify(reg.body)).toBe(201);
    expect(reg.body.addOns[0].unitPriceCents).toBe(1250);
    expect(reg.body.attendees.every((a: any) => a.addOns.length === 0)).toBe(true);
    expect((await as(owner).get(`/api/registrations/${reg.body.id}`)).body.ledger.chargeCents).toBe(1250);
    await db.delete(usersTable).where(eq(usersTable.id, reg.body.userId));
  });
});
