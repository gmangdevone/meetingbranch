import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { eq, inArray, sql } from "drizzle-orm";

// Branch special fee (once per branch, paid IN FULL by one electing member) against the
// REAL dev Postgres schema. Clerk mocked; synthetic ids only.

const authState = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@clerk/express", () => ({
  // Per-request user header so concurrent requests can act as different members.
  getAuth: (req: { headers?: Record<string, string> }) => {
    const u = req?.headers?.["x-test-user"] ?? authState.userId;
    return { userId: u, sessionClaims: u ? { userId: u } : null };
  },
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
const REPORTS = `user_BfRep${RUN}`;
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
type Ledger = { branchId: number; state: string; paidCents: number; legacyCents: number; election: { id: number; status: string; userName: string | null } | null; entries: { reversed: boolean; legacy: boolean }[] };
const orgList = async (u = ORG) => (await as(u).get(`/api/reunions/${R}/branch-fees`)).body as { branches: Ledger[]; summary: { paidCount: number; paidCents: number; outstandingCount: number; outstandingCents: number; outstanding: { branchName: string; label: string; amountCents: number; elected: boolean }[] } };
const orgFee = async (branchId: number) => (await orgList()).branches.find((b) => b.branchId === branchId)!;
const options = async (u: string) => (await as(u).get(`/api/reunions/${R}/branch-fee-options`)).body.options as { branchId: number; state: string; electionId: number | null; amountCents: number }[];
const elect = (u: string, branchId: number, expectedAmountCents = 2000) => as(u).post(`/api/reunions/${R}/branch-fee-elections`).set("x-test-user", u).send({ branchId, expectedAmountCents });
const mine = async (u: string) => (await as(u).get(`/api/reunions/${R}/branch-fee-elections/mine`)).body.elections as { id: number; status: string; amountCents: number; history: unknown[] }[];
const reportFee = (electionId: number, u: string) =>
  as(u).post(`/api/branch-fee-elections/${electionId}/payment-submissions`).send({ method: "cash", reference: "Aunt May", givenDate: "2026-06-01" });
const regCount = async () => (await db.select().from(registrationsTable).where(eq(registrationsTable.reunionId, R))).length;
const pay = (body: Record<string, unknown>, u = ORG) =>
  as(u).post(`/api/reunions/${R}/receipts`).send({ method: "cash", receivedDate: "2026-06-01", idempotencyKey: key(), ...body });
const payBranch = (branchId: number, cents: number, extra: Record<string, unknown> = {}) =>
  pay({ amountCents: cents, allocations: [{ branchId, amountCents: cents, ...extra }] });
const report = (regId: number, u: string, body: Record<string, unknown>) =>
  as(u).post(`/api/registrations/${regId}/payment-submissions`).send({ method: "cash", reference: "Aunt May", givenDate: "2026-06-01", ...body });
const regLedger = async (id: number) => (await as(ORG).get(`/api/registrations/${id}/ledger`)).body.ledger;

describe.skipIf(!hasDb)("branch special fee: elected full-fee payer (real DB)", () => {
  beforeAll(async () => {
    await db.insert(usersTable).values([ORG, POWER, BRANCHES, REGMGR, ANN, REPORTS, AMY, BEN, CAL].map((id) => ({ id, email: `${id}@x.test`, isAdmin: false, firstName: id === AMY ? "Amy" : id === BEN ? "Ben" : null, lastName: id === AMY || id === BEN ? "Lacey" : null })));
    const [r] = await db.insert(reunionsTable).values({ code: `BF${RUN.slice(-7)}*`, name: "Branch Fee Reunion", startDate: "2027-07-01", endDate: "2027-07-03", paymentHandle: "", organizerId: ORG }).returning();
    R = r.id;
    await db.insert(reunionOrganizersTable).values([
      { reunionId: R, userId: POWER, roles: ["power_user"] },
      { reunionId: R, userId: BRANCHES, roles: ["branches"] },
      { reunionId: R, userId: REGMGR, roles: ["registration"] },
      { reunionId: R, userId: ANN, roles: ["announcements"] },
      { reunionId: R, userId: REPORTS, roles: ["reports"] },
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
      await db.execute(sql`DELETE FROM branch_fee_elections WHERE reunion_id = ${R}`);
      await db.delete(registrationsTable).where(eq(registrationsTable.reunionId, R));
      await db.delete(reunionsTable).where(eq(reunionsTable.id, R));
    }
    await db.delete(usersTable).where(inArray(usersTable.id, [ORG, POWER, BRANCHES, REGMGR, ANN, REPORTS, AMY, BEN, CAL]));
  });

  it("legacy branches have no fee: nothing to elect", async () => {
    expect(await options(AMY)).toEqual([]);
    expect((await elect(AMY, LACEY)).status).toBe(409);
  });

  it("authorization: only power users configure; registration managers and reports view; others refused", async () => {
    expect((await setFee(LACEY, {}, BRANCHES)).status).toBe(403);
    expect((await setFee(LACEY, {}, REGMGR)).status).toBe(403);
    expect((await setFee(LACEY, {}, AMY)).status).toBe(403);
    expect((await setFee(LACEY, {})).status).toBe(200);
    expect((await setFee(GOUDY, { label: "Goudy Gift", amountCents: 1500 }, ORG)).status).toBe(200);
    for (const u of [REGMGR, REPORTS, POWER]) expect((await as(u).get(`/api/reunions/${R}/branch-fees`)).status).toBe(200);
    for (const u of [ANN, BRANCHES, AMY]) expect((await as(u).get(`/api/reunions/${R}/branch-fees`)).status).toBe(403);
    expect((await options(AMY)).map((o) => o.state)).toEqual(["available", "available"]);
  });

  it("standalone: elect and report the full fee with NO attendee registration; pending is not paid; confirm marks it paid once", async () => {
    const before = await regCount();
    expect((await elect(AMY, LACEY, 1999)).status).toBe(409); // amount changed under them
    const e = await elect(AMY, LACEY);
    expect(e.status).toBe(200);
    expect(e.body).toMatchObject({ status: "unpaid", amountCents: 2000, label: "Sibling Fee", branchName: "Lacey" });
    expect((await elect(AMY, LACEY)).body.id).toBe(e.body.id); // idempotent, no duplicate charge
    expect((await elect(BEN, LACEY)).status).toBe(409); // owned by Amy
    expect((await options(BEN)).find((o) => o.branchId === LACEY)).toMatchObject({ state: "claimed", electionId: null });
    expect(await regCount()).toBe(before); // no phantom attendee registration

    const rep = await reportFee(e.body.id, AMY);
    expect(rep.status).toBe(201);
    expect(rep.body).toMatchObject({ registrationId: null, registrationIds: [], amountCents: 2000, branchFee: { electionId: e.body.id, amountCents: 2000 } });
    expect((await reportFee(e.body.id, AMY)).status).toBe(409); // already reported
    expect((await reportFee(e.body.id, BEN)).status).toBe(403);
    expect((await mine(AMY))[0].status).toBe("reported");
    let list = await orgList(REPORTS);
    expect(list.summary).toMatchObject({ paidCount: 0, paidCents: 0, outstandingCount: 2, outstandingCents: 3500 });
    expect(list.branches.find((b) => b.branchId === LACEY)).toMatchObject({ state: "reported", election: { userName: "Amy Lacey" } });

    expect((await pay({ amountCents: 1200, submissionId: rep.body.id, allocations: [{ branchId: LACEY, amountCents: 1200 }] })).status).toBe(409); // full fee only
    const ok = await pay({ amountCents: 2000, submissionId: rep.body.id, allocations: [{ branchId: LACEY, amountCents: 2000 }] });
    expect(ok.status).toBe(201);
    expect((await mine(AMY))[0]).toMatchObject({ status: "paid" });
    list = await orgList();
    expect(list.summary).toMatchObject({ paidCount: 1, paidCents: 2000, outstandingCount: 1, outstandingCents: 1500 });
    expect(list.summary.outstanding).toEqual([{ branchId: GOUDY, branchName: "Goudy", label: "Goudy Gift", amountCents: 1500, elected: false }]);
    expect((await payBranch(LACEY, 2000)).status).toBe(409); // once per branch
    expect((await options(BEN)).find((o) => o.branchId === LACEY)?.state).toBe("paid");
    expect((await options(AMY)).find((o) => o.branchId === LACEY)?.state).toBe("yours_paid");
    expect((await as(AMY).delete(`/api/branch-fee-elections/${e.body.id}`)).status).toBe(409); // paid can't be released
  });

  it("combined: attendee dues and the full fee are separate charges; the fee never touches the registration ledger", async () => {
    const reg = await newReg(CAL, "Goudy");
    const e = await elect(CAL, GOUDY, 1500);
    expect(e.status).toBe(200);
    expect((await report(reg, CAL, { amount: 15, branchFeeElectionId: e.body.id })).status).toBe(400); // must include dues too
    expect((await report(reg, AMY, { amount: 95, branchFeeElectionId: e.body.id })).status).toBe(403);
    const rep = await report(reg, CAL, { amount: 95, registrationIds: [reg], branchFeeElectionId: e.body.id });
    expect(rep.status).toBe(201);
    expect((await regLedger(reg))).toMatchObject({ balanceCents: 8000, pendingReportedCents: 8000 });
    const ok = await pay({ amountCents: 9500, submissionId: rep.body.id, allocations: [{ branchId: GOUDY, amountCents: 1500 }, { registrationId: reg, amountCents: 8000 }] });
    expect(ok.status).toBe(201);
    expect((await regLedger(reg))).toMatchObject({ balanceCents: 0, confirmedCents: 8000, chargeCents: 8000 });
    expect((await orgFee(GOUDY))).toMatchObject({ state: "paid", paidCents: 1500 });
    // Reversal reopens the fee (the report is pending again, not paid) and the report counts.
    expect((await as(ORG).post(`/api/reunions/${R}/receipts/${ok.body.receiptId}/reversal`).send({ reason: "Bounced check" })).status).toBe(200);
    const after = await orgList();
    expect(after.branches.find((b) => b.branchId === GOUDY)).toMatchObject({ state: "reported", paidCents: 0 });
    expect(after.summary).toMatchObject({ paidCount: 1, outstandingCount: 1, outstandingCents: 1500 });
    expect((await regLedger(reg)).balanceCents).toBe(8000);
  });

  it("duplicate concurrent confirmations: exactly one marks the fee paid", async () => {
    const [res1, res2] = await Promise.all([payBranch(GOUDY, 1500), payBranch(GOUDY, 1500)]);
    expect([res1.status, res2.status].sort()).toEqual([201, 409]);
    expect((await orgFee(GOUDY)).state).toBe("paid");
    // Idempotent retry of the winner returns the original receipt.
    const winner = res1.status === 201 ? res1 : res2;
    expect(winner.body.duplicate).toBe(false);
  });

  it("concurrent elections by two members: one owner only", async () => {
    await db.execute(sql`UPDATE reunion_branches SET special_fee_enabled = true, special_fee_cents = 700, special_fee_label = 'Tee Fee' WHERE id = ${GOUDY}`);
    const [b] = await db.insert(reunionBranchesTable).values({ reunionId: R, name: "Price", sortOrder: 2, specialFeeEnabled: true, specialFeeCents: 700 }).returning();
    const [x, y] = await Promise.all([elect(AMY, b.id, 700), elect(BEN, b.id, 700)]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    // Owner release (unpaid) lets someone else elect; history stays.
    const owner = x.status === 200 ? AMY : BEN;
    const other = owner === AMY ? BEN : AMY;
    const id = (x.status === 200 ? x : y).body.id;
    expect((await as(other).delete(`/api/branch-fee-elections/${id}`)).status).toBe(403);
    expect((await as(owner).delete(`/api/branch-fee-elections/${id}`)).status).toBe(204);
    expect((await elect(other, b.id, 700)).status).toBe(200);
    const rows2 = await db.execute(sql`SELECT status FROM branch_fee_elections WHERE branch_id = ${b.id} ORDER BY id`) as unknown as { rows: { status: string }[] };
    expect(rows2.rows.map((r) => r.status)).toEqual(["released", "active"]);
    // Organizer can release a reported election; the stale report can't then be confirmed.
    const el = (await mine(other)).find((m) => m.amountCents === 700)!;
    const rep = await reportFee(el.id, other);
    expect((await as(other).delete(`/api/branch-fee-elections/${el.id}`)).status).toBe(409);
    expect((await as(REGMGR).delete(`/api/branch-fee-elections/${el.id}`)).status).toBe(204);
    expect((await pay({ amountCents: 700, submissionId: rep.body.id, allocations: [{ branchId: b.id, amountCents: 700 }] })).status).toBe(409);
    // Deleting the branch with history archives it.
    expect((await as(BRANCHES).delete(`/api/reunions/${R}/branches/${b.id}`)).status).toBe(204);
    expect((await orgList()).branches.find((x2) => x2.branchId === b.id)).toMatchObject({ archived: true });
  });

  it("legacy pooled partial money is kept for review and never marks a fee paid; pooled allocations are refused", async () => {
    const [b] = await db.insert(reunionBranchesTable).values({ reunionId: R, name: "Legacy", sortOrder: 3, specialFeeEnabled: true, specialFeeCents: 2000 }).returning();
    const rec = await db.execute(sql`INSERT INTO payment_receipts (reunion_id, kind, amount_cents, method, received_date, idempotency_key, recorded_by) VALUES (${R}, 'payment', 800, 'cash', '2026-05-01', ${key()}, ${ORG}) RETURNING id`) as unknown as { rows: { id: number }[] };
    await db.execute(sql`INSERT INTO payment_receipt_allocations (receipt_id, reunion_id, amount_cents, branch_id) VALUES (${rec.rows[0].id}, ${R}, 800, ${b.id})`);
    const l = await orgFee(b.id);
    expect(l).toMatchObject({ state: "legacy_review", legacyCents: 800, paidCents: 0, election: null });
    expect(l.entries[0]).toMatchObject({ legacy: true, reversed: false, payerName: null }); // no inferred payer
    expect((await payBranch(b.id, 1200)).status).toBe(409); // no election: no pooled top-up
    // Partial legacy blocks a NEW full-fee election (no silent re-collection).
    expect((await elect(BEN, b.id)).status).toBe(409);
    expect((await options(BEN)).find((o) => o.branchId === b.id)?.state).toBe("under_review");
    let sum = (await orgList()).summary;
    expect(sum.outstanding.find((o) => o.branchName === "Legacy")).toMatchObject({ amountCents: 1200, elected: false });

    // Fully covered by previously confirmed pooled money: stays PAID, counted, not electable.
    const before = sum.paidCount;
    const [full] = await db.insert(reunionBranchesTable).values({ reunionId: R, name: "Covered", sortOrder: 4, specialFeeEnabled: true, specialFeeCents: 1000 }).returning();
    const rec2 = await db.execute(sql`INSERT INTO payment_receipts (reunion_id, kind, amount_cents, method, received_date, idempotency_key, recorded_by) VALUES (${R}, 'payment', 1000, 'cash', '2026-05-01', ${key()}, ${ORG}) RETURNING id`) as unknown as { rows: { id: number }[] };
    await db.execute(sql`INSERT INTO payment_receipt_allocations (receipt_id, reunion_id, amount_cents, branch_id) VALUES (${rec2.rows[0].id}, ${R}, 1000, ${full.id})`);
    expect(await orgFee(full.id)).toMatchObject({ state: "paid", paidCents: 1000, legacyCents: 1000, election: null });
    expect((await elect(BEN, full.id, 1000)).status).toBe(409);
    expect((await options(BEN)).find((o) => o.branchId === full.id)?.state).toBe("paid");
    sum = (await orgList()).summary;
    expect(sum.paidCount).toBe(before + 1);
    expect(sum.outstanding.some((o) => o.branchName === "Covered")).toBe(false);
    // Reversing the legacy receipt reopens it.
    expect((await as(ORG).post(`/api/reunions/${R}/receipts/${rec2.rows[0].id}/reversal`).send({ reason: "Refunded" })).status).toBe(200);
    expect((await orgFee(full.id)).state).toBe("open");
  });

  it("a disabled branch's unpaid election is shown as not collecting and can't be paid", async () => {
    const [b] = await db.insert(reunionBranchesTable).values({ reunionId: R, name: "Paused", sortOrder: 5, specialFeeEnabled: true, specialFeeCents: 500 }).returning();
    const e = await elect(CAL, b.id, 500);
    expect(e.status).toBe(200);
    expect((await setFee(b.id, { enabled: false, amountCents: 500 })).status).toBe(200);
    expect((await options(CAL)).find((o) => o.branchId === b.id)?.state).toBe("yours_disabled");
    expect((await options(BEN)).find((o) => o.branchId === b.id)).toBeUndefined();
    const m = (await as(CAL).get(`/api/reunions/${R}/branch-fee-elections/mine`)).body.elections.find((x: { id: number }) => x.id === e.body.id);
    expect(m).toMatchObject({ status: "unpaid", collecting: false });
    expect((await reportFee(e.body.id, CAL)).status).toBe(409);
  });

  it("fee-only payers still find the event: memberships count the election, not headcount", async () => {
    const res = await as(AMY).get("/api/me/event-memberships");
    expect(res.status).toBe(200);
    expect(res.body.find((m: { reunionId: number }) => m.reunionId === R)).toMatchObject({ activeRegistrationCount: 0, activeBranchFeeElectionCount: 1 });
  });

  it("member report refuses a paid election; Amy's hub history shows amounts/dates only", async () => {
    const [m] = (await mine(AMY)).filter((x) => x.status === "paid");
    expect(m.history.length).toBe(1);
    expect(JSON.stringify(m.history)).not.toContain("Amy");
    expect((await reportFee(m.id, AMY)).status).toBe(409);
  });
});
