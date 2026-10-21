import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";

const auth = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: auth.userId }),
  clerkClient: { users: { getUser: vi.fn() } },
}));
const { db, pool, usersTable } = await import("@workspace/db");
const { default: router } = await import("./registrationView");
const app = express();
app.use(express.json());
app.use("/api", router);
const users = [`view_${Date.now()}_a`, `view_${Date.now()}_b`];
describe.skipIf(!process.env.DATABASE_URL)("account-owned registration views", () => {
  beforeAll(async () => {
    await db.insert(usersTable).values(users.map(id => ({ id, email: `${id}@test.local`, firstName: "Original" })));
  });
  afterAll(async () => {
    await db.delete(usersTable).where(inArray(usersTable.id, users));
    await pool.end();
  });
  it("requires authentication for both reads and writes", async () => {
    auth.userId = null;
    expect((await request(app).get("/api/me/registration-view")).status).toBe(401);
    expect((await request(app).put("/api/me/registration-view").send({ fields: [] })).status).toBe(401);
  });
  it("returns the exact default with no stored preference", async () => {
    auth.userId = users[0];
    const res = await request(app).get("/api/me/registration-view");
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toContain("no-store");
    expect(res.body).toEqual({ fields: ["date", "balance", "payment"], resetInvalid: false });
  });
  it("persists presets, normalizes duplicates, and isolates accounts", async () => {
    auth.userId = users[0];
    const saved = await request(app).put("/api/me/registration-view").send({ fields: ["checkin", "payment", "checkin"] });
    expect(saved.status).toBe(200);
    expect(saved.body.fields).toEqual(["checkin", "payment"]);
    auth.userId = users[1];
    expect((await request(app).get("/api/me/registration-view")).body.fields).toEqual(["date", "balance", "payment"]);
    auth.userId = users[0];
    expect((await request(app).get("/api/me/registration-view")).body.fields).toEqual(["checkin", "payment"]);
    expect((await request(app).put("/api/me/registration-view").send({ fields: ["balance", "payment", "edit"] })).body.fields).toEqual(["balance", "payment", "edit"]);
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, users[0]));
    expect(user.firstName).toBe("Original");
    expect(user.isAdmin).toBe(false);
  });
  it("rejects unknown fields and attempts to target another account", async () => {
    auth.userId = users[0];
    for (const body of [{ fields: ["admin"] }, { fields: ["date"], userId: users[1] }, { fields: null }, {}]) {
      expect((await request(app).put("/api/me/registration-view").send(body)).status).toBe(400);
    }
    expect((await request(app).get("/api/me/registration-view")).body.fields).toEqual(["balance", "payment", "edit"]);
  });
  it("supports a minimal view and explicitly reports malformed legacy preferences", async () => {
    auth.userId = users[0];
    expect((await request(app).put("/api/me/registration-view").send({ fields: [] })).body.fields).toEqual([]);
    await db.update(usersTable).set({ registrationViewFields: ["obsolete"] }).where(eq(usersTable.id, users[0]));
    expect((await request(app).get("/api/me/registration-view")).body).toEqual({
      fields: ["date", "balance", "payment"], resetInvalid: true,
    });
    expect((await request(app).put("/api/me/registration-view").send({ fields: ["date", "balance", "payment"] })).body.resetInvalid).toBe(false);
  });
  it("reports storage failures without claiming a save succeeded", async () => {
    auth.userId = users[0];
    const failure = vi.spyOn(db, "select").mockImplementationOnce(() => { throw new Error("unavailable"); });
    expect((await request(app).get("/api/me/registration-view")).status).toBe(503);
    failure.mockImplementationOnce(() => { throw new Error("unavailable"); });
    expect((await request(app).put("/api/me/registration-view").send({ fields: [] })).status).toBe(503);
    failure.mockRestore();
    expect((await request(app).get("/api/me/registration-view")).body.fields).toEqual(["date", "balance", "payment"]);
  });
});
