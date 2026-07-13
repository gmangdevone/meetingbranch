import { describe, it, expect, beforeEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

// ──────────────────────────────────────────────────────────────────────────────
// Ownership transfer is authorization-sensitive and rearranges the owner /
// co-organizer rows inside a single transaction. These tests exercise the real
// Express handler + middleware chain (attachAuth → requireReunionManager →
// requireReunionOwner → handler) against an in-memory fake of @workspace/db.
//
// To let the fake db interpret drizzle expressions, we also mock the handful of
// drizzle-orm operators the route/middlewares use (eq/and/asc/desc/sql) so they
// produce inspectable descriptors instead of opaque SQL AST nodes.
// ──────────────────────────────────────────────────────────────────────────────

// Shared, mutable state driving both the auth mock and the fake db. Declared via
// vi.hoisted so it exists before the hoisted vi.mock factories run.
const state = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  return {
    // Current Clerk auth. null userId => unauthenticated.
    auth: null as
      | null
      | { userId: string | null; sessionClaims: Record<string, unknown> | null },
    // In-memory tables, keyed by the schema table name.
    rows: {
      users: [] as Row[],
      reunions: [] as Row[],
      reunion_organizers: [] as Row[],
    } as Record<string, Row[]>,
    // Auto-increment counter for integer identity columns.
    seq: 0,
  };
});

// ── Mock @clerk/express ─────────────────────────────────────────────────────────
vi.mock("@clerk/express", () => ({
  getAuth: () => state.auth ?? { userId: null, sessionClaims: null },
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  clerkClient: {},
}));

// ── Mock drizzle-orm operators as descriptors ───────────────────────────────────
// Column tokens are plain "table.field" strings (see the @workspace/db mock).
// The registry lets the fake db tell a column reference from a literal value.
const columnTokens = vi.hoisted(() => new Set<string>());

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: unknown) => ({ kind: "eq", col, val }),
  and: (...parts: unknown[]) => ({ kind: "and", parts }),
  asc: (col: string) => ({ kind: "asc", col }),
  desc: (col: string) => ({ kind: "desc", col }),
  // Only referenced by unrelated handlers at call-time; a no-op tag is enough.
  sql: (..._args: unknown[]) => ({ kind: "sql" }),
}));

// ── Mock @workspace/db with a small in-memory drizzle-like query builder ─────────
vi.mock("@workspace/db", () => {
  const tables = {
    users: ["id", "email", "firstName", "lastName", "isAdmin", "createdAt"],
    reunions: [
      "id",
      "code",
      "name",
      "startDate",
      "endDate",
      "feePerPerson",
      "paymentHandle",
      "paymentUrl",
      "organizerId",
      "createdAt",
    ],
    reunion_organizers: ["id", "reunionId", "userId", "roles", "createdAt"],
    reunion_branches: ["id", "reunionId", "name", "sortOrder"],
    registrations: ["id", "reunionId", "userId", "branchName", "attendeeCount"],
    attendees: ["id"],
    announcements: ["id", "reunionId", "title", "body", "pinned", "createdAt"],
    schedule_items: ["id", "reunionId", "day", "sortOrder"],
    app_settings: ["id"],
  } as const;

  function makeToken(name: string, fields: readonly string[]) {
    const t: Record<string, unknown> = { __table: name };
    for (const f of fields) {
      const token = `${name}.${f}`;
      t[f] = token;
      columnTokens.add(token);
    }
    return t;
  }

  const resolve = (operand: unknown, scoped: Record<string, Record<string, unknown>>) => {
    if (typeof operand === "string" && columnTokens.has(operand)) {
      const [t, f] = operand.split(".");
      return scoped[t]?.[f];
    }
    return operand;
  };

  const evalExpr = (
    expr: any,
    scoped: Record<string, Record<string, unknown>>,
  ): boolean => {
    if (!expr) return true;
    if (expr.kind === "and") return expr.parts.every((p: unknown) => evalExpr(p, scoped));
    if (expr.kind === "eq") {
      const [t, f] = String(expr.col).split(".");
      return scoped[t]?.[f] === resolve(expr.val, scoped);
    }
    return true;
  };

  const project = (
    proj: Record<string, unknown> | undefined,
    scoped: Record<string, Record<string, unknown>>,
    primary: string,
  ) => {
    if (!proj) return { ...scoped[primary] };
    const out: Record<string, unknown> = {};
    for (const [alias, token] of Object.entries(proj)) {
      if (typeof token === "string" && token.includes(".")) {
        const [t, f] = token.split(".");
        out[alias] = scoped[t]?.[f];
      } else {
        out[alias] = undefined;
      }
    }
    return out;
  };

  const nextId = () => ++state.seq;

  function defaultsFor(table: string, values: Record<string, unknown>) {
    const row: Record<string, unknown> = { ...values };
    if (row.id === undefined && table !== "users") row.id = nextId();
    if (row.createdAt === undefined) row.createdAt = new Date().toISOString();
    if (table === "users" && row.isAdmin === undefined) row.isAdmin = false;
    return row;
  }

  class SelectBuilder {
    _proj?: Record<string, unknown>;
    _table = "";
    _joins: Array<{ table: string; on: unknown }> = [];
    _where: unknown;
    _orderBy: any[] = [];
    _limit?: number;
    constructor(proj?: Record<string, unknown>) {
      this._proj = proj;
    }
    from(token: any) {
      this._table = token.__table;
      return this;
    }
    innerJoin(token: any, on: unknown) {
      this._joins.push({ table: token.__table, on });
      return this;
    }
    where(expr: unknown) {
      this._where = expr;
      return this;
    }
    orderBy(...specs: any[]) {
      this._orderBy = specs;
      return this;
    }
    groupBy() {
      return this;
    }
    limit(n: number) {
      this._limit = n;
      return this._run();
    }
    _run() {
      let scoped = state.rows[this._table].map((r) => ({ [this._table]: r }));
      for (const j of this._joins) {
        const next: Array<Record<string, Record<string, unknown>>> = [];
        for (const s of scoped) {
          for (const r2 of state.rows[j.table]) {
            const merged = { ...s, [j.table]: r2 };
            if (evalExpr(j.on, merged)) next.push(merged);
          }
        }
        scoped = next;
      }
      if (this._where) scoped = scoped.filter((s) => evalExpr(this._where, s));
      for (const spec of [...this._orderBy].reverse()) {
        const [t, f] = String(spec.col).split(".");
        const dir = spec.kind === "desc" ? -1 : 1;
        scoped = [...scoped].sort((a, b) => {
          const av = a[t]?.[f] as any;
          const bv = b[t]?.[f] as any;
          if (av === bv) return 0;
          return (av < bv ? -1 : 1) * dir;
        });
      }
      if (this._limit !== undefined) scoped = scoped.slice(0, this._limit);
      return Promise.resolve(scoped.map((s) => project(this._proj, s, this._table)));
    }
    then(onF: any, onR: any) {
      return this._run().then(onF, onR);
    }
  }

  class InsertBuilder {
    _table: string;
    _values: any;
    constructor(token: any) {
      this._table = token.__table;
    }
    values(v: any) {
      this._values = v;
      return this;
    }
    onConflictDoUpdate({ set }: { set: Record<string, unknown> }) {
      const v = this._values as Record<string, unknown>;
      const existing = state.rows[this._table].find((r) => r.id === v.id);
      if (existing) Object.assign(existing, set);
      else state.rows[this._table].push(defaultsFor(this._table, v));
      return Promise.resolve([]);
    }
    _run() {
      const list = Array.isArray(this._values) ? this._values : [this._values];
      const created = list.map((v) => {
        const row = defaultsFor(this._table, v);
        state.rows[this._table].push(row);
        return { ...row };
      });
      return created;
    }
    returning() {
      return Promise.resolve(this._run());
    }
    then(onF: any, onR: any) {
      return Promise.resolve(this._run()).then(onF, onR);
    }
  }

  class UpdateBuilder {
    _table: string;
    _set: Record<string, unknown> = {};
    _where: unknown;
    constructor(token: any) {
      this._table = token.__table;
    }
    set(v: Record<string, unknown>) {
      this._set = v;
      return this;
    }
    where(expr: unknown) {
      this._where = expr;
      return this;
    }
    _run() {
      const updated: Record<string, unknown>[] = [];
      for (const r of state.rows[this._table]) {
        if (evalExpr(this._where, { [this._table]: r })) {
          Object.assign(r, this._set);
          updated.push({ ...r });
        }
      }
      return updated;
    }
    returning() {
      return Promise.resolve(this._run());
    }
    then(onF: any, onR: any) {
      return Promise.resolve(this._run()).then(onF, onR);
    }
  }

  class DeleteBuilder {
    _table: string;
    _where: unknown;
    constructor(token: any) {
      this._table = token.__table;
    }
    where(expr: unknown) {
      this._where = expr;
      return this;
    }
    _run() {
      const keep: Record<string, unknown>[] = [];
      const deleted: Record<string, unknown>[] = [];
      for (const r of state.rows[this._table]) {
        if (evalExpr(this._where, { [this._table]: r })) deleted.push({ ...r });
        else keep.push(r);
      }
      state.rows[this._table] = keep;
      return deleted;
    }
    returning() {
      return Promise.resolve(this._run());
    }
    then(onF: any, onR: any) {
      return Promise.resolve(this._run()).then(onF, onR);
    }
  }

  const db = {
    select: (proj?: Record<string, unknown>) => new SelectBuilder(proj),
    insert: (token: any) => new InsertBuilder(token),
    update: (token: any) => new UpdateBuilder(token),
    delete: (token: any) => new DeleteBuilder(token),
    transaction: async (fn: (tx: any) => Promise<unknown>) => fn(db),
  };

  const tokens: Record<string, unknown> = { db };
  const tableExports: Record<string, string> = {
    usersTable: "users",
    reunionsTable: "reunions",
    reunionOrganizersTable: "reunion_organizers",
    reunionBranchesTable: "reunion_branches",
    registrationsTable: "registrations",
    attendeesTable: "attendees",
    announcementsTable: "announcements",
    scheduleItemsTable: "schedule_items",
    appSettingsTable: "app_settings",
  };
  for (const [exportName, tableName] of Object.entries(tableExports)) {
    tokens[exportName] = makeToken(tableName, tables[tableName as keyof typeof tables]);
  }
  tokens.REUNION_ROLES = [
    "registration",
    "announcements",
    "schedule",
    "branches",
    "reports",
    "power_user",
  ];
  return tokens;
});

// Import the router AFTER the mocks are registered.
const { default: reunionsRouter } = await import("./reunions");

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api", reunionsRouter);
  return app;
}

// ── Seed helpers ────────────────────────────────────────────────────────────────
const OWNER = "user_owner";
const CO = "user_co";
const OUTSIDER = "user_outsider";
const REUNION_ID = 100;

function authAs(userId: string | null) {
  state.auth = userId
    ? { userId, sessionClaims: { userId } }
    : { userId: null, sessionClaims: null };
}

function seedBase() {
  state.rows.users = [
    { id: OWNER, email: "owner@example.com", firstName: "Olivia", lastName: "Owner", isAdmin: false },
    { id: CO, email: "co@example.com", firstName: "Cody", lastName: "Coorg", isAdmin: false },
    { id: OUTSIDER, email: "out@example.com", firstName: "Otto", lastName: "Outsider", isAdmin: false },
  ];
  state.rows.reunions = [
    {
      id: REUNION_ID,
      code: "ABC1234",
      name: "Smith Family Reunion",
      startDate: "2026-08-01",
      endDate: "2026-08-03",
      feePerPerson: 25,
      paymentHandle: "@smith",
      paymentUrl: null,
      organizerId: OWNER,
      createdAt: new Date("2026-01-01").toISOString(),
    },
  ];
  state.rows.reunion_organizers = [
    { id: 1, reunionId: REUNION_ID, userId: CO, createdAt: new Date("2026-01-02").toISOString() },
  ];
  state.seq = 1000;
}

const transfer = (targetUserId: string) =>
  request(buildApp())
    .post(`/api/reunions/${REUNION_ID}/transfer-ownership`)
    .send({ userId: targetUserId });

describe("POST /api/reunions/:reunionId/transfer-ownership", () => {
  beforeEach(() => {
    state.auth = null;
    seedBase();
  });

  it("lets the owner transfer to an existing co-organizer and swaps the roles", async () => {
    authAs(OWNER);

    const res = await transfer(CO);

    expect(res.status).toBe(200);

    // The promoted co-organizer is now the reunion owner.
    const reunion = state.rows.reunions.find((r) => r.id === REUNION_ID);
    expect(reunion?.organizerId).toBe(CO);

    // The promoted user is removed from the co-organizer list...
    const coRows = state.rows.reunion_organizers.filter((r) => r.reunionId === REUNION_ID);
    expect(coRows.some((r) => r.userId === CO)).toBe(false);
    // ...and the previous owner is demoted into it.
    expect(coRows.some((r) => r.userId === OWNER)).toBe(true);

    // Response lists the new owner first (isOwner), then co-organizers.
    expect(res.body[0]).toMatchObject({ userId: CO, isOwner: true });
    expect(res.body.find((o: any) => o.userId === OWNER)).toMatchObject({
      isOwner: false,
    });
  });

  it("rejects a co-organizer (non-owner) with 403 and leaves ownership unchanged", async () => {
    authAs(CO);

    const res = await transfer(CO);

    expect(res.status).toBe(403);
    expect(state.rows.reunions.find((r) => r.id === REUNION_ID)?.organizerId).toBe(OWNER);
  });

  it("returns 404 when transferring to someone who is not a co-organizer", async () => {
    authAs(OWNER);

    const res = await transfer(OUTSIDER);

    expect(res.status).toBe(404);
    // Nothing changed.
    expect(state.rows.reunions.find((r) => r.id === REUNION_ID)?.organizerId).toBe(OWNER);
    const coRows = state.rows.reunion_organizers.filter((r) => r.reunionId === REUNION_ID);
    expect(coRows).toHaveLength(1);
    expect(coRows[0]?.userId).toBe(CO);
  });

  it("returns 400 when transferring to the current owner", async () => {
    authAs(OWNER);

    const res = await transfer(OWNER);

    expect(res.status).toBe(400);
    expect(state.rows.reunions.find((r) => r.id === REUNION_ID)?.organizerId).toBe(OWNER);
  });
});
