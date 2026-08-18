import { describe, it, expect, beforeEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

// ──────────────────────────────────────────────────────────────────────────────
// POST /registrations/:id/payment-submissions — multi-registration coverage.
//
// A payment submission records that money was sent/handed over; it is purely
// informational and never touches paymentStatus. When registrationIds is
// provided it must include the path registration, and every covered
// registration must be active, in the SAME reunion, and belong to the same
// account — unless the submitter can manage registrations (owner / admin /
// organizer holding the registration or power_user role). Drives the real
// Express handler + middleware against an in-memory fake of @workspace/db,
// mirroring vendors.test.ts.
// ──────────────────────────────────────────────────────────────────────────────

const state = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  return {
    auth: null as
      | null
      | { userId: string | null; sessionClaims: Record<string, unknown> | null },
    rows: {} as Record<string, Row[]>,
    seq: 0,
  };
});

vi.mock("@clerk/express", () => ({
  getAuth: () => state.auth ?? { userId: null, sessionClaims: null },
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  clerkClient: {},
}));

const columnTokens = vi.hoisted(() => new Set<string>());

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: unknown) => ({ kind: "eq", col, val }),
  and: (...parts: unknown[]) => ({ kind: "and", parts }),
  asc: (col: string) => ({ kind: "asc", col }),
  desc: (col: string) => ({ kind: "desc", col }),
  inArray: (col: string, vals: unknown[]) => ({ kind: "inArray", col, vals }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    kind: "sql",
    strings: Array.from(strings),
    values,
  }),
}));

vi.mock("@workspace/db", () => {
  const tables = {
    users: ["id", "email", "firstName", "lastName", "isAdmin", "createdAt"],
    reunions: ["id", "code", "name", "organizerId", "registrationsOpen", "createdAt"],
    reunion_organizers: ["id", "reunionId", "userId", "roles", "createdAt"],
    reunion_branches: ["id", "reunionId", "name"],
    reunion_fees: ["id", "reunionId", "name", "amount", "isOptional"],
    registrations: [
      "id",
      "reunionId",
      "userId",
      "branchName",
      "attendeeCount",
      "paymentStatus",
      "status",
      "cancelledAt",
      "cancellationResolution",
      "createdAt",
    ],
    registration_fees: ["id", "registrationId", "feeId"],
    attendees: [
      "id",
      "registrationId",
      "name",
      "shirtSize",
      "dietaryRestrictions",
      "age",
      "checkedInAt",
    ],
    sponsorship_contributions: [
      "id",
      "reunionId",
      "registrationId",
      "amount",
      "createdAt",
    ],
    payment_submissions: [
      "id",
      "reunionId",
      "registrationId",
      "registrationIds",
      "submittedBy",
      "method",
      "reference",
      "givenDate",
      "note",
      "amount",
      "createdAt",
    ],
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
      return (expr.vals as unknown[]).some((v) => scoped[t]?.[f] === resolve(v, scoped));
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
    if (table === "registrations") {
      if (row.status === undefined) row.status = "active";
      if (row.paymentStatus === undefined) row.paymentStatus = "pending";
    }
    return row;
  }

  class SelectBuilder {
    _proj?: Record<string, unknown>;
    _table = "";
    _joins: Array<{ table: string; on: unknown; left?: boolean }> = [];
    _where: unknown;
    _orderBy: any[] = [];
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
    leftJoin(token: any, on: unknown) {
      this._joins.push({ table: token.__table, on, left: true });
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
    for() {
      return this;
    }
    _run() {
      let scoped = (state.rows[this._table] ?? []).map((r) => ({ [this._table]: r }));
      for (const j of this._joins) {
        const next: Array<Record<string, Record<string, unknown>>> = [];
        for (const s of scoped) {
          let matched = false;
          for (const r2 of state.rows[j.table] ?? []) {
            const merged = { ...s, [j.table]: r2 };
            if (evalExpr(j.on, merged)) {
              next.push(merged);
              matched = true;
            }
          }
          if (j.left && !matched) next.push({ ...s, [j.table]: {} });
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
      const existing = (state.rows[this._table] ?? []).find((r) => r.id === v.id);
      if (existing) Object.assign(existing, set);
      else (state.rows[this._table] ??= []).push(defaultsFor(this._table, v));
      return Promise.resolve([]);
    }
    _run() {
      const list = Array.isArray(this._values) ? this._values : [this._values];
      const created = list.map((v: Record<string, unknown>) => {
        const row = defaultsFor(this._table, v);
        (state.rows[this._table] ??= []).push(row);
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
      for (const r of state.rows[this._table] ?? []) {
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
      for (const r of state.rows[this._table] ?? []) {
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
    reunionFeesTable: "reunion_fees",
    registrationsTable: "registrations",
    registrationFeesTable: "registration_fees",
    attendeesTable: "attendees",
    sponsorshipContributionsTable: "sponsorship_contributions",
    paymentSubmissionsTable: "payment_submissions",
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

const { default: registrationsRouter } = await import("./registrations");

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api", registrationsRouter);
  return app;
}

const OWNER = "user_owner"; // reunion organizer (owns REUNION_ID)
const REGISTRAR = "user_registrar"; // co-organizer with the registration role
const MEMBER = "user_member"; // plain registrant
const OTHER = "user_other"; // another plain registrant
const REUNION_ID = 300;
const OTHER_REUNION_ID = 400;
// MEMBER's active registrations in REUNION_ID
const REG_A = 501;
const REG_B = 502;
// MEMBER's cancelled registration in REUNION_ID
const REG_CANCELLED = 503;
// MEMBER's registration in a DIFFERENT reunion
const REG_OTHER_REUNION = 504;
// OTHER's active registration in REUNION_ID
const REG_OTHER_USER = 505;

function authAs(userId: string | null) {
  state.auth = userId
    ? { userId, sessionClaims: { userId } }
    : { userId: null, sessionClaims: null };
}

function seed() {
  state.rows = {
    users: [
      { id: OWNER, email: "owner@example.com", firstName: "O", lastName: "W", isAdmin: false },
      { id: REGISTRAR, email: "reg@example.com", firstName: "R", lastName: "G", isAdmin: false },
      { id: MEMBER, email: "m@example.com", firstName: "M", lastName: "M", isAdmin: false },
      { id: OTHER, email: "o@example.com", firstName: "T", lastName: "H", isAdmin: false },
    ],
    reunions: [
      {
        id: REUNION_ID,
        code: "ABC1234",
        name: "Test Reunion",
        organizerId: OWNER,
        registrationsOpen: true,
        createdAt: new Date("2026-01-01").toISOString(),
      },
      {
        id: OTHER_REUNION_ID,
        code: "ZZZ9999",
        name: "Other Reunion",
        organizerId: "user_someone_else",
        registrationsOpen: true,
        createdAt: new Date("2026-01-02").toISOString(),
      },
    ],
    reunion_organizers: [
      { id: 1, reunionId: REUNION_ID, userId: REGISTRAR, roles: ["registration"] },
    ],
    registrations: [
      {
        id: REG_A,
        reunionId: REUNION_ID,
        userId: MEMBER,
        branchName: "North",
        attendeeCount: 2,
        paymentStatus: "pending",
        status: "active",
        createdAt: new Date("2026-02-01").toISOString(),
      },
      {
        id: REG_B,
        reunionId: REUNION_ID,
        userId: MEMBER,
        branchName: "South",
        attendeeCount: 3,
        paymentStatus: "pending",
        status: "active",
        createdAt: new Date("2026-02-02").toISOString(),
      },
      {
        id: REG_CANCELLED,
        reunionId: REUNION_ID,
        userId: MEMBER,
        branchName: "East",
        attendeeCount: 1,
        paymentStatus: "pending",
        status: "cancelled",
        createdAt: new Date("2026-02-03").toISOString(),
      },
      {
        id: REG_OTHER_REUNION,
        reunionId: OTHER_REUNION_ID,
        userId: MEMBER,
        branchName: "West",
        attendeeCount: 1,
        paymentStatus: "pending",
        status: "active",
        createdAt: new Date("2026-02-04").toISOString(),
      },
      {
        id: REG_OTHER_USER,
        reunionId: REUNION_ID,
        userId: OTHER,
        branchName: "North",
        attendeeCount: 2,
        paymentStatus: "pending",
        status: "active",
        createdAt: new Date("2026-02-05").toISOString(),
      },
    ],
    payment_submissions: [],
  };
  state.seq = 1000;
}

const app = () => request(buildApp());
const submit = (id: number, body: Record<string, unknown>) =>
  app().post(`/api/registrations/${id}/payment-submissions`).send(body);
const submissions = () => state.rows.payment_submissions ?? [];

const validCard = { method: "check", amount: 50 } as const;

beforeEach(() => {
  state.auth = null;
  seed();
});

describe("payment submission coverage: registrationIds", () => {
  it("defaults registrationIds to just the path registration (legacy)", async () => {
    authAs(MEMBER);
    const res = await submit(REG_A, { ...validCard });
    expect(res.status).toBe(201);
    expect(res.body.registrationId).toBe(REG_A);
    expect(res.body.registrationIds).toEqual([REG_A]);
    expect(submissions()).toHaveLength(1);
  });

  it("lets the owner cover two of their own active registrations in the same reunion", async () => {
    authAs(MEMBER);
    const res = await submit(REG_A, { ...validCard, registrationIds: [REG_A, REG_B] });
    expect(res.status).toBe(201);
    expect(res.body.registrationId).toBe(REG_A);
    expect(res.body.registrationIds).toEqual(expect.arrayContaining([REG_A, REG_B]));
    expect(res.body.registrationIds).toHaveLength(2);
  });

  it("rejects registrationIds that omit the path registration with 400", async () => {
    authAs(MEMBER);
    const res = await submit(REG_A, { ...validCard, registrationIds: [REG_B] });
    expect(res.status).toBe(400);
    expect(submissions()).toHaveLength(0);
  });

  it("rejects registrationIds containing an unknown id with 400", async () => {
    authAs(MEMBER);
    const res = await submit(REG_A, { ...validCard, registrationIds: [REG_A, 999999] });
    expect(res.status).toBe(400);
    expect(submissions()).toHaveLength(0);
  });

  it("rejects a covered registration from a different reunion with 400", async () => {
    authAs(MEMBER);
    const res = await submit(REG_A, {
      ...validCard,
      registrationIds: [REG_A, REG_OTHER_REUNION],
    });
    expect(res.status).toBe(400);
    expect(submissions()).toHaveLength(0);
  });

  it("rejects a cancelled covered registration with 400", async () => {
    authAs(MEMBER);
    const res = await submit(REG_A, {
      ...validCard,
      registrationIds: [REG_A, REG_CANCELLED],
    });
    expect(res.status).toBe(400);
    expect(submissions()).toHaveLength(0);
  });

  it("forbids an owner from covering another user's registration with 403", async () => {
    authAs(MEMBER);
    const res = await submit(REG_A, {
      ...validCard,
      registrationIds: [REG_A, REG_OTHER_USER],
    });
    expect(res.status).toBe(403);
    expect(submissions()).toHaveLength(0);
  });

  it("lets a registration-managing organizer cover another user's registration", async () => {
    authAs(REGISTRAR);
    const res = await submit(REG_A, {
      ...validCard,
      registrationIds: [REG_A, REG_OTHER_USER],
    });
    expect(res.status).toBe(201);
    expect(res.body.registrationIds).toEqual(expect.arrayContaining([REG_A, REG_OTHER_USER]));
    expect(submissions()).toHaveLength(1);
  });
});

describe("method-specific validation still applies", () => {
  it("rejects cashapp without a reference ($cashtag) with 400", async () => {
    authAs(MEMBER);
    const res = await submit(REG_A, { method: "cashapp", amount: 25 });
    expect(res.status).toBe(400);
    expect(submissions()).toHaveLength(0);
  });
});
