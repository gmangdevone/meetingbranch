import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { inArray } from "drizzle-orm";

const authState = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: authState.userId, sessionClaims: authState.userId ? { userId: authState.userId } : null }),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  clerkClient: { users: { getUser: async () => ({ emailAddresses: [] }) } },
}));

const { db, pool, usersTable, reunionsTable, reunionOrganizersTable, registrationsTable } = await import("@workspace/db");
const { default: membershipsRouter } = await import("./memberships");

const hasDb = !!process.env.DATABASE_URL;
const RUN = `mem_${Date.now()}`;
const OWNER = `${RUN}_owner`, MEMBER = `${RUN}_member`, ADMIN = `${RUN}_admin`, NOBODY = `${RUN}_none`;
const users = [OWNER, MEMBER, ADMIN, NOBODY];
const app = express();
app.use(express.json());
app.use("/api", membershipsRouter);
const ids: number[] = [];

async function cleanup() {
  const rs = await db.select({ id: reunionsTable.id }).from(reunionsTable).where(inArray(reunionsTable.organizerId, users));
  if (rs.length) await db.delete(reunionsTable).where(inArray(reunionsTable.id, rs.map((r) => r.id)));
  await db.delete(usersTable).where(inArray(usersTable.id, users));
}

describe.skipIf(!hasDb)("GET /api/me/event-memberships (real DB)", () => {
  beforeAll(async () => {
    await cleanup();
    await db.insert(usersTable).values(users.map((id) => ({ id, email: `${id}@test.local`, isAdmin: id === ADMIN })));
    const mk = async (n: number) => {
      const [r] = await db.insert(reunionsTable).values({ code: `M${RUN.slice(-5)}${n}*`, name: `Mem ${RUN} ${n}`, startDate: `2026-0${n}-01`, endDate: `2026-0${n}-02`, paymentHandle: "@test", organizerId: OWNER }).returning();
      ids.push(r.id);
      return r.id;
    };
    const [a, b, c] = [await mk(1), await mk(2), await mk(3)];
    // MEMBER: two active registrations in A, co-organizer of B, cancelled-only in C.
    await db.insert(registrationsTable).values([
      { reunionId: a, userId: MEMBER, branchName: "X", attendeeCount: 1 },
      { reunionId: a, userId: MEMBER, branchName: "Y", attendeeCount: 1 },
      { reunionId: c, userId: MEMBER, branchName: "Z", attendeeCount: 1, status: "cancelled" },
    ]);
    await db.insert(reunionOrganizersTable).values({ reunionId: b, userId: MEMBER, roles: [] });
  });
  afterAll(async () => { await cleanup(); await pool.end(); });

  it("requires sign-in", async () => {
    authState.userId = null;
    expect((await request(app).get("/api/me/event-memberships")).status).toBe(401);
  });
  it("dedupes multi-registration events and skips cancelled-only events", async () => {
    authState.userId = MEMBER;
    const res = await request(app).get("/api/me/event-memberships");
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toContain("no-store");
    expect(res.body.map((m: any) => m.reunionId)).toEqual([ids[0], ids[1]]);
    expect(res.body[0]).toMatchObject({ activeRegistrationCount: 2, isCoOrganizer: false });
    expect(res.body[1]).toMatchObject({ activeRegistrationCount: 0, isCoOrganizer: true });
  });
  it("lists every owned event for the organizer", async () => {
    authState.userId = OWNER;
    const res = await request(app).get("/api/me/event-memberships");
    expect(res.body.map((m: any) => m.reunionId)).toEqual(ids);
    expect(res.body.every((m: any) => m.isOrganizer)).toBe(true);
  });
  it("does not treat admin visibility or no association as membership", async () => {
    for (const u of [ADMIN, NOBODY]) {
      authState.userId = u;
      expect((await request(app).get("/api/me/event-memberships")).body).toEqual([]);
    }
  });
});
