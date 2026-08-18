import { describe, it, expect, beforeEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

// ──────────────────────────────────────────────────────────────────────────────
// Vendors area authorization & data scoping. Only organizers holding the
// power_user role (or the owner / a platform admin) may see or change vendors;
// vendors and contracts are strictly scoped to their reunion; approving a
// vendor stamps approvedAt and un-approving clears it; quotedCost must be
// whole dollars. Drives the real Express handlers + middleware against an
// in-memory fake of @workspace/db, mirroring polls.test.ts.
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
    vendors: [
      "id",
      "reunionId",
      "name",
      "category",
      "status",
      "contactName",
      "phone",
      "email",
      "website",
      "address",
      "quotedCost",
      "notes",
      "serviceDate",
      "serviceEndDate",
      "serviceStartTime",
      "serviceEndTime",
      "approvedAt",
      "createdAt",
    ],
    vendor_contracts: [
      "id",
      "vendorId",
      "reunionId",
      "fileName",
      "objectPath",
      "uploadedBy",
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
    if (table === "vendors") {
      if (row.status === undefined) row.status = "prospect";
      if (row.approvedAt === undefined) row.approvedAt = null;
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
      // FK cascade: deleting a vendor removes its contracts (mirrors schema).
      if (this._table === "vendors" && deleted.length) {
        const gone = new Set(deleted.map((d) => d.id));
        state.rows.vendor_contracts = (state.rows.vendor_contracts ?? []).filter(
          (c) => !gone.has(c.vendorId),
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
    vendorsTable: "vendors",
    vendorContractsTable: "vendor_contracts",
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

const { default: vendorsRouter } = await import("./vendors");

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api", vendorsRouter);
  return app;
}

const OWNER = "user_owner"; // owns REUNION_ID
const POWER = "user_power"; // co-organizer with power_user
const CO_NO_POWER = "user_limited"; // co-organizer WITHOUT power_user
const MEMBER = "user_member"; // plain user, not an organizer
const OTHER_OWNER = "user_other_owner"; // owns OTHER_REUNION_ID only
const REUNION_ID = 300;
const OTHER_REUNION_ID = 400;
const VENDOR_ID = 500; // belongs to REUNION_ID
const FOREIGN_VENDOR_ID = 600; // belongs to OTHER_REUNION_ID
const CONTRACT_ID = 510; // on VENDOR_ID
const FOREIGN_CONTRACT_ID = 610; // on FOREIGN_VENDOR_ID

function authAs(userId: string | null) {
  state.auth = userId
    ? { userId, sessionClaims: { userId } }
    : { userId: null, sessionClaims: null };
}

/** Two reunions, one vendor + contract in each, and the organizer archetypes. */
function seed() {
  state.rows = {
    users: [
      { id: OWNER, email: "owner@example.com", firstName: "O", lastName: "W", isAdmin: false },
      { id: POWER, email: "power@example.com", firstName: "P", lastName: "U", isAdmin: false },
      { id: CO_NO_POWER, email: "co@example.com", firstName: "C", lastName: "O", isAdmin: false },
      { id: MEMBER, email: "m@example.com", firstName: "M", lastName: "M", isAdmin: false },
      { id: OTHER_OWNER, email: "oo@example.com", firstName: "X", lastName: "Y", isAdmin: false },
    ],
    reunions: [
      {
        id: REUNION_ID,
        code: "ABC1234",
        name: "Test Reunion",
        organizerId: OWNER,
        createdAt: new Date("2026-01-01").toISOString(),
      },
      {
        id: OTHER_REUNION_ID,
        code: "ZZZ9999",
        name: "Other Reunion",
        organizerId: OTHER_OWNER,
        createdAt: new Date("2026-01-02").toISOString(),
      },
    ],
    reunion_organizers: [
      { id: 1, reunionId: REUNION_ID, userId: POWER, roles: ["power_user"] },
      { id: 2, reunionId: REUNION_ID, userId: CO_NO_POWER, roles: ["registration", "schedule"] },
    ],
    vendors: [
      {
        id: VENDOR_ID,
        reunionId: REUNION_ID,
        name: "Shady Grove Park",
        category: "park",
        status: "prospect",
        quotedCost: 1200,
        approvedAt: null,
        createdAt: new Date("2026-05-01").toISOString(),
      },
      {
        id: FOREIGN_VENDOR_ID,
        reunionId: OTHER_REUNION_ID,
        name: "Other Caterer",
        category: "caterer",
        status: "prospect",
        quotedCost: 800,
        approvedAt: null,
        createdAt: new Date("2026-05-02").toISOString(),
      },
    ],
    vendor_contracts: [
      {
        id: CONTRACT_ID,
        vendorId: VENDOR_ID,
        reunionId: REUNION_ID,
        fileName: "park.pdf",
        objectPath: "/objects/contracts/park.pdf",
        uploadedBy: OWNER,
        createdAt: new Date("2026-05-03").toISOString(),
      },
      {
        id: FOREIGN_CONTRACT_ID,
        vendorId: FOREIGN_VENDOR_ID,
        reunionId: OTHER_REUNION_ID,
        fileName: "caterer.pdf",
        objectPath: "/objects/contracts/caterer.pdf",
        uploadedBy: OTHER_OWNER,
        createdAt: new Date("2026-05-04").toISOString(),
      },
    ],
  };
  state.seq = 1000;
}

const app = () => request(buildApp());
const listVendors = (reunionId = REUNION_ID) => app().get(`/api/reunions/${reunionId}/vendors`);
const createVendor = (body: Record<string, unknown>, reunionId = REUNION_ID) =>
  app().post(`/api/reunions/${reunionId}/vendors`).send(body);
const updateVendor = (
  vendorId: number,
  body: Record<string, unknown>,
  reunionId = REUNION_ID,
) => app().put(`/api/reunions/${reunionId}/vendors/${vendorId}`).send(body);
const deleteVendor = (vendorId: number, reunionId = REUNION_ID) =>
  app().delete(`/api/reunions/${reunionId}/vendors/${vendorId}`);
const createContract = (
  vendorId: number,
  body: Record<string, unknown>,
  reunionId = REUNION_ID,
) => app().post(`/api/reunions/${reunionId}/vendors/${vendorId}/contracts`).send(body);
const deleteContract = (vendorId: number, contractId: number, reunionId = REUNION_ID) =>
  app().delete(`/api/reunions/${reunionId}/vendors/${vendorId}/contracts/${contractId}`);
const vendorRow = (id: number) => (state.rows.vendors ?? []).find((v) => v.id === id);

beforeEach(() => {
  state.auth = null;
  seed();
});

describe("who can enter the vendors area", () => {
  it("blocks an unauthenticated caller with 401", async () => {
    const res = await listVendors();
    expect(res.status).toBe(401);
  });

  it("blocks a non-organizer from every vendors endpoint with 403", async () => {
    authAs(MEMBER);
    expect((await listVendors()).status).toBe(403);
    expect((await createVendor({ name: "X", category: "venue" })).status).toBe(403);
    expect((await updateVendor(VENDOR_ID, { status: "approved" })).status).toBe(403);
    expect((await deleteVendor(VENDOR_ID)).status).toBe(403);
    expect(
      (await createContract(VENDOR_ID, { fileName: "a.pdf", objectPath: "/objects/a.pdf" }))
        .status,
    ).toBe(403);
    expect((await deleteContract(VENDOR_ID, CONTRACT_ID)).status).toBe(403);
    // Nothing changed underneath.
    expect(vendorRow(VENDOR_ID)?.status).toBe("prospect");
    expect(state.rows.vendors).toHaveLength(2);
    expect(state.rows.vendor_contracts).toHaveLength(2);
  });

  it("blocks a co-organizer WITHOUT power_user with 403", async () => {
    authAs(CO_NO_POWER);
    expect((await listVendors()).status).toBe(403);
    expect((await updateVendor(VENDOR_ID, { status: "approved" })).status).toBe(403);
    expect((await deleteVendor(VENDOR_ID)).status).toBe(403);
    expect(vendorRow(VENDOR_ID)?.status).toBe("prospect");
  });

  it("lets the owner and a power_user co-organizer list vendors", async () => {
    authAs(OWNER);
    const owner = await listVendors();
    expect(owner.status).toBe(200);
    expect(owner.body.vendors).toHaveLength(1);
    expect(owner.body.vendors[0].id).toBe(VENDOR_ID);

    authAs(POWER);
    const power = await listVendors();
    expect(power.status).toBe(200);
    expect(power.body.vendors.map((v: any) => v.id)).toEqual([VENDOR_ID]);
  });

  it("keeps a power_user of one reunion out of another reunion's vendors", async () => {
    authAs(POWER); // power_user on REUNION_ID only
    const res = await listVendors(OTHER_REUNION_ID);
    expect(res.status).toBe(403);
  });
});

describe("cross-reunion scoping", () => {
  it("listing never leaks the other reunion's vendors or contracts", async () => {
    authAs(OWNER);
    const res = await listVendors();
    expect(res.status).toBe(200);
    const ids = res.body.vendors.map((v: any) => v.id);
    expect(ids).not.toContain(FOREIGN_VENDOR_ID);
    const contractIds = res.body.vendors.flatMap((v: any) => v.contracts.map((c: any) => c.id));
    expect(contractIds).toEqual([CONTRACT_ID]);
  });

  it("returns 404 when updating or deleting a vendor from another reunion", async () => {
    authAs(OWNER);
    const upd = await updateVendor(FOREIGN_VENDOR_ID, { name: "Hijacked" });
    expect(upd.status).toBe(404);
    const del = await deleteVendor(FOREIGN_VENDOR_ID);
    expect(del.status).toBe(404);
    expect(vendorRow(FOREIGN_VENDOR_ID)?.name).toBe("Other Caterer");
    expect(state.rows.vendors).toHaveLength(2);
  });

  it("returns 404 when attaching a contract to another reunion's vendor", async () => {
    authAs(OWNER);
    const res = await createContract(FOREIGN_VENDOR_ID, {
      fileName: "sneak.pdf",
      objectPath: "/objects/sneak.pdf",
    });
    expect(res.status).toBe(404);
    expect(state.rows.vendor_contracts).toHaveLength(2);
  });

  it("returns 404 when deleting another reunion's contract, even via an own vendor id", async () => {
    authAs(OWNER);
    // Foreign vendor path segment: blocked by vendor scoping.
    const viaForeignVendor = await deleteContract(FOREIGN_VENDOR_ID, FOREIGN_CONTRACT_ID);
    expect(viaForeignVendor.status).toBe(404);
    // Own vendor path segment but a contract that belongs to the foreign vendor.
    const viaOwnVendor = await deleteContract(VENDOR_ID, FOREIGN_CONTRACT_ID);
    expect(viaOwnVendor.status).toBe(404);
    expect(state.rows.vendor_contracts).toHaveLength(2);
  });
});

describe("approval lifecycle", () => {
  it("approving stamps approvedAt", async () => {
    authAs(POWER);
    const res = await updateVendor(VENDOR_ID, { status: "approved" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("approved");
    expect(res.body.approvedAt).toBeTruthy();
    expect(vendorRow(VENDOR_ID)?.approvedAt).toBeInstanceOf(Date);
  });

  it("moving an approved vendor back to prospect clears approvedAt", async () => {
    authAs(POWER);
    await updateVendor(VENDOR_ID, { status: "approved" });
    const res = await updateVendor(VENDOR_ID, { status: "prospect" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("prospect");
    expect(res.body.approvedAt).toBeNull();
    expect(vendorRow(VENDOR_ID)?.approvedAt).toBeNull();
  });

  it("rejecting an approved vendor also clears approvedAt", async () => {
    authAs(OWNER);
    await updateVendor(VENDOR_ID, { status: "approved" });
    const res = await updateVendor(VENDOR_ID, { status: "rejected" });
    expect(res.status).toBe(200);
    expect(res.body.approvedAt).toBeNull();
  });

  it("re-sending the same status leaves the existing approvedAt untouched", async () => {
    authAs(OWNER);
    await updateVendor(VENDOR_ID, { status: "approved" });
    const stamped = vendorRow(VENDOR_ID)?.approvedAt;
    const res = await updateVendor(VENDOR_ID, { status: "approved", notes: "still good" });
    expect(res.status).toBe(200);
    expect(vendorRow(VENDOR_ID)?.approvedAt).toBe(stamped);
  });
});

describe("quotedCost validation", () => {
  it("rejects a decimal quotedCost on create", async () => {
    authAs(OWNER);
    const res = await createVendor({ name: "Venue", category: "venue", quotedCost: 100.5 });
    expect(res.status).toBe(400);
    expect(state.rows.vendors).toHaveLength(2); // nothing created
  });

  it("rejects a decimal quotedCost on update", async () => {
    authAs(OWNER);
    const res = await updateVendor(VENDOR_ID, { quotedCost: 99.99 });
    expect(res.status).toBe(400);
    expect(vendorRow(VENDOR_ID)?.quotedCost).toBe(1200);
  });

  it("rejects a negative quotedCost on create", async () => {
    authAs(OWNER);
    const res = await createVendor({ name: "Venue", category: "venue", quotedCost: -5 });
    expect(res.status).toBe(400);
  });

  it("accepts whole-dollar and null quotedCost", async () => {
    authAs(OWNER);
    const created = await createVendor({ name: "Venue", category: "venue", quotedCost: 2500 });
    expect(created.status).toBe(201);
    expect(created.body.quotedCost).toBe(2500);
    const cleared = await updateVendor(VENDOR_ID, { quotedCost: null });
    expect(cleared.status).toBe(200);
    expect(vendorRow(VENDOR_ID)?.quotedCost).toBeNull();
  });
});

describe("contract create/delete on own reunion", () => {
  it("creates a contract tied to the vendor's reunion", async () => {
    authAs(POWER);
    const res = await createContract(VENDOR_ID, {
      fileName: "signed.pdf",
      objectPath: "/objects/contracts/signed.pdf",
    });
    expect(res.status).toBe(201);
    expect(res.body.vendorId).toBe(VENDOR_ID);
    expect(res.body.reunionId).toBe(REUNION_ID);
    expect(res.body.uploadedBy).toBe(POWER);
  });

  it("rejects a contract whose objectPath is outside /objects/", async () => {
    authAs(OWNER);
    const res = await createContract(VENDOR_ID, {
      fileName: "evil.pdf",
      objectPath: "https://evil.example/evil.pdf",
    });
    expect(res.status).toBe(400);
    expect(state.rows.vendor_contracts).toHaveLength(2);
  });

  it("deletes an own contract", async () => {
    authAs(OWNER);
    const res = await deleteContract(VENDOR_ID, CONTRACT_ID);
    expect(res.status).toBe(204);
    expect(state.rows.vendor_contracts?.map((c) => c.id)).toEqual([FOREIGN_CONTRACT_ID]);
  });
});
