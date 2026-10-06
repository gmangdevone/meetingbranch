import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { eq, inArray, sql } from "drizzle-orm";

// Branch special fee (one shared, one-time, opt-in fee per branch) against the
// REAL dev Postgres schema. Clerk mocked; synthetic ids only.

const authState = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: authState.userId, sessionClaims: authState.userId ? { userId: authState.userId } : null }),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  clerkClient: { users: { getUser: async () => ({ emailAddresses: [] }) } },
}));

const hasDb = !!process.env.DATABASE_URL;
const { db, usersTable, reunionsTable, reunionOrganizersTable, reunionFeesTable, reunionBranchesTable, registrationsTable, paymentSubmissionsTable } =
  await import("@workspace/db");
const { default: apiRouter } = await import("./index");

const RUN = `${Date.now()}`;
const ORG = `user_BfOrg${RUN}`;
const POWER = `user_BfPower${RUN}`;
const BRANCHES = `user_BfBranches${RUN}`;
const REGMGR = `user_BfReg${RUN}`;
const ANN = `user_BfAnn${RUN}`;
const AMY = `user_BfAmy${RUN}`;
const BEN = `user_BfBen${RUN}`;
const CAL = `user_BfCal${RUN}`;
let R = 0;
let LACEY = 0;
let GOUDY = 0;

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
const key = () => `bf${RUN}x${++seq}`;
async function newReg(user: string, branchName = "Lacey", paymentStatus: "pending" | "paid" = "pending") {
  const [r] = await db.insert(registrationsTable).values({ reunionId: R, userId: user, branchName, attendeeCount: 1, paymentStatus }).returning();
  return r.id;
}
const setFee = (branchId: number, body: Record<string, unknown>, u = POWER) =>
  as(u).put(`/api/reunions/${R}/branches/${branchId}/special-fee`).send({ enabled: true, label: "Sibling Fee", amountCents: 2000, ...body });
const fee = async (regId: number, u: string) => (await as(u).get(`/api/registrations/${regId}/branch-fee`)).body.branchFee;
const orgFees = async (u = ORG) => (await as(u).get(`/api/reunions/${R}/branch-fees`)).body.branches as { branchId: number; [k: string]: unknown }[];
const pay = (body: Record<string, unknown>, u = ORG) =>
  as(u).post(`/api/reunions/${R}/receipts`).send({ method: "cash", receivedDate: "2026-06-01", idempotencyKey: key(), ...body });
const payBranch = (branchId: number, cents: number, extra: Record<string, unknown> = {}) =>
  pay({ amountCents: cents, allocations: [{ branchId, amountCents: cents, ...extra }] });
const report = (regId: number, u: string, body: Record<string, unknown>) =>
  as(u).post(`/api/registrations/${regId}/payment-submissions`).send({ method: "cash", reference: "Aunt May", givenDate: "2026-06-01", ...body });
const regLedger = async (id: number) => (await as(ORG).get(`/api/registrations/${id}/ledger`)).body.ledger;
const fund = async () => (await as(ORG).get(`/api/reunions/${R}/sponsorship`)).body;

describe.skipIf(!hasDb)("branch special fee (real DB)", () => {
  beforeAll(async () => {
    await db.insert(usersTable).values([ORG, POWER, BRANCHES, REGMGR, ANN, AMY, BEN, CAL].map((id) => ({ id, email: "", isAdmin: false, firstName: id === AMY ? "Amy" : id === BEN ? "Ben" : null, lastName: id === AMY || id === BEN ? "Lacey" : null })));
    const [r] = await db.insert(reunionsTable).values({ code: `BF${RUN.slice(-7)}*`, name: "Branch Fee Reunion", startDate: "2027-07-01", endDate: "2027-07-03", paymentHandle: "", organizerId: ORG }).returning();
    R = r.id;
    await db.insert(reunionOrganizersTable).values([
      { reunionId: R, userId: POWER, roles: ["power_user"] },
      { reunionId: R, userId: BRANCHES, roles: ["branches"] },
      { reunionId: R, userId: REGMGR, roles: ["registration"] },
      { reunionId: R, userId: ANN, roles: ["announcements"] },
    ]);
    await db.insert(reunionFeesTable).values({ reunionId: R, label: "Registration", chargeType: "flat", amount: 80 });
    const [l, g] = await db.insert(reunionBranchesTable).values([{ reunionId: R, name: "Lacey" }, { reunionId: R, name: "Goudy", sortOrder: 1 }]).returning();
    LACEY = l.id;
    GOUDY = g.id;
  });
  afterAll(async () => {
    if (R) {
      await db.execute(sql`DELETE FROM payment_receipts WHERE reunion_id = ${R}`);
      await db.delete(paymentSubmissionsTable).where(eq(paymentSubmissionsTable.reunionId, R));
      await db.delete(registrationsTable).where(eq(registrationsTable.reunionId, R));
      await db.delete(reunionsTable).where(eq(reunionsTable.id, R));
    }
    await db.delete(usersTable).where(inArray(usersTable.id, [ORG, POWER, BRANCHES, REGMGR, ANN, AMY, BEN, CAL]));
  });

  it("legacy branches default to no fee; nothing is ever auto-charged", async () => {
    const a = await newReg(AMY);
    expect(await fee(a, AMY)).toBeNull();
    const reunion = (await as(ORG).get(`/api/reunions/${R}`)).body.reunion;
    expect(reunion.branches.find((b: { id: number }) => b.id === LACEY)).toMatchObject({ specialFeeEnabled: false, specialFeeCents: 0 });
    expect((await setFee(LACEY, {})).status).toBe(200);
    // Turning the fee on never changes registration dues.
    expect((await regLedger(a))).toMatchObject({ chargeCents: 8000, balanceCents: 8000 });
  });

  it("authorization: power users configure; branches-only and others cannot; registration managers can view", async () => {
    expect((await setFee(GOUDY, {}, BRANCHES)).status).toBe(403);
    expect((await setFee(GOUDY, {}, ANN)).status).toBe(403);
    expect((await setFee(GOUDY, {}, REGMGR)).status).toBe(403);
    expect((await setFee(GOUDY, { enabled: false, amountCents: 0 }, ORG)).status).toBe(200);
    expect((await as(BRANCHES).get(`/api/reunions/${R}/branch-fees`)).status).toBe(403);
    expect((await as(REGMGR).get(`/api/reunions/${R}/branch-fees`)).status).toBe(200);
    expect((await as(POWER).get(`/api/reunions/${R}/branch-fees`)).status).toBe(200);
    expect((await setFee(GOUDY, { amountCents: 0 })).status).toBe(400);
    expect((await setFee(GOUDY, { label: "  " })).status).toBe(400);
    // Branches-only users can still rename branches; power users can't (no branches role).
    expect((await as(POWER).put(`/api/reunions/${R}/branches/${GOUDY}`).send({ name: "Goudy" })).status).toBe(403);
  });

  it("shared once per branch: two registrants pay $12 + $8 of $20; then settled and suppressed for everyone", async () => {
    const a = await newReg(AMY);
    const b = await newReg(BEN);
    expect(await fee(b, BEN)).toMatchObject({ label: "Sibling Fee", amountCents: 2000, remainingCents: 2000, settled: false });
    // Opt-in report, installment of $12, fee-only (no registrations).
    const s1 = await report(a, AMY, { amount: 12, registrationIds: [], branchFeeAmount: 12 });
    expect(s1.status).toBe(201);
    expect(s1.body.branchFee).toMatchObject({ branchId: LACEY, amountCents: 1200 });
    // Pending self reports never reduce the balance.
    expect(await fee(b, BEN)).toMatchObject({ remainingCents: 2000, pendingReportedCents: 1200 });
    expect((await regLedger(a)).pendingReportedCents).toBe(0);
    expect((await pay({ amountCents: 1200, submissionId: s1.body.id, allocations: [{ branchId: LACEY, amountCents: 1200 }] })).status).toBe(201);
    expect(await fee(b, BEN)).toMatchObject({ paidCents: 1200, remainingCents: 800, pendingReportedCents: 0 });
    // Ben: mixed report ($80 registration + $8 branch fee) = $88, penny exact.
    const s2 = await report(b, BEN, { amount: 88, branchFeeAmount: 8 });
    expect(s2.status).toBe(201);
    expect((await regLedger(b)).pendingReportedCents).toBe(8000);
    const r2 = await pay({ amountCents: 8800, submissionId: s2.body.id, allocations: [{ registrationId: b, amountCents: 8000 }, { branchId: LACEY, amountCents: 800 }] });
    expect(r2.status).toBe(201);
    expect(await regLedger(b)).toMatchObject({ confirmedCents: 8000, balanceCents: 0, status: "paid" });
    const shared = await fee(a, AMY);
    expect(shared).toMatchObject({ paidCents: 2000, remainingCents: 0, settled: true });
    // Members never see who paid; organizers do.
    expect(shared.entries.every((e: { payerName: unknown; payerRegistrationId: unknown }) => e.payerName == null && e.payerRegistrationId == null)).toBe(true);
    const org = (await orgFees()).find((x) => x.branchId === LACEY) as unknown as { entries: { payerName: string; payerRegistrationId: number }[] };
    expect(org.entries.map((e) => e.payerRegistrationId)).toEqual([a, b]);
    expect(org.entries[0].payerName).toBe("Amy Lacey");
    // Settled: no repeated charge -- new reports and receipts are refused.
    expect((await report(a, AMY, { amount: 5, registrationIds: [], branchFeeAmount: 5 })).status).toBe(409);
    const c = await newReg(CAL);
    expect((await report(c, CAL, { amount: 5, registrationIds: [], branchFeeAmount: 5 })).status).toBe(409);
    expect((await payBranch(LACEY, 100)).status).toBe(409);
    // Never leaks into registration balances or the fund.
    expect((await regLedger(a))).toMatchObject({ confirmedCents: 0, balanceCents: 8000 });
    expect((await fund()).totalContributed).toBe(0);
  });

  it("explicit selection works even when the registration is settled; over-reporting and stale reports are refused", async () => {
    await setFee(GOUDY, { label: "Goudy Reunion Fund", amountCents: 3000 });
    const d = await newReg(CAL, "Goudy", "paid");
    expect((await report(d, CAL, { amount: 40, registrationIds: [], branchFeeAmount: 40 })).status).toBe(409);
    expect((await report(d, CAL, { amount: 20, registrationIds: [], branchFeeAmount: 10 })).status).toBe(400);
    const s = await report(d, CAL, { amount: 20, registrationIds: [], branchFeeAmount: 20 });
    expect(s.status).toBe(201);
    // Someone else's $15 is confirmed first: the stale $20 report can't over-collect.
    expect((await payBranch(GOUDY, 1500)).status).toBe(201);
    const stale = await pay({ amountCents: 2000, submissionId: s.body.id, allocations: [{ branchId: GOUDY, amountCents: 2000 }] });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toMatch(/\$15\.00 left/);
    expect((await pay({ amountCents: 1500, submissionId: s.body.id, allocations: [{ branchId: GOUDY, amountCents: 1500 }] })).status).toBe(201);
    expect(await fee(d, CAL)).toMatchObject({ paidCents: 3000, remainingCents: 0, settled: true });
    // Registration path untouched: a branch fee allocation can't use another branch's payer.
    expect((await payBranch(LACEY, 100, { payerRegistrationId: d })).status).toBe(409);
  });

  it("concurrent receipts can't over-collect; idempotent retries return the original", async () => {
    const [x] = await db.insert(reunionBranchesTable).values({ reunionId: R, name: "Race", specialFeeEnabled: true, specialFeeLabel: "Race Fee", specialFeeCents: 2000 }).returning();
    const results = await Promise.all([payBranch(x.id, 1500), payBranch(x.id, 1500), payBranch(x.id, 1500)]);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(2);
    const body = { method: "cash", receivedDate: "2026-06-01", idempotencyKey: key(), amountCents: 500, allocations: [{ branchId: x.id, amountCents: 500 }] };
    const same = await Promise.all([as(ORG).post(`/api/reunions/${R}/receipts`).send(body).then((r) => r), as(ORG).post(`/api/reunions/${R}/receipts`).send(body).then((r) => r)]);
    expect(same.map((r) => r.status).sort()).toEqual([200, 201]);
    const f = (await orgFees()).find((b) => b.branchId === x.id);
    expect(f).toMatchObject({ paidCents: 2000, remainingCents: 0 });
  });

  it("reversal reopens the shared balance; reductions keep paid history as credit; disabling stops new money", async () => {
    const [y] = await db.insert(reunionBranchesTable).values({ reunionId: R, name: "Edits", specialFeeEnabled: true, specialFeeLabel: "Edit Fee", specialFeeCents: 2000 }).returning();
    const r1 = await payBranch(y.id, 2000);
    expect((await as(ORG).post(`/api/reunions/${R}/receipts/${r1.body.receiptId}/reversal`).send({ reason: "Wrong branch" })).status).toBe(200);
    let f = (await orgFees()).find((b) => b.branchId === y.id) as Record<string, unknown>;
    expect(f).toMatchObject({ paidCents: 0, remainingCents: 2000 });
    expect((f.entries as { reversed: boolean; reversalReason: string }[])[0]).toMatchObject({ reversed: true, reversalReason: "Wrong branch" });
    expect((await payBranch(y.id, 2000)).status).toBe(201);
    const red = await setFee(y.id, { label: "Edit Fee", amountCents: 1500 });
    expect(red.body).toMatchObject({ paidCents: 2000, remainingCents: 0, creditCents: 500, settled: true });
    await setFee(y.id, { enabled: false, amountCents: 1500 });
    await setFee(y.id, { enabled: true, amountCents: 3000 });
    expect((await orgFees()).find((b) => b.branchId === y.id)).toMatchObject({ paidCents: 2000, remainingCents: 1000 });
    await setFee(y.id, { enabled: false, amountCents: 3000 });
    expect((await payBranch(y.id, 500)).status).toBe(409);
  });

  it("rename keeps the branch id, registrations and history; deleting a branch with money archives it", async () => {
    const [z] = await db.insert(reunionBranchesTable).values({ reunionId: R, name: "Old Name", specialFeeEnabled: true, specialFeeLabel: "Kin Fee", specialFeeCents: 1000 }).returning();
    const reg = await newReg(AMY, "Old Name");
    expect((await payBranch(z.id, 400, { payerRegistrationId: reg })).status).toBe(201);
    expect((await as(BRANCHES).put(`/api/reunions/${R}/branches/${z.id}`).send({ name: "New Name" })).status).toBe(200);
    expect(await fee(reg, AMY)).toMatchObject({ branchId: z.id, branchName: "New Name", paidCents: 400, remainingCents: 600 });
    expect((await as(BRANCHES).put(`/api/reunions/${R}/branches/${z.id}`).send({ name: "Lacey" })).status).toBe(409);
    expect((await as(BRANCHES).delete(`/api/reunions/${R}/branches/${z.id}`)).status).toBe(204);
    const [row] = await db.select().from(reunionBranchesTable).where(eq(reunionBranchesTable.id, z.id));
    expect(row.archivedAt).not.toBeNull();
    expect(row.specialFeeEnabled).toBe(false);
    expect((await as(ORG).get(`/api/reunions/${R}`)).body.reunion.branches.some((b: { id: number }) => b.id === z.id)).toBe(false);
    expect((await orgFees()).find((b) => b.branchId === z.id)).toMatchObject({ archived: true, paidCents: 400 });
    // A branch without history is really deleted.
    const [w] = await db.insert(reunionBranchesTable).values({ reunionId: R, name: "Empty" }).returning();
    expect((await as(BRANCHES).delete(`/api/reunions/${R}/branches/${w.id}`)).status).toBe(204);
    expect(await db.select().from(reunionBranchesTable).where(eq(reunionBranchesTable.id, w.id))).toHaveLength(0);
  });

  it("members can only read their own branch fee; outsiders can't report for others", async () => {
    const a = await newReg(AMY);
    expect((await as(BEN).get(`/api/registrations/${a}/branch-fee`)).status).toBe(403);
    expect((await report(a, BEN, { amount: 5, registrationIds: [], branchFeeAmount: 5 })).status).toBe(403);
    expect((await report(a, AMY, { amount: 5, registrationIds: [] })).status).toBe(400);
  });
});
