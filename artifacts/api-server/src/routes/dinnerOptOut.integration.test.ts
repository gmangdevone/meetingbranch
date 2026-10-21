import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { eq, inArray, sql } from "drizzle-orm";
// Dinner integration checks must not call the real email provider.
vi.mock("../lib/email", () => ({
  sendRegistrationConfirmation: vi.fn().mockResolvedValue(undefined),
  sendPaymentConfirmation: vi.fn().mockResolvedValue(undefined),
}));

// Per-attendee dinner opt-out against the REAL dev Postgres schema. Clerk mocked.
const authState = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: authState.userId, sessionClaims: authState.userId ? { userId: authState.userId } : null }),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  clerkClient: { users: { getUser: async () => ({ emailAddresses: [] }) } },
}));

const hasDb = !!process.env.DATABASE_URL;
const { db, usersTable, reunionsTable, reunionOrganizersTable, reunionFeesTable, reunionBranchesTable, registrationsTable, attendeesTable } =
  await import("@workspace/db");
const { default: apiRouter } = await import("./index");

const RUN = `${Date.now()}`;
const ORG = `user_DnOrg${RUN}`;
const REGMGR = `user_DnReg${RUN}`;
const AMY = `user_DnAmy${RUN}`;
let R = 0;
let REG_FEE = 0;
let DINNER = 0;
let OPT_DINNER = 0;

const app = (): Express => {
  const a = express();
  a.use(express.json());
  a.use("/api", apiRouter);
  return a;
};
const as = (u: string | null) => {
  authState.userId = u;
  return request(app());
};
let seq = 0;
const ledger = async (id: number) => (await as(ORG).get(`/api/registrations/${id}/ledger`)).body.ledger as { chargeCents: number; confirmedCents: number; creditCents: number; balanceCents: number };
type Att = { name: string; shirtSize: string; age: number; includeDinner?: boolean };
// Dev-like config: Registration $50 (5 and under free, 6-12 $25); Sunday Dinner $30 (5 and under free, 6-12 $20).
const MIX: Att[] = [
  { name: "Ann Adult", shirtSize: "L", age: 40, includeDinner: true }, // 50 + 30
  { name: "Cy Child", shirtSize: "S", age: 8, includeDinner: false }, // 25 + 0 (opted out of 20)
  { name: "Tot Toddler", shirtSize: "XS", age: 3 }, // 0 + 0, omitted -> true
  { name: "Ben Adult", shirtSize: "M", age: 35, includeDinner: false }, // 50 + 0 (opted out of 30)
];
const edit = (u: string, id: number, attendees: Att[], selectedFeeIds: number[] = []) =>
  as(u).put(`/api/registrations/${id}`).send({ branchName: "Lacey", attendees, selectedFeeIds });

describe.skipIf(!hasDb)("dinner opt-out per attendee (real DB)", () => {
  let regId = 0;
  beforeAll(async () => {
    await db.insert(usersTable).values([ORG, REGMGR, AMY].map((id) => ({ id, email: `${id}@x.test`, isAdmin: false })));
    const [r] = await db.insert(reunionsTable).values({ code: `DN${RUN.slice(-7)}*`, name: "Dinner Reunion", startDate: "2027-07-01", endDate: "2027-07-03", paymentHandle: "", organizerId: ORG, registrationsOpen: true, allowRegistrantEdits: false }).returning();
    R = r.id;
    await db.insert(reunionOrganizersTable).values({ reunionId: R, userId: REGMGR, roles: ["registration"] });
    await db.insert(reunionBranchesTable).values({ reunionId: R, name: "Lacey" });
    const [f1, f2, f3] = await db.insert(reunionFeesTable).values([
      { reunionId: R, label: "Registration Fee", chargeType: "per_person", amount: 50, ageTiers: [{ minAge: null, maxAge: 5, amount: 0 }, { minAge: 6, maxAge: 12, amount: 25 }], sortOrder: 0 },
      // is_dinner left NULL: legacy detection from the label.
      { reunionId: R, label: "Sunday Dinner", chargeType: "per_person", amount: 30, ageTiers: [{ minAge: null, maxAge: 5, amount: 0 }, { minAge: 6, maxAge: 12, amount: 20 }], sortOrder: 1 },
      { reunionId: R, label: "Friday Fish Fry", chargeType: "per_person", amount: 10, isOptional: true, isDinner: true, sortOrder: 2 },
    ]).returning();
    REG_FEE = f1.id;
    DINNER = f2.id;
    OPT_DINNER = f3.id;
  });
  afterAll(async () => {
    if (R) {
      await db.execute(sql`DELETE FROM payment_receipts WHERE reunion_id = ${R}`);
      const regs = await db.select({ id: registrationsTable.id }).from(registrationsTable).where(eq(registrationsTable.reunionId, R));
      if (regs.length) await db.delete(attendeesTable).where(inArray(attendeesTable.registrationId, regs.map((x) => x.id)));
      await db.delete(registrationsTable).where(eq(registrationsTable.reunionId, R));
      await db.delete(reunionsTable).where(eq(reunionsTable.id, R));
    }
    await db.delete(usersTable).where(inArray(usersTable.id, [ORG, REGMGR, AMY]));
  });

  it("restricts dinner history to registration organizers in this reunion", async () => {
    expect((await as(null).get(`/api/reunions/${R}/dinner-history`)).status).toBe(401);
    expect((await as(AMY).get(`/api/reunions/${R}/dinner-history`)).status).toBe(403);
    await db.insert(reunionOrganizersTable).values({ reunionId: R, userId: AMY, roles: ["power_user"] });
    expect((await as(AMY).get(`/api/reunions/${R}/dinner-history`)).status).toBe(403);
    await db.delete(reunionOrganizersTable).where(eq(reunionOrganizersTable.userId, AMY));
    expect((await as(REGMGR).get(`/api/reunions/${R}/dinner-history`)).status).toBe(200);
    expect((await as(ORG).get(`/api/reunions/${R}/dinner-history`)).body).toEqual([]);
  });

  it("records dinner creation, classification changes and deletion with retained labels", async () => {
    const create = await as(ORG).post(`/api/reunions/${R}/fees`).send({
      label: "Audit Dinner", chargeType: "per_person", amount: 5, isOptional: true, isDinner: true,
    });
    expect(create.status).toBe(201);
    const feeId = create.body.id;
    const update = (isDinner: boolean) => as(ORG).put(`/api/reunions/${R}/fees/${feeId}`).send({
      label: "Audit Dinner", chargeType: "per_person", amount: 5, isOptional: true, isDinner,
    });
    expect((await update(false)).status).toBe(200);
    expect((await update(true)).status).toBe(200);
    expect((await as(ORG).delete(`/api/reunions/${R}/fees/${feeId}`)).status).toBe(204);
    const history = (await as(REGMGR).get(`/api/reunions/${R}/dinner-history`)).body.filter((e: { feeId: number }) => e.feeId === feeId);
    expect(history.map((e: { beforeChoice: string; afterChoice: string }) => [e.beforeChoice, e.afterChoice])).toEqual([
      ["Legacy optional", "Removed"], ["Not a dinner", "Legacy optional"],
      ["Legacy optional", "Not a dinner"], ["Not offered", "Legacy optional"],
    ]);
    expect(history.every((e: { actorId: string; feeLabel: string }) => e.actorId === ORG && e.feeLabel === "Audit Dinner")).toBe(true);
  });

  it("legacy unclassified Sunday Dinner is detected; registration fee is not", async () => {
    const fees = (await as(ORG).get(`/api/reunions/${R}`)).body.reunion.fees as { id: number; isDinner: boolean; dinnerClassification: string }[];
    expect(fees.find((f) => f.id === DINNER)).toMatchObject({ isDinner: true, dinnerClassification: "detected" });
    expect(fees.find((f) => f.id === REG_FEE)).toMatchObject({ isDinner: false, dinnerClassification: "detected" });
    expect(fees.find((f) => f.id === OPT_DINNER)).toMatchObject({ isDinner: true, dinnerClassification: "explicit" });
  });

  it("create with mixed selection charges exact tiers and persists includeDinner (omitted = true)", async () => {
    const res = await as(AMY).post("/api/registrations").send({ reunionId: R, branchName: "Lacey", attendees: MIX });
    expect(res.status).toBe(201);
    regId = res.body.id;
    expect(res.body.attendees.map((a: { includeDinner: boolean }) => a.includeDinner)).toEqual([true, false, true, false]);
    expect((await ledger(regId)).chargeCents).toBe(15500);
    const got = await as(AMY).get(`/api/registrations/${regId}`);
    expect(got.body.attendees.map((a: { includeDinner: boolean }) => a.includeDinner)).toEqual([true, false, true, false]);
  });

  it("registrant edits are refused while edits are disabled; an organizer can still change dinner", async () => {
    const back = MIX.map((a) => (a.name === "Ben Adult" ? { ...a, includeDinner: true } : a));
    expect((await edit(AMY, regId, back)).status).toBe(403);
    expect((await ledger(regId)).chargeCents).toBe(15500);
    // Check-in survives the organizer edit.
    const at = new Date("2027-07-01T15:00:00Z");
    await db.update(attendeesTable).set({ checkedInAt: at }).where(sql`${attendeesTable.registrationId} = ${regId} AND ${attendeesTable.name} = 'Ann Adult'`);
    expect((await edit(REGMGR, regId, back)).status).toBe(200);
    expect((await ledger(regId)).chargeCents).toBe(18500);
    const rows = await db.select().from(attendeesTable).where(eq(attendeesTable.registrationId, regId));
    expect(rows.find((a) => a.name === "Ann Adult")?.checkedInAt?.toISOString()).toBe(at.toISOString());
    expect(rows.find((a) => a.name === "Ben Adult")?.includeDinner).toBe(true);
  });

  it("with registrant edits enabled the member can toggle off and back on", async () => {
    await db.update(reunionsTable).set({ allowRegistrantEdits: true }).where(eq(reunionsTable.id, R));
    expect((await edit(AMY, regId, MIX)).status).toBe(200);
    expect((await ledger(regId)).chargeCents).toBe(15500);
    const allIn = MIX.map((a) => ({ ...a, includeDinner: true }));
    expect((await edit(AMY, regId, allIn)).status).toBe(200);
    expect((await ledger(regId)).chargeCents).toBe(20500); // 50+30 + 25+20 + 0 + 50+30
  });

  it("opting out after payment keeps confirmed money and shows a credit; no refund or receipt rewrite", async () => {
    const pay = await as(ORG).post(`/api/reunions/${R}/receipts`).send({ method: "cash", receivedDate: "2025-12-01", idempotencyKey: `dn${RUN}x${++seq}`, amountCents: 20500, allocations: [{ registrationId: regId, amountCents: 20500 }] });
    expect(pay.status, JSON.stringify(pay.body)).toBe(201);
    const before = (await db.execute(sql`SELECT count(*)::int AS n, sum(amount_cents)::int AS c FROM payment_receipts WHERE reunion_id = ${R}`)) as unknown as { rows: { n: number; c: number }[] };
    expect((await edit(REGMGR, regId, MIX)).status).toBe(200);
    expect(await ledger(regId)).toMatchObject({ chargeCents: 15500, confirmedCents: 20500, creditCents: 5000, balanceCents: 0 });
    const after = (await db.execute(sql`SELECT count(*)::int AS n, sum(amount_cents)::int AS c FROM payment_receipts WHERE reunion_id = ${R}`)) as unknown as { rows: { n: number; c: number }[] };
    expect(after.rows[0]).toEqual(before.rows[0]);
    const history = (await as(REGMGR).get(`/api/reunions/${R}/dinner-history`)).body;
    expect(history).toEqual(expect.arrayContaining([
      expect.objectContaining({ actorId: REGMGR, registrationId: regId, attendeeName: "Cy Child",
        feeId: DINNER, beforeChoice: "Included", afterChoice: "Excluded", kind: "selection" }),
      expect.objectContaining({ actorId: REGMGR, registrationId: regId, attendeeName: "Ben Adult",
        feeId: DINNER, beforeChoice: "Included", afterChoice: "Excluded", kind: "selection" }),
    ]));
    // Failed edits neither change the selection nor produce misleading history.
    expect((await edit(REGMGR, regId, MIX, [999999999])).status).toBe(400);
    expect((await as(REGMGR).get(`/api/reunions/${R}/dinner-history`)).body).toEqual(history);
  });

  it("an optional dinner needs the household opt-in first; opt-outs only remove dinner shares", async () => {
    // Opted in: Ann + Tot pay the $10 fish fry; Cy and Ben opted out.
    expect((await edit(REGMGR, regId, MIX, [OPT_DINNER])).status).toBe(200);
    expect((await ledger(regId)).chargeCents).toBe(15500 + 2000);
    const includedHistory = (await as(REGMGR).get(`/api/reunions/${R}/dinner-history`)).body;
    expect(includedHistory).toEqual(expect.arrayContaining([
      expect.objectContaining({ actorId: REGMGR, registrationId: regId, attendeeName: "Ann Adult",
        feeId: OPT_DINNER, beforeChoice: "Excluded", afterChoice: "Included" }),
    ]));
    expect((await edit(REGMGR, regId, MIX, [])).status).toBe(200);
    expect((await ledger(regId)).chargeCents).toBe(15500);
    const excludedHistory = (await as(REGMGR).get(`/api/reunions/${R}/dinner-history`)).body;
    expect(excludedHistory).toEqual(expect.arrayContaining([
      expect.objectContaining({ actorId: REGMGR, registrationId: regId, attendeeName: "Ann Adult",
        feeId: OPT_DINNER, beforeChoice: "Included", afterChoice: "Excluded" }),
    ]));
  });

  it("explicit classification survives a rename; flat dinner is rejected", async () => {
    const put = (feeId: number, body: Record<string, unknown>) => as(ORG).put(`/api/reunions/${R}/fees/${feeId}`).send(body);
    const tiers = [{ minAge: null, maxAge: 5, amount: 0 }, { minAge: 6, maxAge: 12, amount: 20 }];
    const renamed = await put(DINNER, { label: "Sunday Supper", chargeType: "per_person", amount: 30, ageTiers: tiers, isDinner: true });
    expect(renamed.status).toBe(200);
    expect(renamed.body).toMatchObject({ isDinner: true, dinnerClassification: "explicit" });
    expect((await ledger(regId)).chargeCents).toBe(15500);
    expect((await put(DINNER, { label: "Sunday Supper", chargeType: "flat", amount: 30, isDinner: true })).status).toBe(400);
    // Omitted isDinner keeps the stored explicit value.
    expect((await put(DINNER, { label: "Sunday Meal", chargeType: "per_person", amount: 30, ageTiers: tiers })).body.isDinner).toBe(true);
    const created = await as(ORG).post(`/api/reunions/${R}/fees`).send({ label: "Dinner Shirt", chargeType: "flat", amount: 15, isDinner: true });
    expect(created.status).toBe(400);
  });

  it("reports and the CSV export carry the opt-outs", async () => {
    const rep = await as(ORG).get(`/api/reunions/${R}/reports`);
    expect(rep.body.dinnerOptOutCount).toBe(2);
    const csv = await as(ORG).get(`/api/reunions/${R}/registrations/export`);
    expect(csv.text.split("\n")[0]).toMatch(/,Dinner Included,Add-ons$/);
    expect(csv.text).toContain('"Yes; No; Yes; No"');
  });
  it("configures dinner safely, enforces mandatory defaults, preserves exceptions and hidden charges", async () => {
    const mode = (dinnerMode: string) => as(REGMGR).patch(`/api/reunions/${R}/fees/${DINNER}`).send({ dinnerMode });
    const before = await ledger(regId);
    expect((await mode("optional")).status).toBe(200);
    const history = (await as(REGMGR).get(`/api/reunions/${R}/dinner-history`)).body;
    expect(history[0]).toMatchObject({ actorId: REGMGR, feeId: DINNER, beforeChoice: "Legacy required", afterChoice: "optional", kind: "mode" });
    expect(Number.isNaN(Date.parse(history[0].createdAt))).toBe(false);
    expect((await mode("optional")).status).toBe(200);
    expect((await as(ORG).get(`/api/reunions/${R}/dinner-history`)).body).toHaveLength(history.length);
    expect((await ledger(regId)).chargeCents).toBe(before.chargeCents);
    const create = (includeDinner?: boolean) => as(AMY).post("/api/registrations").send({
      reunionId: R, branchName: "Lacey", attendees: [{ name: "Default Adult", age: 40, includeShirt: false, ...(includeDinner === undefined ? {} : { includeDinner }) }],
    });
    const optional = await create();
    expect(optional.status).toBe(201);
    expect(optional.body.attendees[0].includeDinner).toBe(true);
    expect((await ledger(optional.body.id)).chargeCents).toBe(8000);
    expect((await mode("mandatory")).status).toBe(200);
    expect((await create(false)).status).toBe(400);
    const mandatory = await create();
    expect(mandatory.status).toBe(201);
    const saved = mandatory.body.attendees[0];
    const update = (user: string, a: any[]) => as(user).put(`/api/registrations/${mandatory.body.id}`).send({
      branchName: "Lacey", selectedFeeIds: [], attendees: a.map(x => ({ ...x, dietaryRestrictions: x.dietaryRestrictions ?? undefined })),
    });
    expect((await update(AMY, [{ ...saved, includeDinner: false }])).status).toBe(400);
    const override = await update(REGMGR, [{ ...saved, includeDinner: false }]);
    expect(override.status).toBe(200);
    expect((await ledger(mandatory.body.id)).chargeCents).toBe(5000);
    const retained = await update(AMY, [{ ...override.body.attendees[0], name: "Renamed Adult" }]);
    expect(retained.status).toBe(200);
    expect(retained.body.attendees[0].includeDinner).toBe(false);
    expect((await as(REGMGR).get(`/api/registrations/${mandatory.body.id}`)).body.canManageDinner).toBe(true);
    expect((await as(AMY).patch(`/api/reunions/${R}/fees/${DINNER}`).send({ dinnerMode: "hidden" })).status).toBe(403);
    expect((await as(REGMGR).patch(`/api/reunions/${R}/fees/${DINNER}`).send({ dinnerMode: "hidden", amount: 0 })).status).toBe(400);
    expect((await mode("hidden")).status).toBe(200);
    expect((await ledger(optional.body.id)).chargeCents).toBe(8000);
    const hidden = await create();
    expect(hidden.status).toBe(201);
    expect((await ledger(hidden.body.id)).chargeCents).toBe(5000);
    const added = await as(REGMGR).put(`/api/registrations/${optional.body.id}`).send({
      branchName: "Lacey", selectedFeeIds: optional.body.selectedFeeIds,
      attendees: [...optional.body.attendees.map((a: any) => ({ ...a, dietaryRestrictions: a.dietaryRestrictions ?? undefined })), { name: "New Person", age: 40, includeShirt: false }],
    });
    expect(added.status).toBe(200);
    expect((await ledger(optional.body.id)).chargeCents).toBe(13000);
    // Return this fixture to legacy mode for the pre-existing shirt assertions.
    await db.update(reunionFeesTable).set({ dinnerMode: null }).where(eq(reunionFeesTable.id, DINNER));
  });

  it("persists individual shirt choices, validates only opted-in sizes, and prices the ledger correctly", async () => {
    await db.update(reunionsTable).set({ collectShirtSizes: true }).where(eq(reunionsTable.id, R));
    const [shirt] = await db.insert(reunionFeesTable).values({
      reunionId: R, label: "T-Shirt", chargeType: "per_person", amount: 20, isOptional: true,
    }).returning();
    const attendees = [
      { name: "James", age: 40, includeDinner: false, addOns: [{ feeId: shirt.id, choices: [{ groupId: "legacy-size", valueId: "L" }] }] },
      { name: "Charlette", age: 35, includeDinner: false, addOns: [] },
    ];
    const missing = await as(AMY).post("/api/registrations").send({
      reunionId: R, branchName: "Lacey", attendees: [{ ...attendees[0], addOns: [{ feeId: shirt.id, choices: [] }] }, attendees[1]],
    });
    expect(missing.status).toBe(400);
    const created = await as(AMY).post("/api/registrations").send({
      reunionId: R, branchName: "Lacey", selectedFeeIds: [shirt.id], attendees,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.attendees.map((a: any) => a.addOns.length)).toEqual([1, 0]);
    expect((await ledger(created.body.id)).chargeCents).toBe(12000);
    // Older clients omit classification; renaming must lock the old label's treatment.
    const renamed = await as(ORG).put(`/api/reunions/${R}/fees/${shirt.id}`).send({
      label: "Family Keepsake", chargeType: "per_person", amount: 20, isOptional: true,
    });
    expect(renamed.status).toBe(200);
    expect(renamed.body).toMatchObject({ isShirt: false, isAddOn: true });
    expect((await ledger(created.body.id)).chargeCents).toBe(12000);
    const reloaded = await as(ORG).get(`/api/reunions/${R}`);
    expect(reloaded.body.reunion.fees.find((f: any) => f.id === shirt.id)).toMatchObject({ label: "Family Keepsake", isAddOn: true });
    expect((await as(ORG).post(`/api/reunions/${R}/fees`).send({
      label: "Household bundle", chargeType: "flat", amount: 20, isShirt: true,
    })).status).toBe(400);
    expect((await as(ORG).put(`/api/reunions/${R}/fees/${shirt.id}`).send({
      label: "Household bundle", chargeType: "flat", amount: 20, isShirt: true,
    })).status).toBe(400);
    const saved = await as(REGMGR).put(`/api/registrations/${created.body.id}`).send({
      branchName: "Lacey", selectedFeeIds: [shirt.id],
      attendees: created.body.attendees.map((a: any) => ({ id: a.id, name: a.name, age: a.age, includeDinner: false, addOns: [] })),
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect((await ledger(created.body.id)).chargeCents).toBe(10000);
    const rows = await db.select().from(attendeesTable).where(eq(attendeesTable.registrationId, created.body.id));
    expect(rows.every(a => !a.includeShirt && a.shirtSize === null)).toBe(true);
    const flat = await as(ORG).put(`/api/reunions/${R}/fees/${shirt.id}`).send({
      label: "Household bundle", chargeType: "flat", amount: 20, isOptional: true,
    });
    expect(flat.status).toBe(400);
    expect((await ledger(created.body.id)).chargeCents).toBe(10000);
  });
});
