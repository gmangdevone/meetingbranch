import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { and, eq, inArray, sql } from "drizzle-orm";

// ──────────────────────────────────────────────────────────────────────────────
// Partial payments ledger against the REAL dev Postgres schema (Clerk mocked).
// Synthetic ids only; no emails are sent (rows are inserted directly).
// ──────────────────────────────────────────────────────────────────────────────

const authState = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: authState.userId, sessionClaims: authState.userId ? { userId: authState.userId } : null }),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  clerkClient: { users: { getUser: async () => ({ emailAddresses: [] }) } },
}));

const hasDb = !!process.env.DATABASE_URL;
const {
  db, usersTable, reunionsTable, reunionOrganizersTable, reunionFeesTable, registrationsTable,
  sponsorshipContributionsTable, sponsorshipAllocationsTable, paymentSubmissionsTable,
} = await import("@workspace/db");
const { default: apiRouter } = await import("./index");

const RUN = `${Date.now()}`;
const ORG = `user_LgOrg${RUN}`;
const NOROLE = `user_LgNoRole${RUN}`;
const MEMBER = `user_LgMember${RUN}`;
const OTHER = `user_LgOther${RUN}`;
let R = 0;
let FEE = 0;

function app(): Express {
  const a = express();
  a.use(express.json());
  a.use("/api", apiRouter);
  return a;
}
const as = (userId: string | null) => {
  authState.userId = userId;
  return request(app());
};
let keySeq = 0;
const key = () => `k${RUN}x${++keySeq}`;

async function newReg(opts: { paymentStatus?: "pending" | "paid" | "waived"; user?: string } = {}) {
  const [r] = await db
    .insert(registrationsTable)
    .values({ reunionId: R, userId: opts.user ?? MEMBER, branchName: "Main", attendeeCount: 1, paymentStatus: opts.paymentStatus ?? "pending" })
    .returning();
  return r.id;
}
const ledger = async (id: number, user = ORG) => (await as(user).get(`/api/registrations/${id}/ledger`)).body;
const pay = (body: Record<string, unknown>, user = ORG) =>
  as(user).post(`/api/reunions/${R}/receipts`).send({ method: "cash", receivedDate: "2026-06-01", idempotencyKey: key(), ...body });
const one = (registrationId: number, amountCents: number, extra: Record<string, unknown> = {}) =>
  pay({ amountCents, allocations: [{ registrationId, amountCents }], ...extra });

describe.skipIf(!hasDb)("partial payment ledger (real DB)", () => {
  beforeAll(async () => {
    await db.insert(usersTable).values([ORG, NOROLE, MEMBER, OTHER].map((id) => ({ id, email: "", isAdmin: false })));
    const [r] = await db
      .insert(reunionsTable)
      .values({ code: `LG${RUN.slice(-7)}*`, name: "Ledger Reunion", startDate: "2027-07-01", endDate: "2027-07-03", paymentHandle: "", organizerId: ORG })
      .returning();
    R = r.id;
    await db.insert(reunionOrganizersTable).values({ reunionId: R, userId: NOROLE, roles: ["schedule"] });
    const [f] = await db.insert(reunionFeesTable).values({ reunionId: R, label: "Registration", chargeType: "flat", amount: 80 }).returning();
    FEE = f.id;
  });
  afterAll(async () => {
    if (R) {
      await db.execute(sql`DELETE FROM payment_receipts WHERE reunion_id = ${R}`);
      await db.delete(paymentSubmissionsTable).where(eq(paymentSubmissionsTable.reunionId, R));
      await db.delete(sponsorshipAllocationsTable).where(eq(sponsorshipAllocationsTable.reunionId, R));
      await db.delete(sponsorshipContributionsTable).where(eq(sponsorshipContributionsTable.reunionId, R));
      await db.delete(registrationsTable).where(eq(registrationsTable.reunionId, R));
      await db.delete(reunionFeesTable).where(eq(reunionFeesTable.reunionId, R));
      await db.delete(reunionOrganizersTable).where(eq(reunionOrganizersTable.reunionId, R));
      await db.delete(reunionsTable).where(eq(reunionsTable.id, R));
    }
    await db.delete(usersTable).where(inArray(usersTable.id, [ORG, NOROLE, MEMBER, OTHER]));
  });

  it("installments: $80 paid $30 leaves $50; another $50 settles it; excess is refused", async () => {
    const id = await newReg();
    expect((await ledger(id)).ledger).toMatchObject({ chargeCents: 8000, balanceCents: 8000, status: "unpaid" });
    expect((await one(id, 3000)).status).toBe(201);
    expect((await ledger(id)).ledger).toMatchObject({ confirmedCents: 3000, balanceCents: 5000, status: "partial" });
    expect((await one(id, 5000)).status).toBe(201);
    const l = await ledger(id);
    expect(l.ledger).toMatchObject({ balanceCents: 0, status: "paid" });
    expect(l.entries).toHaveLength(2);
    const [row] = await db.select().from(registrationsTable).where(eq(registrationsTable.id, id));
    expect(row.paymentStatus).toBe("paid");
    const extra = await one(id, 1);
    expect(extra.status).toBe(409);
    expect(extra.body.error).toMatch(/not turned into a donation/);
  });

  it("exact cents and validation", async () => {
    const id = await newReg();
    expect((await one(id, 1234)).status).toBe(201);
    expect((await ledger(id)).ledger.balanceCents).toBe(6766);
    for (const bad of [0, -100, 12.5, "100", null]) {
      expect((await pay({ amountCents: bad, allocations: [{ registrationId: id, amountCents: bad }] })).status).toBe(400);
    }
    const mismatch = await pay({ amountCents: 1000, allocations: [{ registrationId: id, amountCents: 999 }] });
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.error).toMatch(/\$9\.99.*\$10\.00/);
    expect((await pay({ amountCents: 100, receivedDate: "2999-01-01", allocations: [{ registrationId: id, amountCents: 100 }] })).status).toBe(400);
    expect((await pay({ amountCents: 100, method: "bitcoin", allocations: [{ registrationId: id, amountCents: 100 }] })).status).toBe(400);
  });

  it("duplicate confirmation is idempotent and concurrent over-allocation is serialized", async () => {
    const id = await newReg();
    const k = key();
    const a = await one(id, 2000, { idempotencyKey: k });
    const b = await one(id, 2000, { idempotencyKey: k });
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect(b.body).toMatchObject({ duplicate: true, receiptId: a.body.receiptId });
    expect((await one(id, 9999, { idempotencyKey: k })).status).toBe(409);
    expect((await ledger(id)).ledger.confirmedCents).toBe(2000);
    // Two 50.00 receipts racing against a 60.00 balance: exactly one wins.
    const res = await Promise.all([one(id, 5000), one(id, 5000)]);
    expect(res.map((r) => r.status).sort()).toEqual([201, 409]);
    expect((await ledger(id)).ledger.balanceCents).toBe(1000);
  });

  it("only registration managers record or reverse; members see their own balance without private fields", async () => {
    const id = await newReg();
    expect((await pay({ amountCents: 100, allocations: [{ registrationId: id, amountCents: 100 }] }, MEMBER)).status).toBe(403);
    expect((await pay({ amountCents: 100, allocations: [{ registrationId: id, amountCents: 100 }] }, NOROLE)).status).toBe(403);
    expect((await as(null).post(`/api/reunions/${R}/receipts`).send({})).status).toBe(401);
    const ok = await one(id, 100, { reference: "chk 1001", note: "front desk" });
    expect((await as(MEMBER).post(`/api/reunions/${R}/receipts/${ok.body.receiptId}/reversal`).send({ reason: "nope" })).status).toBe(403);
    const mine = await ledger(id, MEMBER);
    expect(mine.canManage).toBe(false);
    expect(mine.entries[0]).toMatchObject({ registrationCents: 100, recordedByName: null, reference: null, note: null });
    expect((await as(OTHER).get(`/api/registrations/${id}/ledger`)).status).toBe(403);
  });

  it("reversal needs a reason, keeps history, and allows a single replacement", async () => {
    const id = await newReg();
    const r1 = await one(id, 4000);
    const rid = r1.body.receiptId;
    expect((await one(id, 4000, { replacesReceiptId: rid })).status).toBe(409); // not reversed yet
    expect((await as(ORG).post(`/api/reunions/${R}/receipts/${rid}/reversal`).send({ reason: " " })).status).toBe(400);
    const rev = await as(ORG).post(`/api/reunions/${R}/receipts/${rid}/reversal`).send({ reason: "Wrong amount, was $35" });
    expect(rev.status).toBe(200);
    expect(rev.body.ledgers[0].balanceCents).toBe(8000);
    expect((await as(ORG).post(`/api/reunions/${R}/receipts/${rid}/reversal`).send({ reason: "again" })).status).toBe(409);
    expect((await one(id, 3500, { replacesReceiptId: rid })).status).toBe(201);
    expect((await one(id, 100, { replacesReceiptId: rid })).status).toBe(409);
    const l = await ledger(id);
    expect(l.ledger.balanceCents).toBe(4500);
    expect(l.entries).toHaveLength(2);
    const orig = l.entries.find((e: { id: number }) => e.id === rid);
    expect(orig.reversed).toMatchObject({ reason: "Wrong amount, was $35" });
    expect(orig.recordedByName).toBeTruthy();
  });

  it("legacy paid/waived keep their meaning; fee changes keep confirmed money and surface credits", async () => {
    const legacy = await newReg({ paymentStatus: "paid" });
    const waived = await newReg({ paymentStatus: "waived" });
    const partial = await newReg();
    await one(partial, 6000);
    let l = await ledger(legacy);
    expect(l.ledger).toMatchObject({ legacyCreditCents: 8000, balanceCents: 0, status: "paid", legacyPending: true });
    expect(l.entries).toHaveLength(0); // no fabricated receipt on read
    expect((await ledger(waived)).ledger).toMatchObject({ status: "waived", balanceCents: 0, waivedCents: 8000 });

    // Fee rises to $100: the legacy credit is frozen at $80, not inflated.
    const up = await as(ORG).put(`/api/reunions/${R}/fees/${FEE}`).send({ label: "Registration", chargeType: "flat", amount: 100 });
    expect(up.status).toBe(200);
    l = await ledger(legacy);
    expect(l.ledger).toMatchObject({ legacyCreditCents: 8000, balanceCents: 2000, status: "partial", legacyPending: false });
    expect(l.entries[0]).toMatchObject({ kind: "legacy_credit", method: null, receivedDate: null });
    expect(l.entries[0].note).toMatch(/Opening credit/);
    expect((await ledger(waived)).ledger.status).toBe("waived");

    // Fee drops to $50: confirmed $60 exceeds charges -> explicit credit, no refund.
    await as(ORG).put(`/api/reunions/${R}/fees/${FEE}`).send({ label: "Registration", chargeType: "flat", amount: 50 });
    expect((await ledger(partial)).ledger).toMatchObject({ balanceCents: 0, creditCents: 1000, status: "paid" });
    await as(ORG).put(`/api/reunions/${R}/fees/${FEE}`).send({ label: "Registration", chargeType: "flat", amount: 80 });
  });

  it("the status setter cannot bypass the ledger", async () => {
    const id = await newReg();
    const patch = (paymentStatus: string) => as(ORG).patch(`/api/reunions/${R}/registrations/${id}/payment`).send({ paymentStatus });
    expect((await patch("paid")).status).toBe(400);
    await one(id, 1000);
    expect((await patch("pending")).status).toBe(409);
    expect((await patch("waived")).status).toBe(200);
    expect((await ledger(id)).ledger).toMatchObject({ status: "waived", waivedCents: 7000, confirmedCents: 1000 });
    expect((await one(id, 100)).status).toBe(409); // fees waived
    expect((await patch("pending")).status).toBe(200);
    expect((await ledger(id)).ledger).toMatchObject({ status: "partial", balanceCents: 7000 });
  });

  it("reconciles a multi-registration reported payment once, with explicit allocation", async () => {
    const a = await newReg();
    const b = await newReg();
    const c = await newReg();
    const sub = await as(MEMBER).post(`/api/registrations/${a}/payment-submissions`).send({ method: "check", amount: 120.5, registrationIds: [a, b] });
    expect(sub.status).toBe(201);
    expect(sub.body.amountCents).toBe(12050);
    expect((await ledger(a)).ledger).toMatchObject({ pendingReportedCents: 12050, balanceCents: 8000 });
    const sid = sub.body.id;
    expect((await pay({ submissionId: sid, amountCents: 1000, allocations: [{ registrationId: c, amountCents: 1000 }] })).status).toBe(400);
    const ok = await pay({ submissionId: sid, amountCents: 12050, allocations: [{ registrationId: a, amountCents: 8000 }, { registrationId: b, amountCents: 4050 }] });
    expect(ok.status).toBe(201);
    expect((await pay({ submissionId: sid, amountCents: 100, allocations: [{ registrationId: b, amountCents: 100 }] })).status).toBe(409);
    expect((await ledger(a)).ledger).toMatchObject({ status: "paid", pendingReportedCents: 0 });
    expect((await ledger(b)).ledger).toMatchObject({ status: "partial", balanceCents: 3950 });
    const list = await as(ORG).get(`/api/reunions/${R}/payment-submissions`);
    expect(list.body.submissions.find((s: { id: number }) => s.id === sid).confirmedReceiptId).toBe(ok.body.receiptId);
  });

  it("mixed reported payment: standalone chip-in is settled all-or-nothing, counted once, reversible", async () => {
    const a = await newReg();
    const [chip] = await db
      .insert(sponsorshipContributionsTable)
      .values({ reunionId: R, registrationId: null, contributorUserId: MEMBER, amount: 15, source: "direct", paymentStatus: "pending" })
      .returning();
    const sub = await as(MEMBER).post(`/api/registrations/${a}/payment-submissions`).send({ method: "check", amount: 95, registrationIds: [a], contributionIds: [chip.id] });
    expect(sub.status).toBe(201);
    const sid = sub.body.id;
    const list = await as(ORG).get(`/api/reunions/${R}/payment-submissions`);
    expect(list.body.submissions.find((s: { id: number }) => s.id === sid).contributions[0]).toMatchObject({ id: chip.id, standalone: true });
    const fund = async () => (await as(ORG).get(`/api/reunions/${R}/sponsorship`)).body.balance as number;
    const before = await fund();
    const both = (chipCents: number) =>
      pay({ submissionId: sid, amountCents: 8000 + chipCents, allocations: [{ registrationId: a, amountCents: 8000 }, { standaloneContributionId: chip.id, amountCents: chipCents }] });
    // Partial standalone chip-in is refused; nothing is written.
    expect((await both(1000)).status).toBe(400);
    // Standalone chip-in not in the submission / without a submission is refused.
    expect((await pay({ amountCents: 1500, allocations: [{ standaloneContributionId: chip.id, amountCents: 1500 }] })).status).toBe(400);
    const ok = await both(1500);
    expect(ok.status).toBe(201);
    let [c] = await db.select().from(sponsorshipContributionsTable).where(eq(sponsorshipContributionsTable.id, chip.id));
    expect(c.paymentStatus).toBe("paid");
    expect(await fund()).toBeCloseTo(before + 15, 2); // counted once
    expect((await ledger(a)).ledger).toMatchObject({ status: "paid", confirmedCents: 8000 });
    // The plain "mark paid/pending" route can't desync a receipt-settled chip-in.
    const patch = await as(ORG).patch(`/api/reunions/${R}/sponsorship/contributions/${chip.id}/payment`).send({ paymentStatus: "pending" });
    expect(patch.status).toBe(409);
    const rev = await as(ORG).post(`/api/reunions/${R}/receipts/${ok.body.receiptId}/reversal`).send({ reason: "entered wrong" });
    expect(rev.status).toBe(200);
    [c] = await db.select().from(sponsorshipContributionsTable).where(eq(sponsorshipContributionsTable.id, chip.id));
    expect(c.paymentStatus).toBe("pending");
    expect(await fund()).toBeCloseTo(before, 2);
    expect((await ledger(a)).ledger.status).toBe("unpaid");
  });

  it("rejects impossible calendar dates", async () => {
    const a = await newReg();
    expect((await one(a, 100, { receivedDate: "2026-02-30" })).status).toBe(400);
    expect((await one(a, 100, { receivedDate: "2026-13-01" })).status).toBe(400);
    const sub = await as(MEMBER).post(`/api/registrations/${a}/payment-submissions`).send({ method: "cash", amount: 5, givenDate: "2026-02-30", registrationIds: [a] });
    expect(sub.status).toBe(400);
    expect((await one(a, 100, { receivedDate: "2024-02-29" })).status).toBe(201);
  });

  it("fee changes sync status columns before the response", async () => {
    const legacy = await newReg({ paymentStatus: "paid" });
    const up = await as(ORG).put(`/api/reunions/${R}/fees/${FEE}`).send({ label: "Registration", chargeType: "flat", amount: 90 });
    expect(up.status).toBe(200);
    const [row] = await db.select().from(registrationsTable).where(eq(registrationsTable.id, legacy));
    expect(row.paymentStatus).toBe("pending"); // $10 now owed, synced synchronously
    await as(ORG).put(`/api/reunions/${R}/fees/${FEE}`).send({ label: "Registration", chargeType: "flat", amount: 80 });
    const [back] = await db.select().from(registrationsTable).where(eq(registrationsTable.id, legacy));
    expect(back.paymentStatus).toBe("paid");
  });

  it("attached chip-ins reach the fund only for confirmed cents; solvency is enforced", async () => {
    const id = await newReg();
    const [chip] = await db
      .insert(sponsorshipContributionsTable)
      .values({ reunionId: R, registrationId: id, contributorUserId: MEMBER, amount: 25, source: "registration", paymentStatus: "pending" })
      .returning();
    const fund = async () => (await as(ORG).get(`/api/reunions/${R}/sponsorship`)).body;
    const before = (await fund()).balance;
    const r = await pay({ amountCents: 9000, allocations: [{ registrationId: id, amountCents: 8000 }, { contributionId: chip.id, amountCents: 1000 }] });
    expect(r.status).toBe(201);
    expect((await fund()).balance).toBeCloseTo(before + 10, 2);
    const [c] = await db.select().from(sponsorshipContributionsTable).where(eq(sponsorshipContributionsTable.id, chip.id));
    expect(c.paymentStatus).toBe("pending"); // one installment is not the full pledge
    expect((await pay({ amountCents: 1600, allocations: [{ contributionId: chip.id, amountCents: 1600 }] })).status).toBe(409);
    const target = await newReg();
    const alloc = (amount: number) => as(ORG).post(`/api/reunions/${R}/sponsorship/allocations`).send({ registrationId: target, amount, fundedFrom: "fund" });
    expect((await alloc(Math.floor(before) + 11)).status).toBe(400);
    expect((await alloc(Math.floor(before) + 10)).status).toBe(201);
    const rev = await as(ORG).post(`/api/reunions/${R}/receipts/${r.body.receiptId}/reversal`).send({ reason: "bounced" });
    expect(rev.status).toBe(409);
    expect(rev.body.error).toMatch(/sponsorship fund/);
  });

  it("cancellation resolves actual confirmed money; payment transfer moves actual money", async () => {
    const id = await newReg();
    await one(id, 3050);
    const cancel = (body: Record<string, unknown>) => as(ORG).post(`/api/reunions/${R}/registrations/${id}/cancel`).send(body);
    const noRes = await cancel({});
    expect(noRes.status).toBe(400);
    expect(noRes.body.error).toMatch(/\$30\.50/);
    expect((await cancel({ resolution: "donated_to_fund" })).status).toBe(200);
    const [don] = await db.select().from(sponsorshipContributionsTable).where(eq(sponsorshipContributionsTable.registrationId, id));
    expect(don).toMatchObject({ source: "cancellation", amountCents: 3050, paymentStatus: "paid" });
    expect((await one(id, 100)).status).toBe(409); // cancelled

    const unpaid = await newReg();
    expect((await cancel.call(null, {})).status).toBe(400); // already cancelled
    expect((await as(ORG).post(`/api/reunions/${R}/registrations/${unpaid}/cancel`).send({})).status).toBe(200);

    const src = await newReg();
    const dst = await newReg();
    await one(src, 3000);
    const tr = await as(MEMBER).post(`/api/registrations/${src}/transfer`).send({ kind: "payment", targetRegistrationId: dst });
    expect(tr.status).toBe(200);
    expect((await ledger(src)).ledger).toMatchObject({ confirmedCents: 0, balanceCents: 8000 });
    expect((await ledger(dst)).ledger).toMatchObject({ confirmedCents: 3000, balanceCents: 5000, status: "partial" });
    expect((await as(MEMBER).post(`/api/registrations/${src}/transfer`).send({ kind: "payment", targetRegistrationId: dst })).status).toBe(400);
  });

  it("reversal cannot strand money that was transferred onward", async () => {
    const a = await newReg();
    const b = await newReg();
    const c = await newReg();
    const paid = await one(a, 8000);
    expect(paid.status).toBe(201);
    const transferId = async (to: number) => {
      const r = await db.execute(sql`SELECT r.id FROM payment_receipts r JOIN payment_receipt_allocations x ON x.receipt_id = r.id
        WHERE r.kind = 'transfer' AND x.registration_id = ${to} AND x.amount_cents > 0 ORDER BY r.id DESC LIMIT 1`);
      return (r as unknown as { rows: { id: number }[] }).rows[0].id;
    };
    const reverse = (id: number) => as(ORG).post(`/api/reunions/${R}/receipts/${id}/reversal`).send({ reason: "unwind test" });
    expect((await as(MEMBER).post(`/api/registrations/${a}/transfer`).send({ kind: "payment", targetRegistrationId: b })).status).toBe(200);
    const t1 = await transferId(b);

    // Original receipt: A's $80 already went to B.
    let r = await reverse(paid.body.receiptId);
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/transfer/i);
    expect((await ledger(a)).ledger.confirmedCents).toBe(0);
    expect((await ledger(b)).ledger.confirmedCents).toBe(8000);

    // B moves it on to C; reversing A->B would leave B at -$80.
    expect((await as(MEMBER).post(`/api/registrations/${b}/transfer`).send({ kind: "payment", targetRegistrationId: c })).status).toBe(200);
    const t2 = await transferId(c);
    r = await reverse(t1);
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(new RegExp(`#${b}`));
    expect((await ledger(b)).ledger.confirmedCents).toBe(0);

    // Unwind in order: B->C, then A->B, then the original receipt.
    expect((await reverse(t2)).status).toBe(200);
    expect((await reverse(t1)).status).toBe(200);
    expect((await reverse(paid.body.receiptId)).status).toBe(200);
    for (const id of [a, b, c]) expect((await ledger(id)).ledger).toMatchObject({ confirmedCents: 0, status: "unpaid" });
  });

  it("waived attached chip-ins owe nothing and never count as received fund money", async () => {
    const fund = async () => (await as(ORG).get(`/api/reunions/${R}/sponsorship`)).body.balance as number;
    const before = await fund();
    const legacy = await newReg({ paymentStatus: "paid" });
    const open = await newReg();
    const mk = async (registrationId: number) =>
      (await db.insert(sponsorshipContributionsTable).values({ reunionId: R, registrationId, contributorUserId: MEMBER, amount: 25, source: "registration", paymentStatus: "waived" }).returning())[0];
    const c1 = await mk(legacy);
    const c2 = await mk(open);
    expect((await ledger(legacy)).ledger.contributions[0]).toMatchObject({ id: c1.id, outstandingCents: 0, confirmedCents: 0 });
    expect((await ledger(open)).ledger.contributions[0]).toMatchObject({ id: c2.id, outstandingCents: 0, confirmedCents: 0 });
    expect(await fund()).toBeCloseTo(before, 2);
    // Receipt allocation to a waived chip-in is refused; fee money still records.
    expect((await pay({ amountCents: 500, allocations: [{ contributionId: c2.id, amountCents: 500 }] })).status).toBe(409);
    expect((await one(open, 1000)).status).toBe(201);
    // Initialization (via fee change) + sync keep it waived and mint no chip-in credit.
    await as(ORG).put(`/api/reunions/${R}/fees/${FEE}`).send({ label: "Registration", chargeType: "flat", amount: 80 });
    const l = await ledger(legacy);
    expect(l.ledger).toMatchObject({ legacyPending: false, legacyCreditCents: 8000 });
    expect(l.ledger.contributions[0]).toMatchObject({ outstandingCents: 0, confirmedCents: 0 });
    const allocs = await db.execute(sql`SELECT count(*)::int AS n FROM payment_receipt_allocations WHERE contribution_id IN (${c1.id}, ${c2.id})`);
    expect((allocs as unknown as { rows: { n: number }[] }).rows[0].n).toBe(0);
    for (const c of [c1, c2]) {
      const [row] = await db.select().from(sponsorshipContributionsTable).where(eq(sponsorshipContributionsTable.id, c.id));
      expect(row.paymentStatus).toBe("waived");
    }
    expect(await fund()).toBeCloseTo(before, 2);
  });

  it("sponsoring a legacy paid registration freezes the actual $80 first; credit $20; cancel and transfer use $80", async () => {
    const sponsor = (registrationId: number) =>
      as(ORG).post(`/api/reunions/${R}/sponsorship/allocations`).send({ registrationId, amount: 20, fundedFrom: "direct", sponsorName: "Uncle Ray" });
    const a = await newReg({ paymentStatus: "paid" });
    expect((await sponsor(a)).status).toBe(201);
    let l = await ledger(a);
    expect(l.ledger).toMatchObject({ legacyPending: false, legacyCreditCents: 8000, sponsoredCents: 2000, creditCents: 2000, balanceCents: 0, status: "paid" });
    expect(l.entries[0]).toMatchObject({ kind: "legacy_credit", registrationCents: 8000 });
    const [row] = await db.select().from(registrationsTable).where(eq(registrationsTable.id, a));
    expect(row.paymentStatus).toBe("paid");
    // Transfer moves the actual $80 (target owes $80).
    const dst = await newReg();
    const tr = await as(MEMBER).post(`/api/registrations/${a}/transfer`).send({ kind: "payment", targetRegistrationId: dst });
    expect(tr.status).toBe(200);
    expect((await ledger(dst)).ledger).toMatchObject({ confirmedCents: 8000, status: "paid" });

    // Cancel resolves the actual $80, not $80 - $20.
    const b = await newReg({ paymentStatus: "paid" });
    expect((await sponsor(b)).status).toBe(201);
    const noRes = await as(ORG).post(`/api/reunions/${R}/registrations/${b}/cancel`).send({});
    expect(noRes.status).toBe(400);
    expect(noRes.body.error).toMatch(/\$80\.00/);
    expect((await as(ORG).post(`/api/reunions/${R}/registrations/${b}/cancel`).send({ resolution: "donated_to_fund" })).status).toBe(200);
    const [don] = await db.select().from(sponsorshipContributionsTable).where(and(eq(sponsorshipContributionsTable.registrationId, b), eq(sponsorshipContributionsTable.source, "cancellation")));
    expect(don.amountCents).toBe(8000);
  });

  for (const side of ["source", "target"] as const) {
    it(`payment transfer re-checks ${side} cancellation inside the locked transaction (409, no money moved)`, async () => {
      const src = await newReg();
      const dst = await newReg();
      await one(src, 3000);
      const victim = side === "source" ? src : dst;
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      let locked!: () => void;
      const lockedP = new Promise<void>((r) => (locked = r));
      // A concurrent cancellation holds the reunion lock; the transfer's
      // preflight (outside the lock) still sees both registrations active.
      const cancelTx = db.transaction(async (tx) => {
        await tx.execute(sql`SELECT id FROM reunions WHERE id = ${R} FOR UPDATE`);
        await tx.update(registrationsTable).set({ status: "cancelled", cancelledAt: new Date(), cancellationResolution: "refunded" }).where(eq(registrationsTable.id, victim));
        locked();
        await gate;
      });
      await lockedP;
      const pending = as(MEMBER).post(`/api/registrations/${src}/transfer`).send({ kind: "payment", targetRegistrationId: dst }).then((r) => r);
      await new Promise((r) => setTimeout(r, 300));
      release();
      await cancelTx;
      const res = await pending;
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/cancelled/);
      const n = await db.execute(sql`SELECT count(*)::int AS n FROM payment_receipt_allocations a JOIN payment_receipts r ON r.id = a.receipt_id WHERE r.kind = 'transfer' AND a.registration_id IN (${src}, ${dst})`);
      expect((n as unknown as { rows: { n: number }[] }).rows[0].n).toBe(0);
      expect((await ledger(src)).ledger.confirmedCents).toBe(3000);
    });
  }

  it("same key with a different payment is refused; same key + same payload returns the original receipt", async () => {
    const a = await newReg();
    const k = key();
    const body = { amountCents: 3000, idempotencyKey: k, allocations: [{ registrationId: a, amountCents: 3000 }] };
    const first = await pay(body);
    expect(first.status).toBe(201);
    const retry = await pay(body); // response lost, client retries identical request
    expect(retry.status).toBe(200);
    expect(retry.body).toMatchObject({ receiptId: first.body.receiptId, duplicate: true });
    expect((await pay({ ...body, method: "check" })).status).toBe(409);
    expect((await ledger(a)).ledger.confirmedCents).toBe(3000);
  });

  it("simple partial: $120 charge, record $20, $100 remains", async () => {
    const [opt] = await db.insert(reunionFeesTable).values({ reunionId: R, label: "T-shirt + banquet", chargeType: "flat", amount: 40, isOptional: true }).returning();
    const a = await newReg();
    await db.execute(sql`INSERT INTO registration_fees (registration_id, fee_id) VALUES (${a}, ${opt.id})`);
    expect((await ledger(a)).ledger).toMatchObject({ chargeCents: 12000, balanceCents: 12000 });
    expect((await one(a, 2000)).status).toBe(201);
    expect((await ledger(a)).ledger).toMatchObject({ confirmedCents: 2000, balanceCents: 10000, status: "partial" });
    await db.execute(sql`DELETE FROM registration_fees WHERE fee_id = ${opt.id}`);
    await db.delete(reunionFeesTable).where(eq(reunionFeesTable.id, opt.id));
  });

  it("concurrent identical requests under one key: exactly one receipt, both succeed", async () => {
    const a = await newReg();
    const body = { method: "cash", receivedDate: "2026-06-01", idempotencyKey: key(), amountCents: 2000, allocations: [{ registrationId: a, amountCents: 2000 }] };
    const send = () => as(ORG).post(`/api/reunions/${R}/receipts`).send(body).then((r) => r);
    const results = await Promise.all([send(), send(), send()]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 200, 201]);
    expect(new Set(results.map((r) => r.body.receiptId)).size).toBe(1);
    const n = await db.execute(sql`SELECT count(*)::int AS n FROM payment_receipts WHERE idempotency_key = ${body.idempotencyKey}`);
    expect((n as unknown as { rows: { n: number }[] }).rows[0].n).toBe(1);
    expect((await ledger(a)).ledger.confirmedCents).toBe(2000);
    const changed = await as(ORG).post(`/api/reunions/${R}/receipts`).send({ ...body, amountCents: 1500, allocations: [{ registrationId: a, amountCents: 1500 }] });
    expect(changed.status).toBe(409);
    expect(changed.body.code).toBe("already_recorded");
  });

  it("fund pending counts only the unpaid part of attached chip-ins; standalone stays all-or-nothing", async () => {
    const pendingNow = async () => (await as(ORG).get(`/api/reunions/${R}/sponsorship`)).body.totalPending as number;
    const base = await pendingNow();
    const a = await newReg();
    const [c] = await db.insert(sponsorshipContributionsTable).values({ reunionId: R, registrationId: a, contributorUserId: MEMBER, amount: 25, source: "registration", paymentStatus: "pending" }).returning();
    expect(await pendingNow()).toBeCloseTo(base + 25, 2);
    expect((await pay({ amountCents: 1000, allocations: [{ contributionId: c.id, amountCents: 1000 }] })).status).toBe(201);
    expect(await pendingNow()).toBeCloseTo(base + 15, 2);
    const [sa] = await db.insert(sponsorshipContributionsTable).values({ reunionId: R, contributorUserId: MEMBER, amount: 12, source: "direct", paymentStatus: "pending" }).returning();
    expect(await pendingNow()).toBeCloseTo(base + 27, 2);
    await db.update(sponsorshipContributionsTable).set({ paymentStatus: "waived" }).where(eq(sponsorshipContributionsTable.id, c.id));
    expect(await pendingNow()).toBeCloseTo(base + 12, 2);
    await db.delete(sponsorshipContributionsTable).where(eq(sponsorshipContributionsTable.id, sa.id));
  });

  it("reports, export and receipt CSV agree on ledger totals", async () => {
    const rep = await as(ORG).get(`/api/reunions/${R}/reports`);
    expect(rep.status).toBe(200);
    expect(rep.body.finance).toBeTruthy();
    expect(rep.body.partialCount).toBeGreaterThan(0);
    const exp = await as(ORG).get(`/api/reunions/${R}/registrations/export`);
    expect(exp.text.split("\n")[0]).toMatch(/Balance Due/);
    const csv = await as(ORG).get(`/api/reunions/${R}/receipts/export`);
    expect(csv.status).toBe(200);
    expect(csv.text).toMatch(/legacy opening credit/);
    expect((await as(NOROLE).get(`/api/reunions/${R}/receipts/export`)).status).toBe(403);
  });
});
