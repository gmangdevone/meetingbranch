import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { inArray } from "drizzle-orm";
const auth = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: auth.userId, sessionClaims: auth.userId ? { userId: auth.userId } : null }),
  clerkMiddleware: () => (_a: unknown, _b: unknown, next: () => void) => next(),
}));
vi.mock("../lib/paymentConfirmation", () => ({ emailRecordedPayment: vi.fn() }));
const { db, usersTable, reunionsTable, announcementsTable } = await import("@workspace/db");
const { default: router } = await import("./index");
const app = express(); app.use(express.json()); app.use("/api", router);
const suffix = `${Date.now()}`;
const owner = `orderOwner${suffix}`, member = `orderMember${suffix}`;
let events: number[] = [], ids: number[] = [], foreignId = 0;
const base = () => `/api/reunions/${events[0]}/announcements`;
const reorder = (order: number[], user: string | null = owner) => {
  auth.userId = user; return request(app).put(`${base()}/order`).send({ ids: order });
};
describe.skipIf(!process.env.DATABASE_URL)("announcement ordering", () => {
  beforeAll(async () => {
    await db.insert(usersTable).values([owner, member].map(id => ({ id, email: `${id}@example.test` })));
    events = (await db.insert(reunionsTable).values([0, 1].map(i => ({
      name: "Order test", code: `AO${suffix}${i}*`, organizerId: owner,
      startDate: "2026-11-01", endDate: "2026-11-02", paymentHandle: "", paymentUrl: "",
    }))).returning()).map(row => row.id);
    ids = (await db.insert(announcementsTable).values([0, 1, 2].map(i => ({
      reunionId: events[0], title: `Post ${i}`, body: `Body ${i}`, pinned: i === 0,
    }))).returning()).map(row => row.id);
    [foreignId] = (await db.insert(announcementsTable).values({
      reunionId: events[1], title: "Other", body: "Other",
    }).returning()).map(row => row.id);
  });
  afterAll(async () => {
    await db.delete(reunionsTable).where(inArray(reunionsTable.id, events));
    await db.delete(usersTable).where(inArray(usersTable.id, [owner, member]));
  });
  it("requires authorization and rejects invalid, foreign, stale and mixed-group orders", async () => {
    expect((await reorder(ids, null)).status).toBe(401);
    expect((await reorder(ids, member)).status).toBe(403);
    expect((await reorder([ids[0], ids[0], ids[2]])).status).toBe(400);
    expect((await reorder([ids[0], ids[1], foreignId])).status).toBe(409);
    expect((await reorder([ids[0]])).status).toBe(409);
    expect((await reorder([ids[1], ids[0], ids[2]])).status).toBe(409);
  });
  it("persists the order in public reads and retains it through content edits", async () => {
    const order = [ids[0], ids[1], ids[2]];
    expect((await reorder(order)).status).toBe(200);
    expect((await request(app).get(base())).body.map((row: any) => row.id)).toEqual(order);
    auth.userId = owner;
    expect((await request(app).put(`${base()}/${ids[1]}`).send({ title: "Edited", body: "Body", pinned: false })).status).toBe(200);
    expect((await request(app).get(base())).body.map((row: any) => row.id)).toEqual(order);
    const moved = [ids[0], ids[2], ids[1]];
    expect((await reorder(moved)).status).toBe(200);
    expect((await request(app).get(base())).body.map((row: any) => row.id)).toEqual(moved);
  });
  it("places new posts first in their group and keeps existing posts ordered after deletion", async () => {
    auth.userId = owner;
    const created = await request(app).post(base()).send({ title: "New", body: "New" });
    expect(created.status).toBe(201);
    expect((await request(app).get(base())).body.map((row: any) => row.id)).toEqual([ids[0], created.body.id, ids[2], ids[1]]);
    expect((await request(app).delete(`${base()}/${created.body.id}`)).status).toBe(204);
    expect((await request(app).get(base())).body.map((row: any) => row.id)).toEqual([ids[0], ids[2], ids[1]]);
  });
});
