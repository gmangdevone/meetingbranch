import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { eq, inArray, sql } from "drizzle-orm";
const auth = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: auth.userId, sessionClaims: auth.userId ? { userId: auth.userId } : null }),
  clerkMiddleware: () => (_a: unknown, _b: unknown, next: () => void) => next(),
}));
vi.mock("../lib/paymentConfirmation", () => ({ emailRecordedPayment: vi.fn() }));
const { db, usersTable, reunionsTable, registrationsTable, reunionFeesTable, sponsorshipContributionsTable, checklistProgressTable } = await import("@workspace/db");
const { default: router } = await import("./index");
const app = express(); app.use(express.json()); app.use("/api", router);
const suffix = `${Date.now()}`;
const owner = `checkOwner${suffix}`, member = `checkMember${suffix}`, other = `checkOther${suffix}`;
let reunionId = 0, secondId = 0, manualId = 0, regId = 0, receiptId = 0;
const item = (title: string, kind = "manual") => ({ title, kind, visible: true, sortOrder: 0 });
const configUrl = () => `/api/reunions/${reunionId}/checklist/config`;
const mineUrl = () => `/api/reunions/${reunionId}/checklist/mine`;
const as = (user: string | null) => { auth.userId = user; return request(app); };
const save = (items: object[], enabled = true) => as(owner).put(configUrl()).send({ enabled, items });
const complete = (id: number, completed: boolean, user = member) => as(user)
  .put(`/api/reunions/${reunionId}/checklist/items/${id}/completion`).send({ completed });

describe.skipIf(!process.env.DATABASE_URL)("event member checklists", () => {
  beforeAll(async () => {
    await db.insert(usersTable).values([owner, member, other].map(id => ({ id, email: `${id}@example.test`, firstName: "Checklist" })));
    const events = await db.insert(reunionsTable).values([0, 1].map(i => ({
      name: "Checklist Test", code: `CK${suffix}${i}*`, organizerId: owner, startDate: "2026-11-01", endDate: "2026-11-02", paymentHandle: "", paymentUrl: "",
    }))).returning();
    reunionId = events[0].id; secondId = events[1].id;
  });
  afterAll(async () => {
    await db.execute(sql`DELETE FROM payment_receipts WHERE reunion_id = ${reunionId}`);
    await db.delete(reunionsTable).where(inArray(reunionsTable.id, [reunionId, secondId]));
    await db.delete(usersTable).where(inArray(usersTable.id, [owner, member, other]));
  });
  it("requires sign-in and restricts configuration to authorized managers", async () => {
    expect((await as(null).get(mineUrl())).status).toBe(401);
    expect((await as(member).get(configUrl())).status).toBe(403);
    expect((await as(member).put(configUrl()).send({ enabled: true, items: [] })).status).toBe(403);
    expect((await as(member).get(mineUrl())).body).toMatchObject({ enabled: false, items: [] });
  });
  it("creates ordered manual and automatic items, rejecting unsafe or invalid input", async () => {
    const result = await save([item("Register attendees", "registration"), item("Complete payments", "payment"), item("Book hotel")]);
    expect(result.status).toBe(200);
    manualId = result.body.items[2].id;
    expect((await save([{ ...item("Bad link"), link: "javascript:alert(1)" }])).status).toBe(400);
    expect((await save([item(" ")])).status).toBe(400);
    expect((await save([item("x".repeat(161))])).status).toBe(400);
    const mine = await as(member).get(mineUrl());
    expect(mine.body).toMatchObject({ enabled: true, totalCount: 3, completedCount: 0 });
    expect(mine.body.items[1]).toMatchObject({ completed: false });
  });
  it("persists only the signed-in member's manual checks, allows unchecking and protects automatic items", async () => {
    expect((await complete(manualId, true)).status).toBe(200);
    expect((await as(member).get(mineUrl())).body.completedCount).toBe(1);
    expect((await as(other).get(mineUrl())).body.completedCount).toBe(0);
    const config = (await as(owner).get(configUrl())).body;
    expect((await complete(config.items[1].id, true)).status).toBe(403);
    expect((await as(member).put(`/api/reunions/${secondId}/checklist/items/${manualId}/completion`).send({ completed: true })).status).toBe(404);
    expect((await complete(manualId, false)).status).toBe(200);
    expect((await as(member).get(mineUrl())).body.completedCount).toBe(0);
    await complete(manualId, true);
  });
  it("preserves progress on editing/reordering/hiding, and cleans it up on deletion", async () => {
    let config = (await as(owner).get(configUrl())).body;
    config.items[2].title = "Book your room"; config.items.reverse();
    expect((await save(config.items)).status).toBe(200);
    expect((await as(member).get(mineUrl())).body.items[0]).toMatchObject({ title: "Book your room", completed: true });
    config = (await as(owner).get(configUrl())).body;
    expect((await save(config.items.map((i: any) => i.id === manualId ? { ...i, kind: "payment" } : i))).status).toBe(409);
    await save(config.items.map((i: any) => i.id === manualId ? { ...i, visible: false } : i));
    expect((await as(member).get(mineUrl())).body.totalCount).toBe(2);
    expect((await complete(manualId, false)).status).toBe(404);
    await save(config.items);
    expect((await as(member).get(mineUrl())).body.completedCount).toBe(1);
    await save(config.items.filter((i: any) => i.id !== manualId));
    expect(await db.select().from(checklistProgressTable).where(eq(checklistProgressTable.itemId, manualId))).toHaveLength(0);
  });
  it("only completes payment after full confirmation and reopens it on reversal", async () => {
    const [reg] = await db.insert(registrationsTable).values({ reunionId, userId: member, branchName: "Family", attendeeCount: 1 }).returning();
    regId = reg.id;
    await db.insert(reunionFeesTable).values({ reunionId, label: "Registration", amount: 80, chargeType: "flat" });
    let mine = (await as(member).get(mineUrl())).body;
    expect(mine.items.find((i: any) => i.kind === "registration").completed).toBe(true);
    expect(mine.items.find((i: any) => i.kind === "payment")).toMatchObject({ completed: false, statusText: "Payment needed — $80.00 remaining" });
    const receipt = (cents: number) => as(owner).post(`/api/reunions/${reunionId}/receipts`).send({
      amountCents: cents, method: "cash", receivedDate: "2026-10-18",
      idempotencyKey: crypto.randomUUID(), allocations: [{ registrationId: regId, amountCents: cents }],
    });
    expect((await receipt(3000)).status).toBe(201);
    expect((await as(member).get(mineUrl())).body.items.find((i: any) => i.kind === "payment").completed).toBe(false);
    const final = await receipt(5000);
    expect(final.status).toBe(201); receiptId = final.body.receiptId;
    expect((await as(member).get(mineUrl())).body.items.find((i: any) => i.kind === "payment")).toMatchObject({ completed: true, statusText: "Paid in full" });
    expect((await as(owner).post(`/api/reunions/${reunionId}/receipts/${receiptId}/reversal`).send({ reason: "Test correction" })).status).toBe(200);
    expect((await as(member).get(mineUrl())).body.items.find((i: any) => i.kind === "payment").completed).toBe(false);
  });
  it("includes outstanding standalone chip-ins even when registration fees are paid", async () => {
    await db.update(registrationsTable).set({ paymentStatus: "waived" }).where(eq(registrationsTable.id, regId));
    const [contribution] = await db.insert(sponsorshipContributionsTable).values({
      reunionId, contributorUserId: member, amount: 10, source: "direct", paymentStatus: "pending",
    }).returning();
    let payment = (await as(member).get(mineUrl())).body.items.find((i: any) => i.kind === "payment");
    expect(payment).toMatchObject({ completed: false, statusText: "Payment needed — $10.00 remaining" });
    await db.update(sponsorshipContributionsTable).set({ paymentStatus: "paid" }).where(eq(sponsorshipContributionsTable.id, contribution.id));
    payment = (await as(member).get(mineUrl())).body.items.find((i: any) => i.kind === "payment");
    expect(payment.completed).toBe(true);
    const config = (await as(owner).get(configUrl())).body;
    await save(config.items, false);
    expect((await as(member).get(mineUrl())).body).toMatchObject({ enabled: false, items: [] });
  });
});
