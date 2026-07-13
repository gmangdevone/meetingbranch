import { describe, it, expect, beforeEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

// ──────────────────────────────────────────────────────────────
// Shared mutable state for the mocks. Declared via vi.hoisted so it is
// initialized before the hoisted vi.mock factories below run.
// ──────────────────────────────────────────────────────────────
const state = vi.hoisted(() => ({
  // Current Clerk auth returned by getAuth(). null userId => unauthenticated.
  auth: null as
    | null
    | { userId: string | null; sessionClaims: Record<string, unknown> | null },
  // In-memory "users" table backing the fake db.
  users: [] as Array<{
    id: string;
    email?: string;
    firstName?: string | null;
    lastName?: string | null;
    isAdmin?: boolean;
  }>,
}));

// Mock Clerk: getAuth returns our configurable auth; clerkMiddleware is a no-op.
vi.mock("@clerk/express", () => ({
  getAuth: () => state.auth ?? { userId: null, sessionClaims: null },
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) =>
    next(),
}));

// Mock the db package. The admin/setup route only touches usersTable via a
// select-where-limit (to see if any admin exists) and an insert upsert (to
// promote the caller). We implement just enough of drizzle's fluent API to
// support those two operations against the in-memory store.
vi.mock("@workspace/db", () => {
  const db = {
    select() {
      return {
        from() {
          return this;
        },
        where() {
          return this;
        },
        // Setup route awaits `.limit(1)`; return the current admins.
        limit() {
          return Promise.resolve(
            state.users.filter((u) => u.isAdmin).map((u) => ({ id: u.id })),
          );
        },
      };
    },
    insert() {
      let pending: Record<string, unknown> = {};
      return {
        values(v: Record<string, unknown>) {
          pending = v;
          return this;
        },
        onConflictDoUpdate({ set }: { set: Record<string, unknown> }) {
          const id = pending.id as string;
          const existing = state.users.find((u) => u.id === id);
          if (existing) {
            Object.assign(existing, set);
          } else {
            state.users.push({ ...(pending as { id: string }) });
          }
          return Promise.resolve([]);
        },
      };
    },
  };

  // Table tokens — the fake db ignores the actual drizzle expressions, but the
  // route/middleware import these names, so they must exist.
  return {
    db,
    usersTable: { id: "id", isAdmin: "is_admin" },
    registrationsTable: {},
    attendeesTable: {},
    announcementsTable: {},
    scheduleItemsTable: {},
  };
});

// Import the router AFTER the mocks are registered (vi.mock is hoisted, so a
// static import would also work, but this keeps intent explicit).
const { default: adminRouter } = await import("./admin");

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api", adminRouter);
  return app;
}

describe("GET /api/admin/setup — self-closing admin bootstrap", () => {
  beforeEach(() => {
    state.auth = null;
    state.users = [];
  });

  it("promotes the first signed-in user to admin when no admin exists", async () => {
    state.auth = {
      userId: "user_first",
      sessionClaims: {
        userId: "user_first",
        email: "first@example.com",
        firstName: "First",
        lastName: "Operator",
      },
    };

    const res = await request(buildApp()).get("/api/admin/setup");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.userId).toBe("user_first");

    // The caller is now persisted as an admin.
    const promoted = state.users.find((u) => u.id === "user_first");
    expect(promoted?.isAdmin).toBe(true);
  });

  it("rejects a different user with 409 once an admin exists and does NOT promote them", async () => {
    // Seed an existing admin.
    state.users = [
      { id: "user_existing_admin", email: "admin@example.com", isAdmin: true },
    ];

    state.auth = {
      userId: "user_second",
      sessionClaims: {
        userId: "user_second",
        email: "second@example.com",
      },
    };

    const res = await request(buildApp()).get("/api/admin/setup");

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already complete/i);

    // The second user must NOT have been added or promoted.
    const second = state.users.find((u) => u.id === "user_second");
    expect(second).toBeUndefined();

    // The original admin remains the only admin.
    const admins = state.users.filter((u) => u.isAdmin);
    expect(admins).toHaveLength(1);
    expect(admins[0]?.id).toBe("user_existing_admin");
  });

  it("rejects unauthenticated requests with 401", async () => {
    state.auth = { userId: null, sessionClaims: null };

    const res = await request(buildApp()).get("/api/admin/setup");

    expect(res.status).toBe(401);
    // No user should have been created.
    expect(state.users).toHaveLength(0);
  });
});
