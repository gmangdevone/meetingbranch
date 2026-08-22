import { describe, it, expect, beforeEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

// ──────────────────────────────────────────────────────────────────────────────
// GET /reunions/:reunionId/payment-submissions — submitter name/email resolution.
//
// The handler joins the users table to resolve submittedByName and
// submittedByEmail for each payment submission. These tests confirm that:
//   1. When the submitter user row exists, the response fields are populated.
//   2. When the submitter user row is missing (deleted or orphaned), both
//      fields are returned as null without erroring.
//
// Follows the same in-memory fake-db pattern as registrations.payment-submissions.test.ts.
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
    users: ["id", "email", "firstName", "lastName", "isAdmin", "isManaged", "createdAt"],
    reunions: ["id", "code", "name", "organizerId", "registrationsOpen", "createdAt"],
    reunion_organizers: ["id", "reunionId", "userId", "roles", "createdAt"],
    reunion_branches: ["id", "reunionId", "name", "sortOrder"],
    reunion_fees: ["id", "reunionId", "label", "chargeType", "isOptional", "amount", "sortOrder"],
    registrations: ["id", "reunionId", "userId", "branchName", "attendeeCount", "paymentStatus", "status", "createdAt"],
    attendees: ["id", "registrationId", "name", "shirtSize"],
    sponsorship_contributions: [
      "id", "reunionId", "registrationId", "contributorUserId", "contributorName",
      "amount", "source", "paymentStatus", "createdAt",
    ],
    sponsorship_allocations: ["id", "reunionId", "registrationId", "amount", "fundedFrom", "sponsorName", "note", "createdBy", "createdAt"],
    payment_submissions: [
      "id", "reunionId", "registrationId", "registrationIds", "contributionIds",
      "submittedBy", "method", "reference", "givenDate", "note", "amount", "createdAt",
    ],
    app_settings: ["id", "reunionCreationEnabled"],
    announcements: ["id", "reunionId", "title", "body", "pinned", "createdAt"],
    schedule_items: ["id", "reunionId", "day", "startTime", "sortOrder"],
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

  const evalExpr = (expr: any, scoped: Record<string, Record<string, unknown>>): boolean => {
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
        if (!spec?.col) continue;
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
    onConflictDoUpdate({ set }: { target: unknown; set: Record<string, unknown> }) {
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
    announcementsTable: "announcements",
    scheduleItemsTable: "schedule_items",
    appSettingsTable: "app_settings",
  };
  for (const [exportName, tableName] of Object.entries(tableExports)) {
    if (tables[tableName as keyof typeof tables]) {
      tokens[exportName] = makeToken(tableName, tables[tableName as keyof typeof tables]);
    }
  }
  tokens.REUNION_ROLES = [
    "registration",
    "announcements",
    "schedule",
    "branches",
    "reports",
    "scout",
    "power_user",
  ];
  return tokens;
});

// ── Import the reunions router after all mocks are in place ───────────────────
const { default: reunionsRouter } = await import("./reunions");

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api", reunionsRouter);
  return app;
}

// ── Test constants ────────────────────────────────────────────────────────────
const OWNER       = "user_owner";      // reunion owner (organizerId)
const SUBMITTER   = "user_submitter";  // submitter whose user row exists
const GHOST_ID    = "user_ghost";      // submitter whose user row is absent
const REUNION_ID  = 10;

const SUB_WITH_SUBMITTER  = 201; // payment_submission submitted by SUBMITTER (user row exists)
const SUB_WITH_GHOST      = 202; // payment_submission submitted by GHOST_ID (user row absent)
const SUB_NULL_SUBMITTER  = 203; // payment_submission with submittedBy = null (legacy/bulk-import row)

function authAs(userId: string) {
  state.auth = { userId, sessionClaims: { userId } };
}

function seed() {
  state.rows = {
    users: [
      {
        id: OWNER,
        email: "owner@example.com",
        firstName: "Organizer",
        lastName: "One",
        isAdmin: false,
        isManaged: false,
      },
      {
        id: SUBMITTER,
        email: "submitter@example.com",
        firstName: "Alice",
        lastName: "Smith",
        isAdmin: false,
        isManaged: false,
      },
      // GHOST_ID intentionally absent from users table
    ],
    reunions: [
      {
        id: REUNION_ID,
        code: "TEST001",
        name: "Test Reunion",
        organizerId: OWNER,
        registrationsOpen: true,
        createdAt: new Date("2026-01-01").toISOString(),
      },
    ],
    reunion_organizers: [],
    reunion_branches: [],
    reunion_fees: [],
    registrations: [],
    attendees: [],
    sponsorship_contributions: [],
    sponsorship_allocations: [],
    payment_submissions: [
      {
        id: SUB_WITH_SUBMITTER,
        reunionId: REUNION_ID,
        registrationId: null,
        registrationIds: [],
        contributionIds: [],
        submittedBy: SUBMITTER,
        method: "check",
        reference: null,
        givenDate: null,
        note: "Dropped off check",
        amount: 100,
        createdAt: new Date("2026-03-01").toISOString(),
      },
      {
        id: SUB_WITH_GHOST,
        reunionId: REUNION_ID,
        registrationId: null,
        registrationIds: [],
        contributionIds: [],
        submittedBy: GHOST_ID,
        method: "cashapp",
        reference: "$ghost",
        givenDate: null,
        note: "Unknown submitter",
        amount: 50,
        createdAt: new Date("2026-03-02").toISOString(),
      },
      {
        id: SUB_NULL_SUBMITTER,
        reunionId: REUNION_ID,
        registrationId: null,
        registrationIds: [],
        contributionIds: [],
        submittedBy: null, // legacy / bulk-import row — DB column is nullable
        method: "cash",
        reference: null,
        givenDate: null,
        note: "Imported record with no submitter",
        amount: 25,
        createdAt: new Date("2026-03-03").toISOString(),
      },
    ],
    announcements: [],
    schedule_items: [],
    app_settings: [],
  };
  state.seq = 500;
}

const getSubmissions = () =>
  request(buildApp()).get(`/api/reunions/${REUNION_ID}/payment-submissions`);

beforeEach(() => {
  state.auth = null;
  seed();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /reunions/:reunionId/payment-submissions — submitter name resolution", () => {
  it("populates submittedByName and submittedByEmail when the submitter user row exists", async () => {
    authAs(OWNER);
    const res = await getSubmissions();

    expect(res.status).toBe(200);
    const sub = res.body.submissions.find((s: any) => s.id === SUB_WITH_SUBMITTER);
    expect(sub).toBeDefined();
    expect(sub.submittedByName).toBe("Alice Smith");
    expect(sub.submittedByEmail).toBe("submitter@example.com");
  });

  it("returns null for submittedByName and submittedByEmail when the submitter user row is missing", async () => {
    authAs(OWNER);
    const res = await getSubmissions();

    expect(res.status).toBe(200);
    const sub = res.body.submissions.find((s: any) => s.id === SUB_WITH_GHOST);
    expect(sub).toBeDefined();
    expect(sub.submittedByName).toBeNull();
    expect(sub.submittedByEmail).toBeNull();
  });

  it("returns 200 (not 500) when a submission has a null submittedBy in the DB", async () => {
    authAs(OWNER);
    const res = await getSubmissions();

    expect(res.status).toBe(200);
    const sub = res.body.submissions.find((s: any) => s.id === SUB_NULL_SUBMITTER);
    expect(sub).toBeDefined();
    expect(sub.submittedBy).toBeNull();
    expect(sub.submittedByName).toBeNull();
    expect(sub.submittedByEmail).toBeNull();
  });

  it("returns all submissions in the response", async () => {
    authAs(OWNER);
    const res = await getSubmissions();

    expect(res.status).toBe(200);
    expect(res.body.submissions).toHaveLength(3);
  });

  it("returns 401 when the caller is not authenticated", async () => {
    // No authAs — state.auth remains null
    const res = await getSubmissions();
    expect(res.status).toBe(401);
  });

  it("returns 403 when the caller has no access to the reunion", async () => {
    authAs("user_stranger");
    const res = await getSubmissions();
    expect(res.status).toBe(403);
  });
});
