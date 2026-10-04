import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { eq, inArray, sql } from "drizzle-orm";

// ──────────────────────────────────────────────────────────────────────────────
// Integration test against the REAL dev Postgres schema (only Clerk is mocked).
// Covers owner-only authorization (independent of isAdmin), fail-closed config,
// legacy values held for review, approve/change/disable lifecycle, optimistic
// concurrency, append-only audit, cross-reunion isolation, and blocking of the
// organizer create/update destination bypass. Uses synthetic ids only.
// ──────────────────────────────────────────────────────────────────────────────

const authState = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@clerk/express", () => ({
  getAuth: () => ({
    userId: authState.userId,
    sessionClaims: authState.userId ? { userId: authState.userId } : null,
  }),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  clerkClient: { users: { getUser: async () => ({ emailAddresses: [] }) } },
}));

const hasDb = !!process.env.DATABASE_URL;
const { db, usersTable, reunionsTable, reunionOrganizersTable, reunionFeesTable, paymentRecipientsTable, paymentRecipientAuditTable } =
  await import("@workspace/db");
const { default: apiRouter } = await import("./index");

const RUN = `${Date.now()}`;
const OWNER = `user_ItOwner${RUN}`;
const ADMIN = `user_ItAdmin${RUN}`;
const ORGANIZER = `user_ItOrg${RUN}`;
const MEMBER = `user_ItMember${RUN}`;
let REUNION_A = 0;
let REUNION_B = 0;

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

async function cleanup() {
  const ids = [REUNION_A, REUNION_B].filter(Boolean);
  if (ids.length) {
    await db.delete(paymentRecipientAuditTable).where(inArray(paymentRecipientAuditTable.reunionId, ids));
    await db.delete(paymentRecipientsTable).where(inArray(paymentRecipientsTable.reunionId, ids));
    await db.delete(reunionFeesTable).where(inArray(reunionFeesTable.reunionId, ids));
    await db.delete(reunionOrganizersTable).where(inArray(reunionOrganizersTable.reunionId, ids));
    await db.delete(reunionsTable).where(inArray(reunionsTable.id, ids));
  }
  // Reunions created through POST /reunions by the organizer in this run.
  const created = await db.select({ id: reunionsTable.id }).from(reunionsTable).where(eq(reunionsTable.organizerId, ORGANIZER));
  if (created.length) {
    const cids = created.map((c) => c.id);
    await db.delete(reunionFeesTable).where(inArray(reunionFeesTable.reunionId, cids));
    await db.delete(reunionsTable).where(inArray(reunionsTable.id, cids));
  }
  await db.delete(usersTable).where(inArray(usersTable.id, [OWNER, ADMIN, ORGANIZER, MEMBER]));
}

describe.skipIf(!hasDb)("owner-controlled payment recipients (real DB)", () => {
  beforeAll(async () => {
    vi.stubEnv("PAYMENT_OWNER_USER_ID", OWNER);
    await db.insert(usersTable).values([
      // The owner is deliberately NOT an admin: owner authority must not depend on isAdmin.
      { id: OWNER, email: "", isAdmin: false },
      { id: ADMIN, email: "", isAdmin: true },
      { id: ORGANIZER, email: "", isAdmin: false },
      { id: MEMBER, email: "", isAdmin: false },
    ]);
    const [a] = await db
      .insert(reunionsTable)
      .values({ code: `ITA${RUN.slice(-6)}*`, name: "Legacy Reunion", startDate: "2027-07-01", endDate: "2027-07-03", paymentHandle: "$LegacyTag", paymentUrl: "https://cash.app/$LegacyTag", cashAppTag: "LegacyTag", organizerId: ORGANIZER })
      .returning();
    const [b] = await db
      .insert(reunionsTable)
      .values({ code: `ITB${RUN.slice(-6)}*`, name: "Other Reunion", startDate: "2027-08-01", endDate: "2027-08-03", paymentHandle: "", organizerId: ORGANIZER })
      .returning();
    REUNION_A = a.id;
    REUNION_B = b.id;
  });
  afterAll(async () => {
    await cleanup();
    vi.unstubAllEnvs();
  });
  afterEach(() => vi.stubEnv("PAYMENT_OWNER_USER_ID", OWNER));

  const ownerPaths = () => [
    ["get", "/api/owner/payment-recipients"],
    ["get", `/api/owner/payment-recipients/${REUNION_A}`],
    ["put", `/api/owner/payment-recipients/${REUNION_A}`],
    ["post", `/api/owner/payment-recipients/${REUNION_A}/disable`],
    ["get", `/api/owner/payment-recipients/${REUNION_A}/history`],
  ] as const;
  const save = (body: Record<string, unknown>) => ({ confirm: true, expectedVersion: 0, ...body });

  it("capability is a boolean only and independent of isAdmin", async () => {
    const o = await as(OWNER).get("/api/me/payment-owner");
    expect(o.body).toEqual({ isPaymentOwner: true });
    expect(JSON.stringify(o.body)).not.toContain(OWNER);
    expect((await as(ADMIN).get("/api/me/payment-owner")).body).toEqual({ isPaymentOwner: false });
    expect((await as(MEMBER).get("/api/me/payment-owner")).body).toEqual({ isPaymentOwner: false });
    expect((await as(null).get("/api/me/payment-owner")).status).toBe(401);
  });

  it("rejects admins, organizers, members and anonymous callers on every owner route", async () => {
    for (const user of [ADMIN, ORGANIZER, MEMBER, null]) {
      for (const [method, path] of ownerPaths()) {
        const res = await (as(user) as any)[method](path).send(save({ cashAppTag: "Attacker1" }));
        expect(res.status, `${user} ${method} ${path}`).toBe(user ? 403 : 401);
      }
    }
    expect(await db.select().from(paymentRecipientsTable).where(eq(paymentRecipientsTable.reunionId, REUNION_A))).toHaveLength(0);
  });

  it("denies everyone, including the real owner, when owner config is missing or malformed", async () => {
    for (const v of ["", "not-a-clerk-id"]) {
      vi.stubEnv("PAYMENT_OWNER_USER_ID", v);
      expect((await as(OWNER).get("/api/owner/payment-recipients")).status).toBe(403);
      expect((await as(OWNER).get("/api/me/payment-owner")).body).toEqual({ isPaymentOwner: false });
    }
  });

  it("admin escalation paths cannot grant owner authority", async () => {
    // Grant admin to the organizer through the existing admin endpoint.
    expect((await as(ADMIN).patch(`/api/admin/users/${ORGANIZER}/admin`).send({ isAdmin: true })).status).toBe(200);
    expect((await as(ORGANIZER).get("/api/owner/payment-recipients")).status).toBe(403);
    // First-operator bootstrap is closed (an admin exists) and grants nothing here.
    expect((await as(MEMBER).get("/api/admin/setup")).status).toBe(409);
    expect((await as(MEMBER).get("/api/owner/payment-recipients")).status).toBe(403);
    // ADMIN_USER_ID auto-promotion never implies owner.
    vi.stubEnv("ADMIN_USER_ID", MEMBER);
    expect((await as(MEMBER).put(`/api/owner/payment-recipients/${REUNION_A}`).send(save({ cashAppTag: "Attacker1" }))).status).toBe(403);
    vi.stubEnv("ADMIN_USER_ID", "");
    await db.update(usersTable).set({ isAdmin: false }).where(inArray(usersTable.id, [ORGANIZER, MEMBER]));
  });

  it("owner keeps access when their admin flag is revoked", async () => {
    await db.update(usersTable).set({ isAdmin: false }).where(eq(usersTable.id, OWNER));
    expect((await as(OWNER).get("/api/owner/payment-recipients")).status).toBe(200);
  });

  it("preserves legacy values for review and never serves them to payers", async () => {
    const d = await as(OWNER).get(`/api/owner/payment-recipients/${REUNION_A}`);
    expect(d.body).toMatchObject({ status: "pending_review", version: 0, legacy: { cashAppTag: "LegacyTag", paymentUrl: "https://cash.app/$LegacyTag" }, current: { cashAppTag: null } });
    const pub = await as(null).get(`/api/reunions/${REUNION_A}/payment-recipient`);
    expect(pub.body).toMatchObject({ status: "pending_review", cashAppTag: null, cashAppUrl: null, paymentUrl: null, paymentHandle: null });
    const code = (await db.select().from(reunionsTable).where(eq(reunionsTable.id, REUNION_A)))[0].code;
    const byCode = await as(null).get(`/api/reunions/by-code/${encodeURIComponent(code)}`);
    expect(byCode.body).toMatchObject({ cashAppTag: null, paymentHandle: null, paymentUrl: null });
    const managed = await as(ORGANIZER).get(`/api/reunions/${REUNION_A}`);
    expect(managed.body.reunion).toMatchObject({ cashAppTag: null, paymentUrl: null, paymentRecipient: { status: "pending_review" } });
    // Legacy columns are untouched.
    expect((await db.select().from(reunionsTable).where(eq(reunionsTable.id, REUNION_A)))[0].cashAppTag).toBe("LegacyTag");
  });

  it("validates input and requires explicit confirmation", async () => {
    const put = (b: Record<string, unknown>) => as(OWNER).put(`/api/owner/payment-recipients/${REUNION_A}`).send(b);
    expect((await put(save({ cashAppTag: "Family Fund" }))).status).toBe(400);
    expect((await put(save({ cashAppTag: "FamilyFund", paymentUrl: "https://cash.app/$Other" }))).status).toBe(400);
    expect((await put(save({ cashAppTag: "FamilyFund", paymentUrl: "https://cash.app.evil.example/$FamilyFund" }))).status).toBe(400);
    expect((await put(save({ paymentUrl: "http://pay.example.org" }))).status).toBe(400);
    expect((await put({ cashAppTag: "FamilyFund", expectedVersion: 0, confirm: false })).status).toBe(400);
    expect((await as(OWNER).get(`/api/owner/payment-recipients/${REUNION_A}/history`)).body).toHaveLength(0);
  });

  it("concurrent first approvals: exactly one wins, the other is a visible 409", async () => {
    const [r1, r2] = await Promise.all([
      as(OWNER).put(`/api/owner/payment-recipients/${REUNION_A}`).send(save({ cashAppTag: "FamilyFund" })),
      as(OWNER).put(`/api/owner/payment-recipients/${REUNION_A}`).send(save({ cashAppTag: "OtherFund" })),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    const history = (await as(OWNER).get(`/api/owner/payment-recipients/${REUNION_A}/history`)).body;
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ action: "approve", previousValue: null, versionAfter: 1, actor: "Platform owner" });
    expect(JSON.stringify(history)).not.toContain(OWNER);
    // Normalize to a known state for the rest of the lifecycle.
    const winner = history[0].newValue.cashAppTag;
    if (winner !== "FamilyFund") {
      expect((await as(OWNER).put(`/api/owner/payment-recipients/${REUNION_A}`).send(save({ cashAppTag: "FamilyFund", expectedVersion: 1 }))).status).toBe(200);
    }
  });

  it("serves the approved recipient everywhere and isolates other reunions", async () => {
    const pub = (await as(null).get(`/api/reunions/${REUNION_A}/payment-recipient`)).body;
    expect(pub).toMatchObject({ status: "approved", cashAppTag: "FamilyFund", cashAppUrl: "https://cash.app/$FamilyFund" });
    const other = (await as(null).get(`/api/reunions/${REUNION_B}/payment-recipient`)).body;
    expect(other).toMatchObject({ status: "pending_review", cashAppTag: null });
    const managed = (await as(ORGANIZER).get(`/api/reunions/${REUNION_A}`)).body;
    expect(managed.reunion).toMatchObject({ cashAppTag: "FamilyFund", paymentRecipient: { status: "approved" } });
  });

  it("rejects a stale edit without changing data or history", async () => {
    const before = (await as(OWNER).get(`/api/owner/payment-recipients/${REUNION_A}`)).body;
    const stale = await as(OWNER).put(`/api/owner/payment-recipients/${REUNION_A}`).send(save({ cashAppTag: "Hijack1", expectedVersion: before.version - 1 }));
    expect(stale.status).toBe(409);
    const after = (await as(OWNER).get(`/api/owner/payment-recipients/${REUNION_A}`)).body;
    expect(after.current.cashAppTag).toBe("FamilyFund");
    expect((await as(OWNER).get(`/api/owner/payment-recipients/${REUNION_A}/history`)).body).toHaveLength(before.version);
  });

  it("changes, then disables only Cash App while keeping an approved generic destination", async () => {
    let d = (await as(OWNER).get(`/api/owner/payment-recipients/${REUNION_A}`)).body;
    const changed = await as(OWNER).put(`/api/owner/payment-recipients/${REUNION_A}`).send(save({ cashAppTag: "FamilyFund", paymentHandle: "Family Fund (bank)", paymentUrl: "https://pay.example.org/reunion", expectedVersion: d.version }));
    expect(changed.status).toBe(200);
    d = changed.body;
    const hist = (await as(OWNER).get(`/api/owner/payment-recipients/${REUNION_A}/history`)).body;
    expect(hist[0]).toMatchObject({ action: "change", previousValue: { cashAppTag: "FamilyFund", paymentUrl: null }, newValue: { paymentUrl: "https://pay.example.org/reunion" } });

    const off = await as(OWNER).post(`/api/owner/payment-recipients/${REUNION_A}/disable`).send({ scope: "cashapp", confirm: true, expectedVersion: d.version });
    expect(off.status).toBe(200);
    expect(off.body).toMatchObject({ status: "approved", current: { cashAppTag: null, paymentUrl: "https://pay.example.org/reunion" } });
    const pub = (await as(null).get(`/api/reunions/${REUNION_A}/payment-recipient`)).body;
    expect(pub).toMatchObject({ cashAppTag: null, cashAppUrl: null, paymentUrl: "https://pay.example.org/reunion" });
    expect((await as(OWNER).get(`/api/owner/payment-recipients/${REUNION_A}/history`)).body[0].action).toBe("disable_cashapp");

    const all = await as(OWNER).post(`/api/owner/payment-recipients/${REUNION_A}/disable`).send({ scope: "all", confirm: true, expectedVersion: off.body.version });
    expect(all.body).toMatchObject({ status: "disabled", resolved: { paymentUrl: null, paymentHandle: null } });
    expect((await as(OWNER).get(`/api/owner/payment-recipients/${REUNION_A}/history`)).body[0].action).toBe("disable");
  });

  it("exposes no API route that edits or deletes audit history", async () => {
    const before = (await as(OWNER).get(`/api/owner/payment-recipients/${REUNION_A}/history`)).body;
    expect(before.length).toBeGreaterThan(0);
    const base = `/api/owner/payment-recipients/${REUNION_A}/history`;
    for (const [method, path] of [
      ["put", base], ["patch", base], ["delete", base], ["post", base],
      ["put", `${base}/${before[0].id}`], ["patch", `${base}/${before[0].id}`], ["delete", `${base}/${before[0].id}`],
    ] as const) {
      const res = await (as(OWNER) as any)[method](path).send({ note: "tamper" });
      // Unmatched paths fall through to later routers (404, or 403 from the admin gate).
      expect([403, 404], `${method} ${path}`).toContain(res.status);
    }
    expect((await as(OWNER).get(base)).body).toEqual(before);
  });

  it("rolls back the recipient change when the audit insert fails", async () => {
    // Test-only fixture: a trigger that fails audit inserts carrying a unique
    // sentinel note. Created and dropped by this test; never part of a migration.
    const sentinel = `it-force-audit-failure-${RUN}`;
    const fn = `it_fail_audit_${RUN}`;
    await db.execute(sql.raw(`CREATE FUNCTION ${fn}() RETURNS trigger AS $f$ BEGIN IF NEW.note = '${sentinel}' THEN RAISE EXCEPTION 'forced audit failure'; END IF; RETURN NEW; END $f$ LANGUAGE plpgsql`));
    await db.execute(sql.raw(`CREATE TRIGGER ${fn} BEFORE INSERT ON payment_recipient_audit FOR EACH ROW EXECUTE FUNCTION ${fn}()`));
    try {
      const before = (await as(OWNER).get(`/api/owner/payment-recipients/${REUNION_B}`)).body;
      const historyBefore = (await as(OWNER).get(`/api/owner/payment-recipients/${REUNION_B}/history`)).body;
      const res = await as(OWNER)
        .put(`/api/owner/payment-recipients/${REUNION_B}`)
        .send(save({ cashAppTag: "RollbackFund", expectedVersion: before.version, note: sentinel }));
      expect(res.status).toBe(500);
      const after = (await as(OWNER).get(`/api/owner/payment-recipients/${REUNION_B}`)).body;
      expect(after).toMatchObject({ status: before.status, version: before.version, current: before.current });
      expect(await db.select().from(paymentRecipientsTable).where(eq(paymentRecipientsTable.reunionId, REUNION_B))).toHaveLength(0);
      expect((await as(OWNER).get(`/api/owner/payment-recipients/${REUNION_B}/history`)).body).toEqual(historyBefore);
      expect((await as(null).get(`/api/reunions/${REUNION_B}/payment-recipient`)).body.cashAppTag).toBeNull();
    } finally {
      await db.execute(sql.raw(`DROP TRIGGER IF EXISTS ${fn} ON payment_recipient_audit`));
      await db.execute(sql.raw(`DROP FUNCTION IF EXISTS ${fn}()`));
    }
  });

  it("organizer and admin cannot set destinations through reunion create/update", async () => {
    const tamper = [{ cashAppTag: "Attacker1" }, { paymentHandle: "$Attacker1" }, { paymentUrl: "https://cash.app/$Attacker1" }, { cashAppTag: null }];
    for (const user of [ORGANIZER, ADMIN]) {
      for (const t of tamper) {
        const res = await as(user).put(`/api/reunions/${REUNION_B}`).send({ name: "Renamed", ...t });
        expect(res.status).toBe(403);
      }
    }
    expect((await as(ORGANIZER).put(`/api/reunions/${REUNION_B}`).send({ name: "Renamed OK" })).status).toBe(200);
    expect(await db.select().from(paymentRecipientsTable).where(eq(paymentRecipientsTable.reunionId, REUNION_B))).toHaveLength(0);

    const create = await as(ORGANIZER).post("/api/reunions").send({ name: "New", startDate: "2027-09-01", endDate: "2027-09-02", feePerPerson: 10, branches: ["A"], paymentHandle: "$Attacker1" });
    expect([403]).toContain(create.status);
  });
});
