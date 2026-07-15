import { describe, it, expect, beforeEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

// ──────────────────────────────────────────────────────────────────────────────
// Poll voting rules. Only active reunion members may view polls; only members
// with a checked-in attendee may vote; ballots cannot exceed the poll's vote
// limit; closed polls reject votes; a re-submitted ballot replaces the old one;
// and polls can never drop below two options. These tests drive the real
// Express handlers + middleware against an in-memory fake of @workspace/db,
// mirroring reunions.permissions.test.ts.
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
    reunions: ["id", "code", "name", "organizerId", "createdAt"],
    reunion_organizers: ["id", "reunionId", "userId", "roles", "createdAt"],
    registrations: ["id", "reunionId", "userId", "status"],
    attendees: ["id", "registrationId", "checkedInAt"],
    polls: [
      "id",
      "reunionId",
      "question",
      "maxVotesPerMember",
      "isOpen",
      "resultsRevealed",
      "liveResults",
      "createdAt",
    ],
    poll_options: ["id", "pollId", "label", "position"],
    poll_votes: ["id", "pollId", "optionId", "userId"],
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
    if (table === "polls") {
      if (row.isOpen === undefined) row.isOpen = true;
      if (row.resultsRevealed === undefined) row.resultsRevealed = false;
      if (row.liveResults === undefined) row.liveResults = false;
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
      // Row locking is a no-op against the in-memory fake.
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
      // FK cascade: deleting a poll option removes its votes (mirrors schema).
      if (this._table === "poll_options" && deleted.length) {
        const gone = new Set(deleted.map((d) => d.id));
        state.rows.poll_votes = (state.rows.poll_votes ?? []).filter(
          (v) => !gone.has(v.optionId),
        );
      }
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
    registrationsTable: "registrations",
    attendeesTable: "attendees",
    pollsTable: "polls",
    pollOptionsTable: "poll_options",
    pollVotesTable: "poll_votes",
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

const { default: pollsRouter } = await import("./polls");

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api", pollsRouter);
  return app;
}

const OWNER = "user_owner";
const VOTER = "user_voter"; // active registration, checked in
const NOT_CHECKED_IN = "user_pending"; // active registration, NOT checked in
const OUTSIDER = "user_outsider"; // no registration at all
const REUNION_ID = 300;
const POLL_ID = 500;
const OPT_A = 501;
const OPT_B = 502;
const OPT_C = 503;

function authAs(userId: string | null) {
  state.auth = userId
    ? { userId, sessionClaims: { userId } }
    : { userId: null, sessionClaims: null };
}

/** Seeds one reunion, one open poll (3 options, limit 2), and the three member archetypes. */
function seed(pollOverrides: Record<string, unknown> = {}) {
  state.rows = {
    users: [
      { id: OWNER, email: "owner@example.com", firstName: "O", lastName: "W", isAdmin: false },
      { id: VOTER, email: "voter@example.com", firstName: "V", lastName: "T", isAdmin: false },
      { id: NOT_CHECKED_IN, email: "p@example.com", firstName: "P", lastName: "N", isAdmin: false },
      { id: OUTSIDER, email: "out@example.com", firstName: "X", lastName: "Y", isAdmin: false },
    ],
    reunions: [
      {
        id: REUNION_ID,
        code: "ABC1234",
        name: "Test Reunion",
        organizerId: OWNER,
        createdAt: new Date("2026-01-01").toISOString(),
      },
    ],
    reunion_organizers: [],
    registrations: [
      { id: 1, reunionId: REUNION_ID, userId: VOTER, status: "active" },
      { id: 2, reunionId: REUNION_ID, userId: NOT_CHECKED_IN, status: "active" },
    ],
    attendees: [
      { id: 11, registrationId: 1, checkedInAt: new Date("2026-07-01").toISOString() },
      { id: 21, registrationId: 2, checkedInAt: null },
    ],
    polls: [
      {
        id: POLL_ID,
        reunionId: REUNION_ID,
        question: "Saturday dinner?",
        maxVotesPerMember: 2,
        isOpen: true,
        resultsRevealed: false,
        liveResults: false,
        createdAt: new Date("2026-06-01").toISOString(),
        ...pollOverrides,
      },
    ],
    poll_options: [
      { id: OPT_A, pollId: POLL_ID, label: "BBQ", position: 0 },
      { id: OPT_B, pollId: POLL_ID, label: "Tacos", position: 1 },
      { id: OPT_C, pollId: POLL_ID, label: "Pizza", position: 2 },
    ],
    poll_votes: [],
  };
  state.seq = 1000;
}

const app = () => request(buildApp());
const viewPolls = () => app().get(`/api/reunions/${REUNION_ID}/polls`);
const vote = (optionIds: number[]) =>
  app().put(`/api/reunions/${REUNION_ID}/polls/${POLL_ID}/votes`).send({ optionIds });
const myVoteRows = (userId: string) =>
  (state.rows.poll_votes ?? []).filter((v) => v.userId === userId);

beforeEach(() => {
  state.auth = null;
  seed();
});

describe("membership gate on viewing polls", () => {
  it("blocks a non-member from viewing polls", async () => {
    authAs(OUTSIDER);
    const res = await viewPolls();
    expect(res.status).toBe(403);
  });

  it("blocks an unauthenticated caller", async () => {
    const res = await viewPolls();
    expect(res.status).toBe(401);
  });

  it("lets a member view polls; only checked-in members are marked eligible", async () => {
    authAs(NOT_CHECKED_IN);
    const notIn = await viewPolls();
    expect(notIn.status).toBe(200);
    expect(notIn.body.eligible).toBe(false);
    expect(notIn.body.polls[0].canVote).toBe(false);

    authAs(VOTER);
    const checkedIn = await viewPolls();
    expect(checkedIn.status).toBe(200);
    expect(checkedIn.body.eligible).toBe(true);
    expect(checkedIn.body.polls[0].canVote).toBe(true);
  });

  it("hides vote counts from members until results are revealed or live", async () => {
    authAs(VOTER);
    const hidden = await viewPolls();
    expect(hidden.body.polls[0].results).toBeUndefined();

    seed({ liveResults: true });
    const live = await viewPolls();
    expect(live.body.polls[0].results).toHaveLength(3);
  });
});

describe("voting eligibility", () => {
  it("blocks a non-member from voting", async () => {
    authAs(OUTSIDER);
    const res = await vote([OPT_A]);
    expect(res.status).toBe(403);
    expect(state.rows.poll_votes).toHaveLength(0);
  });

  it("blocks a member who is not checked in from voting", async () => {
    authAs(NOT_CHECKED_IN);
    const res = await vote([OPT_A]);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/checked-in/i);
    expect(state.rows.poll_votes).toHaveLength(0);
  });

  it("lets a checked-in member cast a ballot", async () => {
    authAs(VOTER);
    const res = await vote([OPT_A]);
    expect(res.status).toBe(200);
    expect(res.body.myOptionIds).toEqual([OPT_A]);
    expect(myVoteRows(VOTER)).toHaveLength(1);
  });
});

describe("ballot validation", () => {
  it("rejects a ballot that exceeds the poll's vote limit", async () => {
    authAs(VOTER);
    const res = await vote([OPT_A, OPT_B, OPT_C]); // limit is 2
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at most 2/);
    expect(state.rows.poll_votes).toHaveLength(0);
  });

  it("deduplicates repeated option ids before applying the limit", async () => {
    authAs(VOTER);
    const res = await vote([OPT_A, OPT_A, OPT_A]); // 1 distinct option, limit 2
    expect(res.status).toBe(200);
    expect(res.body.myOptionIds).toEqual([OPT_A]);
    expect(myVoteRows(VOTER)).toHaveLength(1);
  });

  it("rejects votes on a closed poll", async () => {
    seed({ isOpen: false });
    authAs(VOTER);
    const res = await vote([OPT_A]);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/closed/i);
    expect(state.rows.poll_votes).toHaveLength(0);
  });

  it("rejects option ids that belong to a different poll", async () => {
    authAs(VOTER);
    const res = await vote([9999]);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unknown/i);
    expect(state.rows.poll_votes).toHaveLength(0);
  });

  it("replaces the member's previous ballot instead of stacking votes", async () => {
    authAs(VOTER);
    await vote([OPT_A]);
    const res = await vote([OPT_B, OPT_C]);
    expect(res.status).toBe(200);
    expect(res.body.myOptionIds.sort()).toEqual([OPT_B, OPT_C]);
    const rows = myVoteRows(VOTER);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.optionId).sort()).toEqual([OPT_B, OPT_C]);
  });

  it("allows clearing a ballot by submitting no options", async () => {
    authAs(VOTER);
    await vote([OPT_A]);
    const res = await vote([]);
    expect(res.status).toBe(200);
    expect(res.body.myOptionIds).toEqual([]);
    expect(myVoteRows(VOTER)).toHaveLength(0);
  });
});

describe("option minimum", () => {
  it("rejects creating a poll with fewer than two options", async () => {
    authAs(OWNER);
    const res = await app()
      .post(`/api/reunions/${REUNION_ID}/polls`)
      .send({ question: "Solo?", maxVotesPerMember: 1, options: ["Only one"] });
    expect(res.status).toBe(400);
    expect(state.rows.polls).toHaveLength(1); // nothing created
  });

  it("creates a poll with two options", async () => {
    authAs(OWNER);
    const res = await app()
      .post(`/api/reunions/${REUNION_ID}/polls`)
      .send({ question: "Pick one", maxVotesPerMember: 1, options: ["A", "B"] });
    expect(res.status).toBe(201);
    expect(res.body.options).toHaveLength(2);
  });

  it("refuses to delete an option when only two remain", async () => {
    // Drop to exactly two options first.
    state.rows.poll_options = state.rows.poll_options.filter((o) => o.id !== OPT_C);
    authAs(OWNER);
    const res = await app().delete(
      `/api/reunions/${REUNION_ID}/polls/${POLL_ID}/options/${OPT_A}`,
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/two options/i);
    expect(state.rows.poll_options).toHaveLength(2);
  });

  it("deletes an option (and its votes) when more than two remain", async () => {
    authAs(VOTER);
    await vote([OPT_C]);
    authAs(OWNER);
    const res = await app().delete(
      `/api/reunions/${REUNION_ID}/polls/${POLL_ID}/options/${OPT_C}`,
    );
    expect(res.status).toBe(204);
    expect(state.rows.poll_options).toHaveLength(2);
    expect(state.rows.poll_votes).toHaveLength(0); // cascade removed the vote
  });

  it("blocks a non-organizer from managing polls at all", async () => {
    authAs(VOTER);
    const res = await app()
      .post(`/api/reunions/${REUNION_ID}/polls`)
      .send({ question: "Q", maxVotesPerMember: 1, options: ["A", "B"] });
    expect(res.status).toBe(403);
  });
});
