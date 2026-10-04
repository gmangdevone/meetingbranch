import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import request from "supertest";
import { inArray } from "drizzle-orm";

// Real lockdown middleware + real routes + real DB users. Only Clerk and the
// settings read are mocked, so shared app_settings are never touched.
const authState = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: authState.userId, sessionClaims: authState.userId ? { userId: authState.userId } : null }),
  clerkMiddleware: () => (_q: unknown, _s: unknown, n: () => void) => n(),
  clerkClient: { users: { getUser: async () => ({ emailAddresses: [] }) } },
}));
const settingsMock = vi.hoisted(() => vi.fn());
vi.mock("../lib/access", async (orig) => ({
  ...(await orig<typeof import("../lib/access")>()),
  getCachedSettings: settingsMock,
}));

const hasDb = !!process.env.DATABASE_URL;
const { db, usersTable } = await import("@workspace/db");
const { enforceLockdown } = await import("./lockdown");
const { default: apiRouter } = await import("../routes/index");

const RUN = `${Date.now()}`;
const OWNER = `user_LdOwner${RUN}`;
const MEMBER = `user_LdMember${RUN}`;

const app = express();
app.use(express.json());
app.use("/api", enforceLockdown, apiRouter);
const as = (u: string) => {
  authState.userId = u;
  return request(app);
};

describe.skipIf(!hasDb)("sign-in lockdown exempts the payment owner (real middleware)", () => {
  beforeAll(async () => {
    vi.stubEnv("PAYMENT_OWNER_USER_ID", OWNER);
    vi.stubEnv("ADMIN_USER_ID", "");
    settingsMock.mockResolvedValue({ reunionCreationEnabled: true, signInsLocked: true, testerEmails: [] });
    // Owner has no admin flag, no organizer/co-organizer rows, no tester email.
    await db.insert(usersTable).values([
      { id: OWNER, email: "", isAdmin: false },
      { id: MEMBER, email: "", isAdmin: false },
    ]);
  });
  afterAll(async () => {
    await db.delete(usersTable).where(inArray(usersTable.id, [OWNER, MEMBER]));
    settingsMock.mockReset();
    vi.unstubAllEnvs();
  });

  it("reports the owner as allowed while locked", async () => {
    const res = await as(OWNER).get("/api/me/access");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ allowed: true, signInsLocked: true });
  });

  it("lets the owner through to capability and owner routes", async () => {
    const cap = await as(OWNER).get("/api/me/payment-owner");
    expect(cap.status).toBe(200);
    expect(cap.body).toEqual({ isPaymentOwner: true });
    expect((await as(OWNER).get("/api/owner/payment-recipients")).status).toBe(200);
  });

  it("still blocks a non-exempt member", async () => {
    expect((await as(MEMBER).get("/api/me/access")).body).toEqual({ allowed: false, signInsLocked: true });
    for (const path of ["/api/me/payment-owner", "/api/owner/payment-recipients"]) {
      const res = await as(MEMBER).get(path);
      expect(res.status, path).toBe(403);
      expect(res.body.code).toBe("SIGN_INS_LOCKED");
    }
  });

  it("used the mocked settings, not the shared DB row", () => {
    expect(settingsMock).toHaveBeenCalled();
  });
});
