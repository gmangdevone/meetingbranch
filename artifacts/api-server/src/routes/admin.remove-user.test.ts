import { describe, it, expect, beforeEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

// ──────────────────────────────────────────────────────────────────────────────
// Admin user removal: authorization-sensitive multi-table deletion. These tests
// exercise the real Express handler + middleware chain (attachAuth →
// requireAdmin → handler) against an in-memory fake of @workspace/db, mirroring
// the mock pattern used by reunions.transfer-ownership.test.ts.
// ──────────────────────────────────────────────────────────────────────────────

const state = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  return {
    auth: null as
      | null
      | { userId: string | null; sessionClaims: Record<string, unknown> | null },
    rows: {
      users: [] as Row[],
      reunions: [] as Row[],
      reunion_organizers: [] as Row[],
      registrations: [] as Row[],
      attendees: [] as Row[],
      registration_fees: [] as Row[],
      sponsorship_contributions: [] as Row[],
      app_settings: [] as Row[],
    } as Record<string, Row[]>,
    seq: 0,
  };
});

vi.mock("@clerk/express", () => ({
  getAuth: () => state.auth ?? { userId: null, sessionClaims: null },
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  clerkClient: { users: { getUser: async () => ({ emailAddresses: [] }) } },
}));

const columnTokens = vi.hoisted(() => new Set<string>());

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: unknown) => ({ kind: "eq", col, val }),
  and: (...parts: unknown[]) => ({ kind: "and", parts }),
  inArray: (col: string, vals: unknown[]) => ({ kind: "inArray", col, vals }),
  asc: (col: string) => ({ kind: "asc", col }),
  desc: (col: string) => ({ kind: "desc", col }),
  sql: (..._args: unknown[]) => ({ kind: "sql" }),
}));

vi.mock("@workspace/db", () => {
  const tables = {
    users: ["id", "email", "firstName", "lastName", "isAdmin", "isManaged", "createdAt"],
    reunions: ["id", "code", "name", "organizerId", "createdAt"],
    reunion_organizers: ["id", "reunionId", "userId", "roles", "createdAt"],
    registrations: ["id", "reunionId", "userId", "branchName", "attendeeCount", "createdAt"],
    attendees: ["id", "registrationId", "name", "shirtSize"],
    registration_fees: ["id", "registrationId", "feeId"],
    sponsorship_contributions: [
      "id",
      "reunionId",
      "registrationId",
      "contributorUserId",
      "contributorName",
      "amount",
      "source",
    ],
    reunion_branches: ["id", "reunionId", "name", "sortOrder"],
    reunion_fees: ["id", "reunionId", "label", "amount"],
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
    if (expr.kind === "inArray") {
      const [t, f] = String(expr.col).split(".");
      return (expr.vals as unknown[]).includes(scoped[t]?.[f]);
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

  class SelectBuilder {
    _proj?: Record<string, unknown>;
    _table = "";
    _where: unknown;
    _limit?: number;
    constructor(proj?: Record<string, unknown>) {
      this._proj = proj;
    }
    from(token: any) {
      this._table = token.__table;
      return this;
    }
    leftJoin() {
      return this;
    }
    where(expr: unknown) {
      this._where = expr;
      return this;
    }
    orderBy() {
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
      if (this._where) scoped = scoped.filter((s) => evalExpr(this._where, s));
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
      else state.rows[this._table].push({ ...v });
      return Promise.resolve([]);
    }
    returning() {
      const list = Array.isArray(this._values) ? this._values : [this._values];
      const created = list.map((v: any) => {
        const row = { id: ++state.seq, ...v };
        state.rows[this._table].push(row);
        return { ...row };
      });
      return Promise.resolve(created);
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
  const tableExports: Record<string, keyof typeof tables> = {
    usersTable: "users",
    reunionsTable: "reunions",
    reunionOrganizersTable: "reunion_organizers",
    registrationsTable: "registrations",
    attendeesTable: "attendees",
    registrationFeesTable: "registration_fees",
    sponsorshipContributionsTable: "sponsorship_contributions",
    reunionBranchesTable: "reunion_branches",
    reunionFeesTable: "reunion_fees",
    appSettingsTable: "app_settings",
  };
  for (const [exportName, tableName] of Object.entries(tableExports)) {
    tokens[exportName] = makeToken(tableName, tables[tableName]);
  }
  return tokens;
});

const { default: adminRouter } = await import("./admin");

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api", adminRouter);
  return app;
}

const ADMIN = "user_admin";
const TARGET = "user_target";

function authAs(userId: string | null) {
  state.auth = userId
    ? { userId, sessionClaims: { userId } }
    : { userId: null, sessionClaims: null };
}

function seedBase() {
  state.rows.users = [
    { id: ADMIN, email: "admin@example.com", isAdmin: true },
    { id: TARGET, email: "target@example.com", isAdmin: false },
  ];
  state.rows.reunions = [];
  state.rows.reunion_organizers = [
    { id: 1, reunionId: 100, userId: TARGET, roles: ["registration"] },
  ];
  state.rows.registrations = [
    { id: 10, reunionId: 100, userId: TARGET, branchName: "Smith", attendeeCount: 2 },
  ];
  state.rows.attendees = [
    { id: 20, registrationId: 10, name: "A One", shirtSize: "M" },
    { id: 21, registrationId: 10, name: "A Two", shirtSize: "L" },
  ];
  state.rows.registration_fees = [{ id: 30, registrationId: 10, feeId: 1 }];
  state.rows.sponsorship_contributions = [
    {
      id: 40,
      reunionId: 100,
      registrationId: 10,
      contributorUserId: TARGET,
      contributorName: "Target Person",
      amount: 50,
      source: "registration",
    },
  ];
  state.seq = 1000;
}

describe("POST /api/admin/users/:id/remove", () => {
  beforeEach(() => {
    state.auth = null;
    seedBase();
  });

  it("rejects non-admin callers with 403", async () => {
    authAs(TARGET);
    const res = await request(buildApp())
      .post(`/api/admin/users/${ADMIN}/remove`)
      .send({ deleteRegistrations: false });
    expect(res.status).toBe(403);
    expect(state.rows.users).toHaveLength(2);
  });

  it("rejects self-removal with 400", async () => {
    authAs(ADMIN);
    const res = await request(buildApp())
      .post(`/api/admin/users/${ADMIN}/remove`)
      .send({ deleteRegistrations: false });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/own account/i);
    expect(state.rows.users.find((u) => u.id === ADMIN)).toBeTruthy();
  });

  it("returns 404 for an unknown user", async () => {
    authAs(ADMIN);
    const res = await request(buildApp())
      .post("/api/admin/users/user_nope/remove")
      .send({ deleteRegistrations: false });
    expect(res.status).toBe(404);
  });

  it("blocks removal with 409 while the user still owns a reunion", async () => {
    state.rows.reunions = [{ id: 100, code: "ABC1234", name: "R", organizerId: TARGET }];
    authAs(ADMIN);
    const res = await request(buildApp())
      .post(`/api/admin/users/${TARGET}/remove`)
      .send({ deleteRegistrations: false });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/owns a reunion/i);
    expect(state.rows.users.find((u) => u.id === TARGET)).toBeTruthy();
    // Co-organizer roles must be untouched on a refused removal.
    expect(state.rows.reunion_organizers).toHaveLength(1);
  });

  it("removes the user but keeps registrations when deleteRegistrations=false", async () => {
    authAs(ADMIN);
    const res = await request(buildApp())
      .post(`/api/admin/users/${TARGET}/remove`)
      .send({ deleteRegistrations: false });
    expect(res.status).toBe(204);
    expect(state.rows.users.find((u) => u.id === TARGET)).toBeUndefined();
    // Registrations, attendees, and fee selections stay on record.
    expect(state.rows.registrations).toHaveLength(1);
    expect(state.rows.attendees).toHaveLength(2);
    expect(state.rows.registration_fees).toHaveLength(1);
    // Co-organizer roles are revoked.
    expect(state.rows.reunion_organizers).toHaveLength(0);
    // Sponsorship contribution keeps amount/name but drops the account link.
    expect(state.rows.sponsorship_contributions[0].contributorUserId).toBeNull();
    expect(state.rows.sponsorship_contributions[0].amount).toBe(50);
  });

  it("removes the user and their registrations when deleteRegistrations=true", async () => {
    authAs(ADMIN);
    const res = await request(buildApp())
      .post(`/api/admin/users/${TARGET}/remove`)
      .send({ deleteRegistrations: true });
    expect(res.status).toBe(204);
    expect(state.rows.users.find((u) => u.id === TARGET)).toBeUndefined();
    expect(state.rows.registrations).toHaveLength(0);
    expect(state.rows.attendees).toHaveLength(0);
    expect(state.rows.reunion_organizers).toHaveLength(0);
  });

  it("rejects an invalid body with 400", async () => {
    authAs(ADMIN);
    const res = await request(buildApp())
      .post(`/api/admin/users/${TARGET}/remove`)
      .send({});
    expect(res.status).toBe(400);
  });
});
