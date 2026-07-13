import { describe, it, expect, beforeEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

// ──────────────────────────────────────────────────────────────────────────────
// Co-organizer add/remove are authorization-sensitive and mutate the
// reunion_organizers table. These tests exercise the real Express handler +
// middleware chain (attachAuth → requireReunionManager → handler) against an
// in-memory fake of @workspace/db, mirroring the pattern established in
// reunions.transfer-ownership.test.ts.
//
// The add-by-email handler looks the user up with a raw `sql` predicate
// (`lower(email) = <email>`), so this file's drizzle-orm mock gives `sql` an
// inspectable descriptor and the fake db knows how to evaluate that one shape.
// ──────────────────────────────────────────────────────────────────────────────

// Shared, mutable state driving both the auth mock and the fake db. Declared via
// vi.hoisted so it exists before the hoisted vi.mock factories run.
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
    } as Record<string, Row[]>,
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
const columnTokens = vi.hoisted(() => new Set<string>());

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: unknown) => ({ kind: "eq", col, val }),
  and: (...parts: unknown[]) => ({ kind: "and", parts }),
  asc: (col: string) => ({ kind: "asc", col }),
  desc: (col: string) => ({ kind: "desc", col }),
  // Tagged-template descriptor so the fake db can interpret the email lookup.
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    kind: "sql",
    strings: Array.from(strings),
    values,
  }),
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
    reunion_organizers: ["id", "reunionId", "userId", "createdAt"],
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
    if (expr.kind === "sql") {
      // Only the add-organizer lookup uses raw sql: `lower(<col>) = <literal>`.
      const s: string[] = expr.strings;
      const looksLikeLowerEq =
        s.length === 3 && s[0].includes("lower(") && s[1].includes("=");
      if (looksLikeLowerEq) {
        const colVal = resolve(expr.values[0], scoped);
        const litVal = resolve(expr.values[1], scoped);
        return String(colVal).toLowerCase() === String(litVal).toLowerCase();
      }
      return true;
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
const NEWBIE = "user_newbie";
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
    { id: NEWBIE, email: "newbie@example.com", firstName: "Nina", lastName: "Newbie", isAdmin: false },
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

// ── DELETE /reunions/:reunionId/organizers/:userId ──────────────────────────────
describe("DELETE /api/reunions/:reunionId/organizers/:userId", () => {
  beforeEach(() => {
    state.auth = null;
    seedBase();
  });

  const removeOrganizer = (userId: string) =>
    request(buildApp()).delete(`/api/reunions/${REUNION_ID}/organizers/${userId}`);

  it("lets a manager remove a co-organizer", async () => {
    authAs(OWNER);

    const res = await removeOrganizer(CO);

    expect(res.status).toBe(204);
    const coRows = state.rows.reunion_organizers.filter((r) => r.reunionId === REUNION_ID);
    expect(coRows.some((r) => r.userId === CO)).toBe(false);
    expect(coRows).toHaveLength(0);
  });

  it("returns 400 when trying to remove the owner", async () => {
    authAs(OWNER);

    const res = await removeOrganizer(OWNER);

    expect(res.status).toBe(400);
    // The reunion is not stranded: the owner row is untouched.
    expect(state.rows.reunions.find((r) => r.id === REUNION_ID)?.organizerId).toBe(OWNER);
    // Existing co-organizers remain intact.
    expect(state.rows.reunion_organizers).toHaveLength(1);
  });

  it("returns 404 when the target isn't a co-organizer", async () => {
    authAs(OWNER);

    const res = await removeOrganizer(OUTSIDER);

    expect(res.status).toBe(404);
    // Nothing was deleted.
    expect(state.rows.reunion_organizers).toHaveLength(1);
    expect(state.rows.reunion_organizers[0]?.userId).toBe(CO);
  });

  it("rejects a non-manager with 403 and leaves organizers untouched", async () => {
    authAs(OUTSIDER);

    const res = await removeOrganizer(CO);

    expect(res.status).toBe(403);
    expect(state.rows.reunion_organizers).toHaveLength(1);
    expect(state.rows.reunion_organizers[0]?.userId).toBe(CO);
  });
});

// ── POST /reunions/:reunionId/organizers (add by email) ─────────────────────────
describe("POST /api/reunions/:reunionId/organizers", () => {
  beforeEach(() => {
    state.auth = null;
    seedBase();
  });

  const addOrganizer = (email: string) =>
    request(buildApp()).post(`/api/reunions/${REUNION_ID}/organizers`).send({ email });

  it("adds an existing account as a co-organizer", async () => {
    authAs(OWNER);

    const res = await addOrganizer("newbie@example.com");

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ userId: NEWBIE, isOwner: false });
    const coRows = state.rows.reunion_organizers.filter((r) => r.reunionId === REUNION_ID);
    expect(coRows.some((r) => r.userId === NEWBIE)).toBe(true);
  });

  it("matches the account email case-insensitively", async () => {
    authAs(OWNER);

    const res = await addOrganizer("NewBie@Example.com");

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ userId: NEWBIE });
  });

  it("returns 404 when no account has that email", async () => {
    authAs(OWNER);

    const res = await addOrganizer("nobody@example.com");

    expect(res.status).toBe(404);
    // No organizer row was created.
    expect(state.rows.reunion_organizers).toHaveLength(1);
  });

  it("returns 409 when the email belongs to the reunion owner", async () => {
    authAs(OWNER);

    const res = await addOrganizer("owner@example.com");

    expect(res.status).toBe(409);
    expect(state.rows.reunion_organizers).toHaveLength(1);
  });

  it("returns 409 when the person is already a co-organizer", async () => {
    authAs(OWNER);

    const res = await addOrganizer("co@example.com");

    expect(res.status).toBe(409);
    // Still only the single, original co-organizer row.
    expect(state.rows.reunion_organizers).toHaveLength(1);
  });

  it("rejects a non-manager with 403", async () => {
    authAs(OUTSIDER);

    const res = await addOrganizer("newbie@example.com");

    expect(res.status).toBe(403);
    expect(state.rows.reunion_organizers).toHaveLength(1);
  });
});
