import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
const auth = vi.hoisted(() => ({ id: null as string | null }));
vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: auth.id }),
  clerkClient: { users: { getUser: async () => ({ emailAddresses: [] }) } },
}));
const { db, usersTable, reunionsTable, reunionImagesTable } = await import("@workspace/db");
const { default: router } = await import("./index");
const app = express();
app.use(express.json());
app.use("/api", router);
const run = Date.now().toString();
const admin = `hotelAdmin${run}`;
const owner = `hotelOwner${run}`;
let ids: number[] = [];
let codes: string[] = [];
const empty = { welcomeHeading: null, welcomeDescription: null, hotelEnabled: false, hotelDescription: null, hotelBookingUrl: null, hotelImageUrl: null };
const full = { ...empty, welcomeHeading: "Welcome family", welcomeDescription: "One\nTwo", hotelEnabled: true, hotelDescription: "Stay with us", hotelBookingUrl: "https://example.com/book" };
const save = (id: number, data: object, user: string | null = admin) => {
  auth.id = user;
  return request(app).put(`/api/admin/reunions/${id}/home-content`).send(data);
};
describe.skipIf(!process.env.DATABASE_URL)("admin home content (real DB)", () => {
  beforeAll(async () => {
    await db.insert(usersTable).values([{ id: admin, email: "", isAdmin: true }, { id: owner, email: "", isAdmin: false }]);
    const events = await db.insert(reunionsTable).values([0, 1].map(i => ({
      code: `HT${run}${i}*`, name: "Hotel test", startDate: "2027-07-01", endDate: "2027-07-02",
      organizerId: owner, paymentHandle: "", registrationsOpen: false,
    }))).returning();
    ids = events.map(e => e.id);
    codes = events.map(e => e.code);
    await db.insert(reunionImagesTable).values({ reunionId: ids[0], objectPath: "/objects/uploads/hotel-test", fileName: "hotel.jpg", uploadedBy: admin });
  });
  afterAll(async () => {
    await db.delete(reunionImagesTable).where(inArray(reunionImagesTable.reunionId, ids));
    await db.delete(reunionsTable).where(inArray(reunionsTable.id, ids));
    await db.delete(usersTable).where(inArray(usersTable.id, [admin, owner]));
  });
  it("requires platform admin, even for the event owner", async () => {
    expect((await save(ids[0], full, null)).status).toBe(401);
    expect((await save(ids[0], full, owner)).status).toBe(403);
  });
  it("persists public content without changing other settings or events", async () => {
    expect((await save(ids[0], full)).status).toBe(200);
    auth.id = null;
    expect((await request(app).get(`/api/reunions/by-code/${encodeURIComponent(codes[0])}`)).status).toBe(401);
    auth.id = owner;
    const response = await request(app).get(`/api/reunions/by-code/${encodeURIComponent(codes[0])}`);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ...full, registrationsOpen: false });
    const [other] = await db.select().from(reunionsTable).where(eq(reunionsTable.id, ids[1]));
    expect(other).toMatchObject(empty);
  });
  it("persists event-specific pending payment notices, validates limits and restores defaults", async () => {
    auth.id = owner;
    const notice = { paymentPendingHeading: "Next steps", paymentPendingMessage: "Please pay by Friday.\nThank you!" };
    expect((await request(app).put(`/api/reunions/${ids[0]}`).send(notice)).status).toBe(200);
    const response = await request(app).get(`/api/reunions/by-code/${encodeURIComponent(codes[0])}`);
    expect(response.body).toMatchObject(notice);
    const [other] = await db.select().from(reunionsTable).where(eq(reunionsTable.id, ids[1]));
    expect(other.paymentPendingHeading).toBeNull();
    expect((await request(app).put(`/api/reunions/${ids[0]}`).send({ paymentPendingHeading: "x".repeat(161) })).status).toBe(400);
    expect((await request(app).put(`/api/reunions/${ids[0]}`).send({ paymentPendingMessage: "x".repeat(5001) })).status).toBe(400);
    expect((await request(app).put(`/api/reunions/${ids[0]}`).send({ paymentPendingHeading: null, paymentPendingMessage: " " })).status).toBe(200);
    const reset = await request(app).get(`/api/reunions/by-code/${encodeURIComponent(codes[0])}`);
    expect(reset.body).toMatchObject({ paymentPendingHeading: null, paymentPendingMessage: null });
  });
  it("rejects unsafe links, incomplete enabled content, unknown fields and oversized headings", async () => {
    for (const hotelBookingUrl of ["javascript:alert(1)", "//evil.test", "data:text/html,test", "https://user:pass@example.com", "not a url"]) {
      expect((await save(ids[0], { ...full, hotelBookingUrl })).status).toBe(400);
    }
    expect((await save(ids[0], { ...full, hotelDescription: " " })).status).toBe(400);
    expect((await save(ids[0], { ...full, hotelBookingUrl: null })).status).toBe(400);
    expect((await save(ids[0], { ...full, registrationsOpen: true })).status).toBe(400);
    expect((await save(ids[0], { ...full, welcomeHeading: "x".repeat(161) })).status).toBe(400);
  });
  it("accepts only an image registered to this event and supports removal", async () => {
    const photo = { ...full, hotelImageUrl: "/objects/uploads/hotel-test" };
    expect((await save(ids[0], photo)).status).toBe(200);
    expect((await save(ids[1], photo)).status).toBe(400);
    expect((await save(ids[0], { ...photo, hotelImageUrl: "/objects/../private" })).status).toBe(400);
    expect((await save(ids[0], full)).body.hotelImageUrl).toBe(null);
  });
  it("hides without deleting text, then clears and resets defaults", async () => {
    expect((await save(ids[0], { ...full, hotelEnabled: false })).body).toMatchObject({ hotelEnabled: false, hotelDescription: full.hotelDescription });
    expect((await save(ids[0], empty)).body).toEqual(empty);
    const [stored] = await db.select().from(reunionsTable).where(eq(reunionsTable.id, ids[0]));
    expect(stored).toMatchObject(empty);
    expect((await save(2147483647, empty)).status).toBe(404);
  });
});
