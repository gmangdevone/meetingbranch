import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { and, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";

const auth = vi.hoisted(() => ({ userId: null as string | null }));
const mail = vi.hoisted(() => ({ send: vi.fn().mockResolvedValue("provider-id") }));
vi.mock("@clerk/express", () => ({ getAuth: () => ({ userId: auth.userId }), clerkClient: { users: { getUser: vi.fn() } } }));
vi.mock("../lib/graduateEmail", () => ({ sendGraduateEmail: mail.send }));
const { db, pool, usersTable, reunionsTable, reunionOrganizersTable, graduateConfigsTable, graduateSubmissionsTable } = await import("@workspace/db");
const { default: router } = await import("./graduate");
const { requireAuth } = await import("../middlewares/requireAuth");
const { defaultGraduateContent } = await import("../lib/graduate");
const app = express();
app.use(express.json());
app.use("/api/reunions", requireAuth);
app.use("/api", router);
const prefix = `graduate_${randomUUID()}`;
const ids = ["admin", "owner", "recipient", "power", "ordinary", "candidate", "other"].map(s => `${prefix}_${s}`);
const [admin, owner, recipient, power, ordinary, candidate, other] = ids;
let eventId: number, otherEvent: number, submissionId: number;
let content = { ...defaultGraduateContent, questions: [{ id: "essay", label: "Education goals", help: "", kind: "long" as const, required: true }] };
const base = () => `/api/reunions/${eventId}/graduate-dollars`;
const input = () => ({ requestId: randomUUID(), revision: content.revision, name: "QA Candidate", email: "candidate@example.com",
  zelle: "candidate@example.com", cashApp: "$GraduateQA", links: [{ label: "YouTube", url: "https://youtube.com/@qa" }],
  answers: [{ questionId: "essay", value: "Study engineering" }] });
async function controls(visible = true, open = true, recipientId: string | null = recipient) {
  auth.userId = admin;
  return request(app).put(`${base()}/controls`).send({ visible, open, recipientId });
}
describe.skipIf(!process.env.DATABASE_URL)("Graduate Dollars private application lifecycle", () => {
  beforeAll(async () => {
    await db.insert(usersTable).values(ids.map(id => ({ id, email: `${id}@example.com`, isAdmin: id === admin })));
    const events = await db.insert(reunionsTable).values([0, 1].map(i => ({
      name: "Graduate QA", code: `GD${randomUUID().slice(0, 8)}${i}*`.toUpperCase(),
      startDate: "2027-07-16", endDate: "2027-07-19", paymentHandle: "", organizerId: owner,
    }))).returning();
    [eventId, otherEvent] = events.map(e => e.id);
    await db.insert(reunionOrganizersTable).values([
      { reunionId: eventId, userId: recipient, roles: [] },
      { reunionId: eventId, userId: power, roles: ["power_user"] },
      { reunionId: eventId, userId: ordinary, roles: ["reports"] },
    ]);
  });
  afterAll(async () => {
    await db.delete(reunionsTable).where(inArray(reunionsTable.id, [eventId, otherEvent]));
    await db.delete(usersTable).where(inArray(usersTable.id, ids));
    await pool.end();
  });
  it("requires sign-in and hides unconfigured documents", async () => {
    auth.userId = null;
    expect((await request(app).get(base())).status).toBe(401);
    auth.userId = candidate;
    const hidden = await request(app).get(base());
    expect(hidden.body).toEqual({ visible: false, open: false });
    expect(hidden.headers["cache-control"]).toBe("no-store");
    expect((await request(app).get(`${base()}/config`)).status).toBe(403);
  });
  it("limits controls to admins, editor to power users, and rejects bad recipients", async () => {
    for (const id of [owner, power, ordinary, candidate]) {
      auth.userId = id;
      expect((await request(app).put(`${base()}/controls`).send({ visible: true, open: true, recipientId: recipient })).status).toBe(403);
    }
    expect((await controls(true, true, candidate)).status).toBe(400);
    expect((await controls(true, true, null)).status).toBe(400);
    auth.userId = ordinary;
    expect((await request(app).put(`${base()}/config`).send(content)).status).toBe(403);
    auth.userId = power;
    const saved = await request(app).put(`${base()}/config`).send(content);
    expect(saved.status).toBe(200);
    content = saved.body;
    expect((await request(app).put(`${base()}/config`).send({ ...content, revision: 0 })).status).toBe(409);
    expect((await request(app).get(`${base()}/config`)).body.canEdit).toBe(true);
  });
  it("validates content, rejects arbitrary script/style and preserves saved content", async () => {
    auth.userId = owner;
    for (const bad of [
      { ...content, background: "url(evil)" },
      { ...content, blocks: [{ ...content.blocks[0], font: "arbitrary" }] },
      { ...content, blocks: [{ ...content.blocks[0], kind: "link", url: "javascript:alert(1)" }] },
      { ...content, questions: [...content.questions, content.questions[0]] },
      { ...content, visible: true },
    ]) expect((await request(app).put(`${base()}/config`).send(bad)).status).toBe(400);
    expect((await request(app).get(`${base()}/config`)).body.content).toEqual(content);
  });
  it("independently enforces hidden and closed states on direct submissions", async () => {
    expect((await controls(false, true)).status).toBe(200);
    auth.userId = candidate;
    expect((await request(app).get(base())).body).toEqual({ visible: false, open: false });
    expect((await request(app).post(`${base()}/applications`).send(input())).status).toBe(403);
    await controls(true, false);
    auth.userId = candidate;
    const page = await request(app).get(base());
    expect(page.body.visible).toBe(true);
    expect(page.body.open).toBe(false);
    expect(page.body.content).toEqual(content);
    expect(page.body).not.toHaveProperty("recipientId");
    expect((await request(app).post(`${base()}/applications`).send(input())).status).toBe(403);
  });
  it("validates required answers, question revision, URLs and payout references", async () => {
    await controls();
    auth.userId = candidate;
    for (const bad of [
      { ...input(), answers: [] },
      { ...input(), links: [{ label: "bad", url: "https://user:password@example.com" }] },
      { ...input(), zelle: "not an email or phone" }, { ...input(), cashApp: "javascript:<x>" },
      { ...input(), userId: other }, { ...input(), email: "bad" },
    ]) expect((await request(app).post(`${base()}/applications`).send(bad)).status).toBe(400);
    expect((await request(app).post(`${base()}/applications`).send({ ...input(), revision: 0 })).status).toBe(409);
  });
  it("saves without reunion registration and protects concurrent retries from duplicate records/email", async () => {
    auth.userId = candidate;
    const body = input();
    const results = await Promise.all([1, 2].map(() => request(app).post(`${base()}/applications`).send(body)));
    expect(results.map(r => r.status)).toEqual([201, 201]);
    expect(results[0].body.id).toBe(results[1].body.id);
    submissionId = results[0].body.id;
    expect(mail.send).toHaveBeenCalledTimes(1);
    expect(mail.send.mock.calls[0][0]).toBe(`${recipient}@example.com`);
    const mine = await request(app).get(`${base()}/mine`);
    expect(mine.body).toHaveLength(1);
    expect(mine.body[0].emailStatus).toBe("accepted");
    expect(mine.body[0]).not.toHaveProperty("emailRecipient");
    expect(mine.body[0].answers[0].label).toBe("Education goals");
  });
  it("restricts review and resend to owner, admin and selected current organizer", async () => {
    for (const id of [candidate, other, power, ordinary]) {
      auth.userId = id;
      expect((await request(app).get(`${base()}/applications`)).status).toBe(403);
      expect((await request(app).post(`${base()}/applications/${submissionId}/resend`)).status).toBe(403);
    }
    for (const id of [owner, admin, recipient]) {
      auth.userId = id;
      expect((await request(app).get(`${base()}/applications`)).body).toHaveLength(1);
    }
    auth.userId = recipient;
    expect((await request(app).get(`${base()}/config`)).body).toMatchObject({ canEdit: false, canReview: true });
    auth.userId = other;
    expect((await request(app).get(`${base()}/mine`)).body).toEqual([]);
    auth.userId = admin;
    expect((await request(app).post(`/api/reunions/${otherEvent}/graduate-dollars/applications/${submissionId}/resend`)).status).toBe(404);
  });
  it("preserves question snapshots after editing and rejects stale forms", async () => {
    auth.userId = power;
    const saved = await request(app).put(`${base()}/config`).send({ ...content, questions: [{ ...content.questions[0], label: "New prompt" }] });
    expect(saved.status).toBe(200);
    const stale = input();
    content = saved.body;
    auth.userId = candidate;
    expect((await request(app).post(`${base()}/applications`).send(stale)).status).toBe(409);
    expect((await request(app).get(`${base()}/mine`)).body[0].answers[0].label).toBe("Education goals");
  });
  it("keeps failed-email applications and supports bounded explicit resend", async () => {
    auth.userId = candidate;
    mail.send.mockRejectedValueOnce(new Error("Provider timeout"));
    const saved = await request(app).post(`${base()}/applications`).send(input());
    expect(saved.status).toBe(201);
    expect(saved.body.emailStatus).toBe("failed");
    const sid = saved.body.id;
    auth.userId = recipient;
    expect((await request(app).post(`${base()}/applications/${sid}/resend`)).status).toBe(429);
    await db.update(graduateSubmissionsTable).set({ emailAttemptAt: new Date(0) }).where(eq(graduateSubmissionsTable.id, sid));
    const resend = await request(app).post(`${base()}/applications/${sid}/resend`);
    expect(resend.body).toMatchObject({ emailStatus: "accepted", emailAttempts: 2 });
    await db.update(graduateSubmissionsTable).set({ emailAttempts: 5, emailAttemptAt: new Date(0) }).where(eq(graduateSubmissionsTable.id, sid));
    expect((await request(app).post(`${base()}/applications/${sid}/resend`)).status).toBe(429);
  });
  it("flags a removed recipient, closes effective intake and revokes their review", async () => {
    await db.delete(reunionOrganizersTable).where(and(eq(reunionOrganizersTable.reunionId, eventId), eq(reunionOrganizersTable.userId, recipient)));
    auth.userId = recipient;
    expect((await request(app).get(`${base()}/applications`)).status).toBe(403);
    auth.userId = admin;
    expect((await request(app).get(`${base()}/config`)).body.recipientValid).toBe(false);
    auth.userId = candidate;
    expect((await request(app).get(base())).body.open).toBe(false);
    expect((await request(app).post(`${base()}/applications`).send(input())).status).toBe(503);
    expect((await controls(true, false, owner)).status).toBe(200);
  });
  it("hiding never deletes existing submissions or exposes unpublished content", async () => {
    await controls(false, false, owner);
    auth.userId = candidate;
    expect((await request(app).get(base())).body).toEqual({ visible: false, open: false });
    expect((await request(app).get(`${base()}/mine`)).body).toHaveLength(2);
    const [cfg] = await db.select().from(graduateConfigsTable).where(eq(graduateConfigsTable.reunionId, eventId));
    expect(cfg.content).toHaveProperty("blocks");
  });
});
