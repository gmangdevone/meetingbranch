import { describe, it, expect, beforeEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

// ──────────────────────────────────────────────────────────────────────────────
// Role-delegation authorization matrix. Co-organizers hold a set of `roles`;
// each management area is gated to its role (owner + platform admin bypass all).
// Organizer management (add/remove/roles/transfer) is owner-only. These tests
// drive the real Express handler + middleware chain against an in-memory fake of
// @workspace/db, mirroring reunions.organizers.test.ts.
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
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    kind: "sql",
    strings: Array.from(strings),
    values,
  }),
}));

vi.mock("@workspace/db", () => {
  const tables = {
    users: ["id", "email", "firstName", "lastName", "isAdmin", "createdAt"],
    reunions: [
      "id",
      "code",
      "name",
      "startDate",
      "endDate",
      "paymentHandle",
      "paymentUrl",
      "organizerId",
      "createdAt",
    ],
    reunion_organizers: ["id", "reunionId", "userId", "roles", "createdAt"],
    reunion_branches: ["id", "reunionId", "name", "sortOrder"],
    reunion_fees: [
      "id",
      "reunionId",
      "label",
      "chargeType",
      "isOptional",
      "amount",
      "ageThreshold",
      "amountUnderThreshold",
      "sortOrder",
    ],
    registrations: [
      "id",
      "reunionId",
      "userId",
      "branchName",
      "attendeeCount",
      "paymentStatus",
      "status",
    ],
    registration_fees: ["id", "registrationId", "feeId"],
    attendees: ["id", "registrationId"],
    announcements: ["id", "reunionId", "title", "body", "pinned", "createdAt"],
    schedule_items: ["id", "reunionId", "day", "sortOrder"],
    app_settings: ["id"],
    sponsorship_contributions: [
      "id",
      "reunionId",
      "contributorUserId",
      "contributorName",
      "amount",
      "source",
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
      if (token && typeof token === "object" && (token as any).kind === "sql") {
        // Aggregate placeholders (count/sum) — return 0 for empty test data.
        out[alias] = 0;
      } else if (typeof token === "string" && token.includes(".")) {
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
    _joins: Array<{ table: string; on: unknown; left?: boolean }> = [];
    _where: unknown;
    _orderBy: any[] = [];
    _limit?: number;
    _isAggregate = false;
    constructor(proj?: Record<string, unknown>) {
      this._proj = proj;
      if (proj) {
        this._isAggregate = Object.values(proj).some(
          (v) => v && typeof v === "object" && (v as any).kind === "sql",
        );
      }
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
    groupBy() {
      return this;
    }
    limit(n: number) {
      this._limit = n;
      return this._run();
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
          // LEFT JOIN keeps the row with the joined table absent (nulls).
          if (!matched && j.left) next.push({ ...s });
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
      // Aggregate selects always return a single summary row, computed over
      // the (filtered) scoped rows: count(*) and sum(col) are supported.
      if (this._isAggregate) {
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
      const created = list.map((v) => {
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
    // Raw SQL (e.g. SELECT ... FOR UPDATE row locks) is a no-op in the fake.
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
    announcementsTable: "announcements",
    scheduleItemsTable: "schedule_items",
    appSettingsTable: "app_settings",
    sponsorshipContributionsTable: "sponsorship_contributions",
    sponsorshipAllocationsTable: "sponsorship_allocations",
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

const { default: reunionsRouter } = await import("./reunions");

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api", reunionsRouter);
  return app;
}

const OWNER = "user_owner";
const ADMIN = "user_admin";
const CO = "user_co";
const OUTSIDER = "user_outsider";
const REUNION_ID = 200;

function authAs(userId: string | null) {
  state.auth = userId
    ? { userId, sessionClaims: { userId } }
    : { userId: null, sessionClaims: null };
}

/** Seeds a reunion owned by OWNER plus a single co-organizer CO with `roles`. */
function seed(roles: string[]) {
  state.rows = {
    users: [
      { id: OWNER, email: "owner@example.com", firstName: "O", lastName: "W", isAdmin: false },
      { id: ADMIN, email: "admin@example.com", firstName: "A", lastName: "D", isAdmin: true },
      { id: CO, email: "co@example.com", firstName: "C", lastName: "O", isAdmin: false },
      { id: OUTSIDER, email: "out@example.com", firstName: "X", lastName: "Y", isAdmin: false },
    ],
    reunions: [
      {
        id: REUNION_ID,
        code: "ABC1234",
        name: "Test Reunion",
        startDate: "2026-08-01",
        endDate: "2026-08-03",
        paymentHandle: "@t",
        paymentUrl: null,
        registrationsOpen: true,
        organizerId: OWNER,
        createdAt: new Date("2026-01-01").toISOString(),
      },
    ],
    reunion_organizers: [
      { id: 1, reunionId: REUNION_ID, userId: CO, roles, createdAt: new Date("2026-01-02").toISOString() },
    ],
    reunion_branches: [],
    reunion_fees: [],
    registrations: [],
    registration_fees: [],
    attendees: [],
    announcements: [],
    schedule_items: [],
    app_settings: [],
    sponsorship_contributions: [],
    sponsorship_allocations: [],
  };
  state.seq = 1000;
}

// Representative endpoint per management area. GETs where an area has one; a
// write otherwise (middleware runs before body validation, so denied → 403).
const app = () => request(buildApp());
const hit = {
  registration: () => app().get(`/api/reunions/${REUNION_ID}/registrations`),
  reports: () => app().get(`/api/reunions/${REUNION_ID}/reports`),
  branches: () => app().post(`/api/reunions/${REUNION_ID}/branches`).send({ name: "B" }),
  announcements: () =>
    app().post(`/api/reunions/${REUNION_ID}/announcements`).send({ title: "T", body: "B" }),
  schedule: () => app().post(`/api/reunions/${REUNION_ID}/schedule`).send({ day: "Fri" }),
  power_user: () =>
    app()
      .put(`/api/reunions/${REUNION_ID}`)
      .send({
        name: "New",
        startDate: "2026-08-01",
        endDate: "2026-08-03",
        paymentHandle: "@t",
      }),
} as const;

type Area = keyof typeof hit;
const ALL_AREAS: Area[] = [
  "registration",
  "reports",
  "branches",
  "announcements",
  "schedule",
  "power_user",
];

describe("co-organizer area role gating", () => {
  beforeEach(() => {
    state.auth = null;
  });

  for (const area of ALL_AREAS) {
    it(`grants only the "${area}" area to a co-organizer who holds just that role`, async () => {
      seed([area]);
      authAs(CO);

      // The matching area is permitted (not blocked by the role guard).
      const allowed = await hit[area]();
      expect(allowed.status).not.toBe(403);

      // Every other area is forbidden.
      for (const other of ALL_AREAS.filter((a) => a !== area)) {
        const denied = await hit[other]();
        expect(denied.status).toBe(403);
      }
    });
  }

  it("blocks a co-organizer with NO roles from every area", async () => {
    seed([]);
    authAs(CO);
    for (const area of ALL_AREAS) {
      const res = await hit[area]();
      expect(res.status).toBe(403);
    }
  });

  it("still lets a no-role co-organizer load the reunion shell (GET detail)", async () => {
    seed([]);
    authAs(CO);
    const res = await app().get(`/api/reunions/${REUNION_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.viewer).toMatchObject({
      isOwner: false,
      isAdmin: false,
      canManageOrganizers: false,
      roles: [],
    });
  });

  it("reports every role in the viewer permissions for the detail endpoint", async () => {
    seed(["registration", "reports"]);
    authAs(CO);
    const res = await app().get(`/api/reunions/${REUNION_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.viewer.roles.sort()).toEqual(["registration", "reports"]);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Exhaustive endpoint matrix: every role-guarded route in each area, tested for
// both the denied (403 without the role) and allowed (no 403 with it) case.
// The representative-per-area tests above prove areas are mutually exclusive;
// this proves no individual endpoint slipped past its area's guard.
// ──────────────────────────────────────────────────────────────────────────────
type Endpoint = {
  name: string;
  send: () => request.Test;
};

const ENDPOINTS: Record<Area, Endpoint[]> = {
  registration: [
    { name: "GET /registrations", send: () => app().get(`/api/reunions/${REUNION_ID}/registrations`) },
    {
      name: "POST /registrations",
      send: () => app().post(`/api/reunions/${REUNION_ID}/registrations`).send({}),
    },
    {
      name: "GET /registrations/export",
      send: () => app().get(`/api/reunions/${REUNION_ID}/registrations/export`),
    },
    {
      name: "PATCH /registrations/:id/payment",
      send: () =>
        app().patch(`/api/reunions/${REUNION_ID}/registrations/1/payment`).send({}),
    },
    {
      name: "POST /registrations/:id/cancel",
      send: () => app().post(`/api/reunions/${REUNION_ID}/registrations/1/cancel`).send({}),
    },
  ],
  reports: [
    { name: "GET /reports", send: () => app().get(`/api/reunions/${REUNION_ID}/reports`) },
  ],
  announcements: [
    {
      name: "POST /announcements",
      send: () =>
        app().post(`/api/reunions/${REUNION_ID}/announcements`).send({ title: "T", body: "B" }),
    },
    {
      name: "PUT /announcements/:id",
      send: () => app().put(`/api/reunions/${REUNION_ID}/announcements/1`).send({}),
    },
    {
      name: "DELETE /announcements/:id",
      send: () => app().delete(`/api/reunions/${REUNION_ID}/announcements/1`),
    },
  ],
  schedule: [
    {
      name: "POST /schedule",
      send: () => app().post(`/api/reunions/${REUNION_ID}/schedule`).send({ day: "Fri" }),
    },
    {
      name: "PUT /schedule/:id",
      send: () => app().put(`/api/reunions/${REUNION_ID}/schedule/1`).send({}),
    },
    {
      name: "DELETE /schedule/:id",
      send: () => app().delete(`/api/reunions/${REUNION_ID}/schedule/1`),
    },
  ],
  branches: [
    {
      name: "POST /branches",
      send: () => app().post(`/api/reunions/${REUNION_ID}/branches`).send({ name: "B" }),
    },
    {
      name: "PUT /branches/:id",
      send: () => app().put(`/api/reunions/${REUNION_ID}/branches/1`).send({}),
    },
    {
      name: "DELETE /branches/:id",
      send: () => app().delete(`/api/reunions/${REUNION_ID}/branches/1`),
    },
  ],
  power_user: [
    {
      name: "PUT /reunions/:id (settings)",
      send: () =>
        app().put(`/api/reunions/${REUNION_ID}`).send({
          name: "New",
          startDate: "2026-08-01",
          endDate: "2026-08-03",
          paymentHandle: "@t",
        }),
    },
    {
      name: "POST /fees",
      send: () => app().post(`/api/reunions/${REUNION_ID}/fees`).send({}),
    },
    {
      name: "PUT /fees/:id",
      send: () => app().put(`/api/reunions/${REUNION_ID}/fees/1`).send({}),
    },
    {
      name: "DELETE /fees/:id",
      send: () => app().delete(`/api/reunions/${REUNION_ID}/fees/1`),
    },
    {
      name: "GET /sponsorship",
      send: () => app().get(`/api/reunions/${REUNION_ID}/sponsorship`),
    },
    {
      name: "POST /sponsorship/allocations",
      send: () => app().post(`/api/reunions/${REUNION_ID}/sponsorship/allocations`).send({}),
    },
  ],
};

describe.each(ALL_AREAS)('every "%s" endpoint enforces its role guard', (area) => {
  beforeEach(() => {
    state.auth = null;
  });

  for (const ep of ENDPOINTS[area]) {
    it(`${ep.name}: 403 for a co-organizer without "${area}"`, async () => {
      // Holds every OTHER role, so this is specifically the missing-role case.
      seed(ALL_AREAS.filter((a) => a !== area));
      authAs(CO);
      const res = await ep.send();
      expect(res.status).toBe(403);
    });

    it(`${ep.name}: not blocked for a co-organizer with "${area}"`, async () => {
      seed([area]);
      authAs(CO);
      const res = await ep.send();
      expect(res.status).not.toBe(403);
    });
  }
});

describe("owner and platform admin bypass all role checks", () => {
  beforeEach(() => {
    state.auth = null;
  });

  it("lets the owner into every area", async () => {
    seed([]);
    authAs(OWNER);
    for (const area of ALL_AREAS) {
      const res = await hit[area]();
      expect(res.status).not.toBe(403);
    }
  });

  it("lets a platform admin (not owner, not co-organizer) into every area", async () => {
    seed([]);
    authAs(ADMIN);
    for (const area of ALL_AREAS) {
      const res = await hit[area]();
      expect(res.status).not.toBe(403);
    }
  });

  it("marks the owner's viewer with full permissions", async () => {
    seed([]);
    authAs(OWNER);
    const res = await app().get(`/api/reunions/${REUNION_ID}`);
    expect(res.body.viewer).toMatchObject({ isOwner: true, canManageOrganizers: true });
    expect(res.body.viewer.roles.sort()).toEqual(
      ["announcements", "branches", "power_user", "registration", "reports", "schedule"],
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Sponsorship fund: authorized viewers can actually read the fund and apply
// allocations end-to-end (not just pass the guard).
// ──────────────────────────────────────────────────────────────────────────────
describe("sponsorship fund works end-to-end for authorized organizers", () => {
  const REG_ID = 501;

  /** Seed a fund contribution of 100 and one active registration by OUTSIDER. */
  function seedSponsorship(roles: string[]) {
    seed(roles);
    state.rows.registrations = [
      {
        id: REG_ID,
        reunionId: REUNION_ID,
        userId: OUTSIDER,
        branchName: "Branch A",
        attendeeCount: 3,
        paymentStatus: "unpaid",
        status: "active",
      },
    ];
    state.rows.sponsorship_contributions = [
      {
        id: 900,
        reunionId: REUNION_ID,
        contributorUserId: OUTSIDER,
        contributorName: "Aunt X",
        amount: 100,
        source: "direct",
        createdAt: new Date("2026-02-01").toISOString(),
      },
    ];
  }

  beforeEach(() => {
    state.auth = null;
  });

  const viewers: Array<[string, string, string[]]> = [
    ["a power_user co-organizer", CO, ["power_user"]],
    ["the owner", OWNER, []],
    ["a platform admin", ADMIN, []],
  ];

  for (const [label, userId, roles] of viewers) {
    it(`lets ${label} read the fund balance and ledger`, async () => {
      seedSponsorship(roles);
      authAs(userId);
      const res = await app().get(`/api/reunions/${REUNION_ID}/sponsorship`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        balance: 100,
        totalContributed: 100,
        totalAllocated: 0,
      });
      expect(res.body.contributions).toHaveLength(1);
      expect(res.body.allocations).toEqual([]);
    });

    it(`lets ${label} create a fund allocation`, async () => {
      seedSponsorship(roles);
      authAs(userId);
      const res = await app()
        .post(`/api/reunions/${REUNION_ID}/sponsorship/allocations`)
        .send({ registrationId: REG_ID, amount: 40, fundedFrom: "fund" });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        balance: 60,
        totalContributed: 100,
        totalAllocated: 40,
      });
      expect(res.body.allocations).toHaveLength(1);
      expect(res.body.allocations[0]).toMatchObject({
        registrationId: REG_ID,
        amount: 40,
        fundedFrom: "fund",
        branchName: "Branch A",
        registrantEmail: "out@example.com",
      });
      expect(state.rows.sponsorship_allocations).toHaveLength(1);
      expect(state.rows.sponsorship_allocations[0]).toMatchObject({
        reunionId: REUNION_ID,
        createdBy: userId,
      });
    });
  }

  it("rejects a fund allocation that exceeds the balance", async () => {
    seedSponsorship(["power_user"]);
    authAs(CO);
    const res = await app()
      .post(`/api/reunions/${REUNION_ID}/sponsorship/allocations`)
      .send({ registrationId: REG_ID, amount: 150, fundedFrom: "fund" });
    expect(res.status).toBe(400);
    expect(state.rows.sponsorship_allocations).toHaveLength(0);
  });

  it("rejects a zero-dollar allocation", async () => {
    seedSponsorship(["power_user"]);
    authAs(CO);
    const res = await app()
      .post(`/api/reunions/${REUNION_ID}/sponsorship/allocations`)
      .send({ registrationId: REG_ID, amount: 0, fundedFrom: "fund" });
    expect(res.status).toBe(400);
    expect(state.rows.sponsorship_allocations).toHaveLength(0);
  });

  it("rejects a negative allocation amount", async () => {
    seedSponsorship(["power_user"]);
    authAs(CO);
    const res = await app()
      .post(`/api/reunions/${REUNION_ID}/sponsorship/allocations`)
      .send({ registrationId: REG_ID, amount: -10, fundedFrom: "fund" });
    expect(res.status).toBe(400);
    expect(state.rows.sponsorship_allocations).toHaveLength(0);
  });

  it("allows a direct sponsorship without touching the fund balance", async () => {
    seedSponsorship(["power_user"]);
    authAs(CO);
    const res = await app()
      .post(`/api/reunions/${REUNION_ID}/sponsorship/allocations`)
      .send({
        registrationId: REG_ID,
        amount: 500,
        fundedFrom: "direct",
        sponsorName: "Uncle Y",
      });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ balance: 100, totalAllocated: 0 });
    expect(res.body.allocations[0]).toMatchObject({
      fundedFrom: "direct",
      sponsorName: "Uncle Y",
    });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// POST /reunions/:reunionId/sponsorship/contributions
// Any signed-in member (even a non-organizer) can chip in to the fund.
// ──────────────────────────────────────────────────────────────────────────────
describe("member contribution to sponsorship fund", () => {
  beforeEach(() => {
    state.auth = null;
    seed([]);
  });

  it("returns 201 with the created row when a signed-in non-organizer chips in", async () => {
    authAs(OUTSIDER);
    const res = await app()
      .post(`/api/reunions/${REUNION_ID}/sponsorship/contributions`)
      .send({ amount: 50, contributorName: "Aunt X" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      reunionId: REUNION_ID,
      contributorUserId: OUTSIDER,
      contributorName: "Aunt X",
      amount: 50,
      source: "direct",
    });
    // Row must be persisted in the in-memory DB.
    expect(state.rows.sponsorship_contributions).toHaveLength(1);
    expect(state.rows.sponsorship_contributions[0]).toMatchObject({
      reunionId: REUNION_ID,
      contributorUserId: OUTSIDER,
      amount: 50,
      source: "direct",
    });
  });

  it("accepts a contribution without a contributorName (anonymous chip-in)", async () => {
    authAs(OUTSIDER);
    const res = await app()
      .post(`/api/reunions/${REUNION_ID}/sponsorship/contributions`)
      .send({ amount: 25 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      amount: 25,
      source: "direct",
    });
    expect(state.rows.sponsorship_contributions).toHaveLength(1);
  });

  it("returns 404 when the reunion does not exist", async () => {
    authAs(OUTSIDER);
    const res = await app()
      .post(`/api/reunions/99999/sponsorship/contributions`)
      .send({ amount: 50 });
    expect(res.status).toBe(404);
    expect(state.rows.sponsorship_contributions).toHaveLength(0);
  });

  it("returns 400 when the body is invalid (missing amount)", async () => {
    authAs(OUTSIDER);
    const res = await app()
      .post(`/api/reunions/${REUNION_ID}/sponsorship/contributions`)
      .send({ contributorName: "No amount here" });
    expect(res.status).toBe(400);
    expect(state.rows.sponsorship_contributions).toHaveLength(0);
  });

  it("returns 400 when amount is negative", async () => {
    authAs(OUTSIDER);
    const res = await app()
      .post(`/api/reunions/${REUNION_ID}/sponsorship/contributions`)
      .send({ amount: -10 });
    expect(res.status).toBe(400);
    expect(state.rows.sponsorship_contributions).toHaveLength(0);
  });

  it("returns 400 when amount is zero", async () => {
    authAs(OUTSIDER);
    const res = await app()
      .post(`/api/reunions/${REUNION_ID}/sponsorship/contributions`)
      .send({ amount: 0 });
    expect(res.status).toBe(400);
    expect(state.rows.sponsorship_contributions).toHaveLength(0);
  });

  it("returns 401 when no user is signed in", async () => {
    state.auth = { userId: null, sessionClaims: null };
    const res = await app()
      .post(`/api/reunions/${REUNION_ID}/sponsorship/contributions`)
      .send({ amount: 50 });
    expect(res.status).toBe(401);
    expect(state.rows.sponsorship_contributions).toHaveLength(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /reunions/:reunionId/sponsorship/my-contributions
// Any signed-in member sees only their own rows; other contributors' rows are
// invisible to them; fund totals are not included.
// ──────────────────────────────────────────────────────────────────────────────
describe("GET /sponsorship/my-contributions — member contribution history", () => {
  const MEMBER = OUTSIDER;
  const OTHER = CO;

  function seedWithContributions() {
    seed([]);
    // MEMBER contributed twice; OTHER contributed once.
    state.rows.sponsorship_contributions = [
      {
        id: 901,
        reunionId: REUNION_ID,
        contributorUserId: MEMBER,
        contributorName: "Aunt X",
        amount: 50,
        source: "direct",
        createdAt: new Date("2026-03-01").toISOString(),
      },
      {
        id: 902,
        reunionId: REUNION_ID,
        contributorUserId: MEMBER,
        contributorName: null,
        amount: 75,
        source: "direct",
        createdAt: new Date("2026-03-02").toISOString(),
      },
      {
        id: 903,
        reunionId: REUNION_ID,
        contributorUserId: OTHER,
        contributorName: "Uncle Y",
        amount: 200,
        source: "direct",
        createdAt: new Date("2026-03-03").toISOString(),
      },
    ];
  }

  beforeEach(() => {
    state.auth = null;
  });

  it("returns only the calling user's own contributions (not other contributors')", async () => {
    seedWithContributions();
    authAs(MEMBER);
    const res = await app().get(
      `/api/reunions/${REUNION_ID}/sponsorship/my-contributions`,
    );
    expect(res.status).toBe(200);
    expect(res.body.contributions).toHaveLength(2);
    for (const c of res.body.contributions) {
      expect(c.contributorUserId ?? MEMBER).toBe(MEMBER);
    }
    const ids = res.body.contributions.map((c: { id: number }) => c.id).sort();
    expect(ids).toEqual([901, 902]);
  });

  it("does not expose fund totals or other contributors in the response", async () => {
    seedWithContributions();
    authAs(MEMBER);
    const res = await app().get(
      `/api/reunions/${REUNION_ID}/sponsorship/my-contributions`,
    );
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty("balance");
    expect(res.body).not.toHaveProperty("totalContributed");
    expect(res.body).not.toHaveProperty("totalAllocated");
    expect(res.body).not.toHaveProperty("allocations");
  });

  it("returns an empty list when the user has not contributed yet", async () => {
    seed([]);
    authAs(MEMBER);
    const res = await app().get(
      `/api/reunions/${REUNION_ID}/sponsorship/my-contributions`,
    );
    expect(res.status).toBe(200);
    expect(res.body.contributions).toEqual([]);
  });

  it("returns 401 when unauthenticated", async () => {
    seed([]);
    state.auth = { userId: null, sessionClaims: null };
    const res = await app().get(
      `/api/reunions/${REUNION_ID}/sponsorship/my-contributions`,
    );
    expect(res.status).toBe(401);
  });

  it("returns 404 when the reunion does not exist", async () => {
    seed([]);
    authAs(MEMBER);
    const res = await app().get(
      `/api/reunions/99999/sponsorship/my-contributions`,
    );
    expect(res.status).toBe(404);
  });

  it("allows a co-organizer to see only their own contributions (not all contributions)", async () => {
    seedWithContributions();
    authAs(OTHER);
    const res = await app().get(
      `/api/reunions/${REUNION_ID}/sponsorship/my-contributions`,
    );
    expect(res.status).toBe(200);
    expect(res.body.contributions).toHaveLength(1);
    expect(res.body.contributions[0].id).toBe(903);
  });
});

describe("organizer management is owner-only (Power User cannot)", () => {
  beforeEach(() => {
    state.auth = null;
  });

  it("forbids a Power User co-organizer from adding an organizer", async () => {
    seed(["power_user"]);
    authAs(CO);
    const res = await app()
      .post(`/api/reunions/${REUNION_ID}/organizers`)
      .send({ email: "out@example.com" });
    expect(res.status).toBe(403);
    expect(state.rows.reunion_organizers).toHaveLength(1);
  });

  it("forbids a Power User co-organizer from updating another's roles", async () => {
    seed(["power_user"]);
    authAs(CO);
    const res = await app()
      .put(`/api/reunions/${REUNION_ID}/organizers/${OUTSIDER}/roles`)
      .send({ roles: ["registration"] });
    expect(res.status).toBe(403);
  });

  it("forbids a Power User co-organizer from listing organizers", async () => {
    seed(["power_user"]);
    authAs(CO);
    const res = await app().get(`/api/reunions/${REUNION_ID}/organizers`);
    expect(res.status).toBe(403);
  });
});

describe("owner assigns and updates co-organizer roles", () => {
  beforeEach(() => {
    state.auth = null;
  });

  it("persists roles when adding a co-organizer by email", async () => {
    seed([]);
    // Remove the seeded CO so we add a fresh one with roles.
    state.rows.reunion_organizers = [];
    authAs(OWNER);
    const res = await app()
      .post(`/api/reunions/${REUNION_ID}/organizers`)
      .send({ email: "co@example.com", roles: ["announcements", "schedule"] });
    expect(res.status).toBe(201);
    expect(res.body.roles.sort()).toEqual(["announcements", "schedule"]);
    const row = state.rows.reunion_organizers.find((r) => r.userId === CO);
    expect((row?.roles as string[]).sort()).toEqual(["announcements", "schedule"]);
  });

  it("updates an existing co-organizer's roles", async () => {
    seed(["registration"]);
    authAs(OWNER);
    const res = await app()
      .put(`/api/reunions/${REUNION_ID}/organizers/${CO}/roles`)
      .send({ roles: ["reports", "power_user"] });
    expect(res.status).toBe(200);
    expect(res.body.roles.sort()).toEqual(["power_user", "reports"]);
    const row = state.rows.reunion_organizers.find((r) => r.userId === CO);
    expect((row?.roles as string[]).sort()).toEqual(["power_user", "reports"]);
  });

  it("allows clearing a co-organizer back to zero roles (revocation-to-none)", async () => {
    seed(["registration", "reports"]);
    authAs(OWNER);
    const res = await app()
      .put(`/api/reunions/${REUNION_ID}/organizers/${CO}/roles`)
      .send({ roles: [] });
    expect(res.status).toBe(200);
    expect(res.body.roles).toEqual([]);
    const row = state.rows.reunion_organizers.find((r) => r.userId === CO);
    expect(row?.roles).toEqual([]);
  });

  it("lets a platform admin (not the owner) update a co-organizer's roles", async () => {
    seed(["registration"]);
    authAs(ADMIN);
    const res = await app()
      .put(`/api/reunions/${REUNION_ID}/organizers/${CO}/roles`)
      .send({ roles: ["schedule"] });
    expect(res.status).toBe(200);
    expect(res.body.roles).toEqual(["schedule"]);
  });

  it("returns 404 updating roles for someone who isn't a co-organizer", async () => {
    seed(["registration"]);
    authAs(OWNER);
    const res = await app()
      .put(`/api/reunions/${REUNION_ID}/organizers/${OUTSIDER}/roles`)
      .send({ roles: ["reports"] });
    expect(res.status).toBe(404);
  });

  it("rejects assigning roles to the owner", async () => {
    seed(["registration"]);
    authAs(OWNER);
    const res = await app()
      .put(`/api/reunions/${REUNION_ID}/organizers/${OWNER}/roles`)
      .send({ roles: ["reports"] });
    expect(res.status).toBe(400);
  });
});
