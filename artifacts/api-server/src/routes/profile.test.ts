import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";
const state = vi.hoisted(() => ({ id: "", session: "first-session", sessionCreatedAt: 1001 }));
vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: state.id || null, sessionId: state.session }),
  clerkClient: {
    users: { getUser: async () => ({
      createdAt: 1000, firstName: "Provider", lastName: "Different",
      emailAddresses: [{ emailAddress: "profile-test@example.com" }],
    }) },
    sessions: {
      getSession: async () => ({ createdAt: state.sessionCreatedAt }),
      getSessionList: async () => ({ totalCount: 1 }),
    },
  },
}));
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import router from "./profile";
import { upsertUserFromClerk } from "../lib/users";
let server: Server;
let origin: string;
const id = `profile-test-${crypto.randomUUID()}`;
beforeAll(async () => {
  await db.insert(usersTable).values({ id, email: "profile-test@example.com" });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).log = { error: vi.fn() }; next(); });
  app.use(router);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  origin = `http://127.0.0.1:${(server.address() as any).port}`;
});
afterAll(async () => {
  server?.close();
  await db.delete(usersTable).where(eq(usersTable.id, id));
});
describe("self profile", () => {
  it("rejects signed-out access", async () => {
    expect((await fetch(`${origin}/me/profile`)).status).toBe(401);
  });
  it("validates fields, saves Unicode names and persists greeting per session", async () => {
    state.id = id;
    const get = () => fetch(`${origin}/me/profile`).then(r => r.json());
    expect(await get()).toMatchObject({ firstName: null, isNewAccount: true });
    const put = (body: unknown) => fetch(`${origin}/me/profile`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    for (const body of [
      { firstName: " ", lastName: "Kelly" }, { firstName: "Kelly", lastName: "" },
      { firstName: "x".repeat(101), lastName: "Kelly" },
      { firstName: "Kelly", lastName: "Jones", id: "someone-else" },
    ]) expect((await put(body)).status).toBe(400);
    expect((await put({ firstName: "  Élodie-Anne ", lastName: " O’Neil " })).status).toBe(200);
    expect(await get()).toMatchObject({ firstName: "Élodie-Anne", lastName: "O’Neil", isNewAccount: true });
    state.session = "returning-session";
    expect(await get()).toMatchObject({ firstName: "Élodie-Anne", isNewAccount: false });
    const [row] = await db.select().from(usersTable).where(eq(usersTable.id, id));
    expect(row.nameSavedByUser).toBe(true);
    await upsertUserFromClerk(id);
    expect(await get()).toMatchObject({ firstName: "Élodie-Anne", lastName: "O’Neil" });
  });
  it("treats an older Clerk account as returning on its first profile read", async () => {
    await db.update(usersTable).set({
      greetingInitialized: false, initialGreetingSession: null, lastName: null,
    }).where(eq(usersTable.id, id));
    state.sessionCreatedAt = 90_000;
    const response = await fetch(`${origin}/me/profile`);
    expect(await response.json()).toMatchObject({
      firstName: "Élodie-Anne", lastName: null, isNewAccount: false,
    });
  });
});