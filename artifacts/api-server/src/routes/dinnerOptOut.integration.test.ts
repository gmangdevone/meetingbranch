import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { eq, inArray, sql } from "drizzle-orm";

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
  });

  it("an optional dinner needs the household opt-in first; opt-outs only remove dinner shares", async () => {
    // Opted in: Ann + Tot pay the $10 fish fry; Cy and Ben opted out.
    expect((await edit(REGMGR, regId, MIX, [OPT_DINNER])).status).toBe(200);
    expect((await ledger(regId)).chargeCents).toBe(15500 + 2000);
    expect((await edit(REGMGR, regId, MIX, [])).status).toBe(200);
    expect((await ledger(regId)).chargeCents).toBe(15500);
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
    expect(csv.text.split("\n")[0]).toMatch(/,Dinner Included$/);
    expect(csv.text).toContain('"Yes; No; Yes; No"');
  });
});
