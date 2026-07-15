import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";

// ──────────────────────────────────────────────────────────────────────────────
// Integration test: exercises POST /api/admin/users/:id/remove against the REAL
// dev Postgres schema (no db mock — only Clerk auth is mocked). This validates
// the FK/cascade assumptions the route relies on:
//   - attendees has NO FK cascade from registrations (explicit delete required)
//   - registration_fees cascades on registration delete
//   - sponsorship_contributions.registration_id is set-null on registration
//     delete, and contributor_user_id is nulled by the route
// All seeded rows use unique test ids and are cleaned up afterwards.
// ──────────────────────────────────────────────────────────────────────────────

const authState = vi.hoisted(() => ({
  userId: null as string | null,
}));

vi.mock("@clerk/express", () => ({
  getAuth: () => ({
    userId: authState.userId,
    sessionClaims: authState.userId ? { userId: authState.userId } : null,
  }),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  clerkClient: { users: { getUser: async () => ({ emailAddresses: [] }) } },
}));

const {
  db,
  pool,
  usersTable,
  reunionsTable,
  reunionOrganizersTable,
  reunionFeesTable,
  registrationsTable,
  attendeesTable,
  registrationFeesTable,
  sponsorshipContributionsTable,
} = await import("@workspace/db");
const { default: adminRouter } = await import("./admin");

const hasDb = !!process.env.DATABASE_URL;

const RUN = `it_${Date.now()}`;
const ADMIN = `${RUN}_admin`;
const TARGET = `${RUN}_target`;

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api", adminRouter);
  return app;
}

async function cleanup() {
  // Order matters: children first, then reunions, then users.
  const users = [ADMIN, TARGET];
  const reunions = await db
    .select({ id: reunionsTable.id })
    .from(reunionsTable)
    .where(inArray(reunionsTable.organizerId, users));
  const reunionIds = reunions.map((r) => r.id);
  if (reunionIds.length > 0) {
    const regs = await db
      .select({ id: registrationsTable.id })
      .from(registrationsTable)
      .where(inArray(registrationsTable.reunionId, reunionIds));
    const regIds = regs.map((r) => r.id);
    if (regIds.length > 0) {
      await db
        .delete(attendeesTable)
        .where(inArray(attendeesTable.registrationId, regIds));
    }
    // registrations / fees / organizers / sponsorships cascade from reunions
    await db.delete(reunionsTable).where(inArray(reunionsTable.id, reunionIds));
  }
  await db
    .delete(sponsorshipContributionsTable)
    .where(inArray(sponsorshipContributionsTable.contributorUserId, users));
  await db
    .delete(reunionOrganizersTable)
    .where(inArray(reunionOrganizersTable.userId, users));
  await db.delete(usersTable).where(inArray(usersTable.id, users));
}

/**
 * Seeds: admin user (owns the reunion), target user who is a co-organizer with
 * one registration (2 attendees, 1 optional fee selection) and one sponsorship
 * contribution. Returns ids for assertions.
 */
async function seed() {
  await db.insert(usersTable).values([
    { id: ADMIN, email: `${ADMIN}@test.local`, isAdmin: true },
    { id: TARGET, email: `${TARGET}@test.local`, isAdmin: false },
  ]);
  const [reunion] = await db
    .insert(reunionsTable)
    .values({
      code: RUN.slice(-7).toUpperCase(),
      name: `Integration Test Reunion ${RUN}`,
      startDate: "2026-08-01",
      endDate: "2026-08-03",
      paymentHandle: "@test",
      organizerId: ADMIN,
    })
    .returning();
  const [fee] = await db
    .insert(reunionFeesTable)
    .values({
      reunionId: reunion.id,
      label: "T-shirt",
      chargeType: "per_person",
      isOptional: true,
      amount: 15,
    })
    .returning();
  await db
    .insert(reunionOrganizersTable)
    .values({ reunionId: reunion.id, userId: TARGET, roles: [] });
  const [reg] = await db
    .insert(registrationsTable)
    .values({
      reunionId: reunion.id,
      userId: TARGET,
      branchName: "Test Branch",
      attendeeCount: 2,
    })
    .returning();
  await db.insert(attendeesTable).values([
    { registrationId: reg.id, name: "Attendee One", shirtSize: "M" },
    { registrationId: reg.id, name: "Attendee Two", shirtSize: "L" },
  ]);
  await db
    .insert(registrationFeesTable)
    .values({ registrationId: reg.id, feeId: fee.id });
  const [contrib] = await db
    .insert(sponsorshipContributionsTable)
    .values({
      reunionId: reunion.id,
      registrationId: reg.id,
      contributorUserId: TARGET,
      contributorName: "Target Person",
      amount: 50,
      source: "registration",
    })
    .returning();
  return { reunionId: reunion.id, regId: reg.id, feeId: fee.id, contribId: contrib.id };
}

describe.skipIf(!hasDb)(
  "POST /api/admin/users/:id/remove (real database)",
  () => {
    beforeEach(async () => {
      await cleanup();
      authState.userId = ADMIN;
    });

    afterAll(async () => {
      await cleanup();
      await pool.end();
    });

    it("blocks removal with 409 while the user still owns a reunion", async () => {
      await seed();
      // Make TARGET own a reunion of their own.
      await db.insert(reunionsTable).values({
        code: "ZZ99999",
        name: `Owned by target ${RUN}`,
        startDate: "2026-09-01",
        endDate: "2026-09-02",
        paymentHandle: "@t",
        organizerId: TARGET,
      });

      const res = await request(buildApp())
        .post(`/api/admin/users/${TARGET}/remove`)
        .send({ deleteRegistrations: false });

      expect(res.status).toBe(409);
      const [stillThere] = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.id, TARGET));
      expect(stillThere).toBeTruthy();
      // Co-organizer role untouched on a refused removal.
      const roles = await db
        .select()
        .from(reunionOrganizersTable)
        .where(eq(reunionOrganizersTable.userId, TARGET));
      expect(roles).toHaveLength(1);
    });

    it("keep-registrations: removes the account but preserves registration data", async () => {
      const ids = await seed();

      const res = await request(buildApp())
        .post(`/api/admin/users/${TARGET}/remove`)
        .send({ deleteRegistrations: false });

      expect(res.status).toBe(204);
      expect(
        await db.select().from(usersTable).where(eq(usersTable.id, TARGET)),
      ).toHaveLength(0);
      // Registration, attendees, and fee selections remain.
      expect(
        await db
          .select()
          .from(registrationsTable)
          .where(eq(registrationsTable.id, ids.regId)),
      ).toHaveLength(1);
      expect(
        await db
          .select()
          .from(attendeesTable)
          .where(eq(attendeesTable.registrationId, ids.regId)),
      ).toHaveLength(2);
      expect(
        await db
          .select()
          .from(registrationFeesTable)
          .where(eq(registrationFeesTable.registrationId, ids.regId)),
      ).toHaveLength(1);
      // Co-organizer role revoked (FK to users would otherwise block delete).
      expect(
        await db
          .select()
          .from(reunionOrganizersTable)
          .where(eq(reunionOrganizersTable.userId, TARGET)),
      ).toHaveLength(0);
      // Sponsorship contribution survives with the account link dropped.
      const [contrib] = await db
        .select()
        .from(sponsorshipContributionsTable)
        .where(eq(sponsorshipContributionsTable.id, ids.contribId));
      expect(contrib.contributorUserId).toBeNull();
      expect(contrib.amount).toBe(50);
      expect(contrib.contributorName).toBe("Target Person");
      expect(contrib.registrationId).toBe(ids.regId);
    });

    it("delete-registrations: removes the account with no orphaned rows", async () => {
      const ids = await seed();

      const res = await request(buildApp())
        .post(`/api/admin/users/${TARGET}/remove`)
        .send({ deleteRegistrations: true });

      expect(res.status).toBe(204);
      expect(
        await db.select().from(usersTable).where(eq(usersTable.id, TARGET)),
      ).toHaveLength(0);
      expect(
        await db
          .select()
          .from(registrationsTable)
          .where(eq(registrationsTable.id, ids.regId)),
      ).toHaveLength(0);
      // No orphaned attendees (no FK cascade — route must delete explicitly).
      expect(
        await db
          .select()
          .from(attendeesTable)
          .where(eq(attendeesTable.registrationId, ids.regId)),
      ).toHaveLength(0);
      // No orphaned registration_fees (FK cascade from registrations).
      expect(
        await db
          .select()
          .from(registrationFeesTable)
          .where(eq(registrationFeesTable.registrationId, ids.regId)),
      ).toHaveLength(0);
      // Sponsorship amount survives for fund accounting; both links dropped
      // (contributor nulled by the route, registration set-null by the FK).
      const [contrib] = await db
        .select()
        .from(sponsorshipContributionsTable)
        .where(eq(sponsorshipContributionsTable.id, ids.contribId));
      expect(contrib).toBeTruthy();
      expect(contrib.amount).toBe(50);
      expect(contrib.contributorUserId).toBeNull();
      expect(contrib.registrationId).toBeNull();
      expect(
        await db
          .select()
          .from(reunionOrganizersTable)
          .where(eq(reunionOrganizersTable.userId, TARGET)),
      ).toHaveLength(0);
    });
  },
);
