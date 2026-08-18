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
      "contributorUserId",
      "contributorName",
      "amount",
      "source",
      "paymentStatus",
      "createdAt",
    ],
    sponsorship_allocations: [
      "id",
      "reunionId",
      "registrationId",
      "amount",
      "fundedFrom",
      "sponsorName",
      "note",
      "createdBy",
      "createdAt",
    ],
    payment_submissions: [
      "id",
      "reunionId",
      "registrationId",
      "registrationIds",
      "contributionIds",
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
      // Aggregate selects (sum/count via sql``) return one summary row.
      const isAggregate =
        this._proj &&
        Object.values(this._proj).some(
          (v) => v && typeof v === "object" && (v as any).kind === "sql",
        );
      if (isAggregate) {
        const out: Record<string, unknown> = {};
        for (const [alias, token] of Object.entries(this._proj!)) {
          if (token && typeof token === "object" && (token as any).kind === "sql") {
            const text = (token as any).strings.join("");
            if (text.includes("sum(")) {
              const col = (token as any).values[0];
              out[alias] = scoped.reduce(
                (s, row) => s + (Number(resolve(col, row)) || 0),
                0,
              );
            } else {
              out[alias] = scoped.length;
            }
          } else if (typeof token === "string" && token.includes(".")) {
            const [t, f] = token.split(".");
            out[alias] = scoped[0]?.[t]?.[f];
          }
        }
        return Promise.resolve([out]);
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
    execute: async () => [],
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
    sponsorshipAllocationsTable: "sponsorship_allocations",
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
// Sponsorship contributions
const CONTRIB_MINE_PENDING = 901;
const CONTRIB_MINE_PAID = 902;
const CONTRIB_MINE_ATTACHED = 903;
const CONTRIB_OTHER_USER = 904;
const CONTRIB_OTHER_REUNION = 905;

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
    sponsorship_contributions: [
      // MEMBER's standalone (no registration) pending chip-in — payable.
      {
        id: CONTRIB_MINE_PENDING,
        reunionId: REUNION_ID,
        registrationId: null,
        contributorUserId: MEMBER,
        contributorName: "M M",
        amount: 40,
        source: "direct",
        paymentStatus: "pending",
        createdAt: new Date("2026-02-10").toISOString(),
      },
      // MEMBER's standalone chip-in already paid — not payable again.
      {
        id: CONTRIB_MINE_PAID,
        reunionId: REUNION_ID,
        registrationId: null,
        contributorUserId: MEMBER,
        contributorName: "M M",
        amount: 25,
        source: "direct",
        paymentStatus: "paid",
        createdAt: new Date("2026-02-11").toISOString(),
      },
      // MEMBER's chip-in attached to a registration — settled with it.
      {
        id: CONTRIB_MINE_ATTACHED,
        reunionId: REUNION_ID,
        registrationId: REG_A,
        contributorUserId: MEMBER,
        contributorName: "M M",
        amount: 15,
        source: "registration",
        paymentStatus: "pending",
        createdAt: new Date("2026-02-12").toISOString(),
      },
      // OTHER user's standalone pending chip-in.
      {
        id: CONTRIB_OTHER_USER,
        reunionId: REUNION_ID,
        registrationId: null,
        contributorUserId: OTHER,
        contributorName: "T H",
        amount: 60,
        source: "direct",
        paymentStatus: "pending",
        createdAt: new Date("2026-02-13").toISOString(),
      },
      // MEMBER's chip-in in a DIFFERENT reunion.
      {
        id: CONTRIB_OTHER_REUNION,
        reunionId: OTHER_REUNION_ID,
        registrationId: null,
        contributorUserId: MEMBER,
        contributorName: "M M",
        amount: 30,
        source: "direct",
        paymentStatus: "pending",
        createdAt: new Date("2026-02-14").toISOString(),
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

describe("payment submission coverage: contributionIds", () => {
  it("stores contributionIds when covering own pending standalone chip-ins", async () => {
    authAs(MEMBER);
    const res = await submit(REG_A, {
      ...validCard,
      contributionIds: [CONTRIB_MINE_PENDING],
    });
    expect(res.status).toBe(201);
    expect(res.body.contributionIds).toEqual([CONTRIB_MINE_PENDING]);
    expect(submissions()).toHaveLength(1);
  });

  it("defaults contributionIds to an empty list when omitted", async () => {
    authAs(MEMBER);
    const res = await submit(REG_A, { ...validCard });
    expect(res.status).toBe(201);
    expect(res.body.contributionIds).toEqual([]);
  });

  it("rejects a nonexistent contribution with 400", async () => {
    authAs(MEMBER);
    const res = await submit(REG_A, { ...validCard, contributionIds: [99999] });
    expect(res.status).toBe(400);
    expect(submissions()).toHaveLength(0);
  });

  it("rejects a contribution from a different reunion with 400", async () => {
    authAs(MEMBER);
    const res = await submit(REG_A, {
      ...validCard,
      contributionIds: [CONTRIB_OTHER_REUNION],
    });
    expect(res.status).toBe(400);
    expect(submissions()).toHaveLength(0);
  });

  it("rejects a chip-in attached to a registration with 400", async () => {
    authAs(MEMBER);
    const res = await submit(REG_A, {
      ...validCard,
      contributionIds: [CONTRIB_MINE_ATTACHED],
    });
    expect(res.status).toBe(400);
    expect(submissions()).toHaveLength(0);
  });

  it("rejects an already-paid chip-in with 400", async () => {
    authAs(MEMBER);
    const res = await submit(REG_A, {
      ...validCard,
      contributionIds: [CONTRIB_MINE_PAID],
    });
    expect(res.status).toBe(400);
    expect(submissions()).toHaveLength(0);
  });

  it("forbids covering another user's chip-in with 403", async () => {
    authAs(MEMBER);
    const res = await submit(REG_A, {
      ...validCard,
      contributionIds: [CONTRIB_OTHER_USER],
    });
    expect(res.status).toBe(403);
    expect(submissions()).toHaveLength(0);
  });

  it("lets a registration-managing organizer cover another user's chip-in", async () => {
    authAs(REGISTRAR);
    const res = await submit(REG_A, {
      ...validCard,
      contributionIds: [CONTRIB_OTHER_USER],
    });
    expect(res.status).toBe(201);
    expect(res.body.contributionIds).toEqual([CONTRIB_OTHER_USER]);
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

describe("POST /registrations/:id/transfer — fund solvency guard", () => {
  it("rejects a payment transfer that would unpay a chip-in already spent from the fund", async () => {
    seed();
    // REG_A is paid and carries a paid registration-source chip-in that the
    // organizers have already fully allocated from the fund.
    const regA = state.rows.registrations.find((r: any) => r.id === REG_A)!;
    regA.paymentStatus = "paid";
    state.rows.sponsorship_contributions = [
      {
        id: 970,
        reunionId: REUNION_ID,
        registrationId: REG_A,
        contributorUserId: MEMBER,
        contributorName: null,
        amount: 100,
        source: "registration",
        paymentStatus: "paid",
        createdAt: new Date("2026-02-05").toISOString(),
      },
    ];
    state.rows.sponsorship_allocations = [
      {
        id: 971,
        reunionId: REUNION_ID,
        registrationId: REG_B,
        amount: 100,
        fundedFrom: "fund",
        sponsorName: null,
        note: null,
        createdBy: OWNER,
        createdAt: new Date("2026-02-06").toISOString(),
      },
    ];
    authAs(MEMBER);
    const res = await request(buildApp())
      .post(`/api/registrations/${REG_A}/transfer`)
      .send({ kind: "payment", targetRegistrationId: REG_B });
    expect(res.status).toBe(400);
  });

  it("allows a payment transfer when the fund stays solvent", async () => {
    seed();
    const regA = state.rows.registrations.find((r: any) => r.id === REG_A)!;
    regA.paymentStatus = "paid";
    state.rows.sponsorship_contributions = [];
    state.rows.sponsorship_allocations = [];
    authAs(MEMBER);
    const res = await request(buildApp())
      .post(`/api/registrations/${REG_A}/transfer`)
      .send({ kind: "payment", targetRegistrationId: REG_B });
    expect(res.status).toBe(200);
    expect(state.rows.registrations.find((r: any) => r.id === REG_B)!.paymentStatus).toBe("paid");
  });
});
