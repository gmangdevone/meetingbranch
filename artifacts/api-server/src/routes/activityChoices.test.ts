import { beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

// Focused in-memory Drizzle harness for activity choice route authorization and
// selection rules. It intentionally does not model attendees: activity choices
// are eligible from an active registration alone.
const state = vi.hoisted(() => ({
  auth: null as null | { userId: string | null; sessionClaims: Record<string, unknown> | null },
  rows: {} as Record<string, Record<string, unknown>[]>,
  sequence: 1000,
}));

vi.mock("@clerk/express", () => ({
  getAuth: () => state.auth ?? { userId: null, sessionClaims: null },
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  clerkClient: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: string, value: unknown) => ({ kind: "eq", col, value }),
  and: (...parts: unknown[]) => ({ kind: "and", parts }),
  asc: (col: string) => ({ kind: "asc", col }),
  desc: (col: string) => ({ kind: "desc", col }),
  inArray: (col: string, values: unknown[]) => ({ kind: "in", col, values }),
}));

vi.mock("@workspace/db", () => {
  const columns: Record<string, string[]> = {
    users: ["id", "email", "firstName", "lastName"],
    reunions: ["id", "organizerId"],
    reunion_organizers: ["reunionId", "userId", "roles"],
    registrations: ["id", "reunionId", "userId", "status"],
    activity_choice_groups: ["id", "reunionId", "title", "description", "maxSelectionsPerRegistrant", "isOpen", "resultsRevealed", "liveResults", "createdAt"],
    activity_choice_options: ["id", "groupId", "label", "position"],
    activity_choice_selections: ["id", "groupId", "optionId", "userId"],
  };
  const table = (name: string) => Object.fromEntries([
    ["__table", name],
    ...columns[name].map((field) => [field, `${name}.${field}`]),
  ]);
  const value = (item: unknown, scoped: Record<string, Record<string, unknown>>) => {
    if (typeof item !== "string" || !item.includes(".")) return item;
    const [name, field] = item.split(".");
    return scoped[name]?.[field] ?? item;
  };
  const matches = (expression: any, scoped: Record<string, Record<string, unknown>>) => {
    if (!expression) return true;
    if (expression.kind === "and") return expression.parts.every((part: unknown) => matches(part, scoped));
    const [name, field] = expression.col.split(".");
    if (expression.kind === "eq") return scoped[name]?.[field] === value(expression.value, scoped);
    if (expression.kind === "in") return expression.values.includes(scoped[name]?.[field]);
    return true;
  };
  class Select {
    constructor(private projection?: Record<string, unknown>, private source = "", private condition: unknown = undefined) {}
    from(token: any) { return new Select(this.projection, token.__table, this.condition); }
    where(condition: unknown) { return new Select(this.projection, this.source, condition); }
    orderBy() { return this; }
    for() { return this; }
    leftJoin() { return this; }
    then(resolve: any, reject: any) {
      const rows = (state.rows[this.source] ?? []).filter((row) => matches(this.condition, { [this.source]: row }));
      const output = rows.map((row) => {
        if (!this.projection) return { ...row };
        return Object.fromEntries(Object.entries(this.projection).map(([key, token]) => [key, value(token, { [this.source]: row })]));
      });
      return Promise.resolve(output).then(resolve, reject);
    }
  }
  class Insert {
    private valuesToInsert: Record<string, unknown> | Record<string, unknown>[] = {};
    constructor(private source: string) {}
    values(values: any) { this.valuesToInsert = values; return this; }
    private run() {
      const input = Array.isArray(this.valuesToInsert) ? this.valuesToInsert : [this.valuesToInsert];
      return input.map((values) => {
        const row: Record<string, unknown> = { ...values, id: values.id ?? ++state.sequence, createdAt: values.createdAt ?? new Date("2026-01-01").toISOString() };
        if (this.source === "activity_choice_groups") Object.assign(row, { isOpen: row.isOpen ?? true, resultsRevealed: row.resultsRevealed ?? false, liveResults: row.liveResults ?? false });
        (state.rows[this.source] ??= []).push(row);
        return { ...row };
      });
    }
    returning() { return Promise.resolve(this.run()); }
    then(resolve: any, reject: any) { return Promise.resolve(this.run()).then(resolve, reject); }
  }
  class Delete {
    private condition: unknown;
    constructor(private source: string) {}
    where(condition: unknown) { this.condition = condition; return this; }
    then(resolve: any, reject: any) {
      state.rows[this.source] = (state.rows[this.source] ?? []).filter((row) => !matches(this.condition, { [this.source]: row }));
      return Promise.resolve([]).then(resolve, reject);
    }
  }
  const db = {
    select: (projection?: Record<string, unknown>) => new Select(projection),
    insert: (token: any) => new Insert(token.__table),
    delete: (token: any) => new Delete(token.__table),
    transaction: async (callback: (tx: any) => Promise<unknown>) => callback(db),
  };
  return {
    db,
    usersTable: table("users"),
    reunionsTable: table("reunions"),
    reunionOrganizersTable: table("reunion_organizers"),
    registrationsTable: table("registrations"),
    activityChoiceGroupsTable: table("activity_choice_groups"),
    activityChoiceOptionsTable: table("activity_choice_options"),
    activityChoiceSelectionsTable: table("activity_choice_selections"),
    REUNION_ROLES: [],
  };
});

const { default: router } = await import("./activityChoices");
const REUNION = 10;
const GROUP = 20;
const OTHER_GROUP = 21;
const OPTION_A = 30;
const OPTION_B = 31;
const OTHER_OPTION = 40;
const OWNER = "owner";
const ACTIVE_UNCHECKED = "active-unchecked";
const OUTSIDER = "outsider";

function app(): Express {
  const instance = express();
  instance.use(express.json());
  instance.use("/api", router);
  return instance;
}
function authenticate(userId: string) {
  state.auth = { userId, sessionClaims: { userId } };
}
function seed() {
  state.sequence = 100;
  state.rows = {
    users: [{ id: OWNER, email: "owner@test.com" }, { id: ACTIVE_UNCHECKED, email: "active@test.com" }, { id: OUTSIDER, email: "out@test.com" }],
    reunions: [{ id: REUNION, organizerId: OWNER }],
    reunion_organizers: [],
    registrations: [{ id: 1, reunionId: REUNION, userId: ACTIVE_UNCHECKED, status: "active" }],
    activity_choice_groups: [
      { id: GROUP, reunionId: REUNION, title: "Saturday activity", description: "Choose a daytime plan", maxSelectionsPerRegistrant: 1, isOpen: true, resultsRevealed: false, liveResults: false, createdAt: new Date("2026-01-01").toISOString() },
      { id: OTHER_GROUP, reunionId: REUNION, title: "Dinner", description: null, maxSelectionsPerRegistrant: 1, isOpen: true, resultsRevealed: false, liveResults: false, createdAt: new Date("2026-01-02").toISOString() },
    ],
    activity_choice_options: [
      { id: OPTION_A, groupId: GROUP, label: "Park", position: 0 },
      { id: OPTION_B, groupId: GROUP, label: "Museum", position: 1 },
      { id: OTHER_OPTION, groupId: OTHER_GROUP, label: "Tacos", position: 0 },
    ],
    activity_choice_selections: [],
  };
}

beforeEach(seed);

describe("activity choice selections", () => {
  it("allows an active registrant with no check-in record to select", async () => {
    authenticate(ACTIVE_UNCHECKED);
    const response = await request(app()).put(`/api/reunions/${REUNION}/activities/${GROUP}/selections`).send({ optionIds: [OPTION_A] });
    expect(response.status).toBe(200);
    expect(response.body.myOptionIds).toEqual([OPTION_A]);
  });

  it("rejects a signed-in user without an active registration", async () => {
    authenticate(OUTSIDER);
    const response = await request(app()).put(`/api/reunions/${REUNION}/activities/${GROUP}/selections`).send({ optionIds: [OPTION_A] });
    expect(response.status).toBe(403);
  });

  it("rejects excessive selections and options owned by another group", async () => {
    authenticate(ACTIVE_UNCHECKED);
    const tooMany = await request(app()).put(`/api/reunions/${REUNION}/activities/${GROUP}/selections`).send({ optionIds: [OPTION_A, OPTION_B] });
    expect(tooMany.status).toBe(400);
    const wrongGroup = await request(app()).put(`/api/reunions/${REUNION}/activities/${GROUP}/selections`).send({ optionIds: [OTHER_OPTION] });
    expect(wrongGroup.status).toBe(400);
  });
});

describe("activity choice organizer creation", () => {
  it("stores and returns the optional description", async () => {
    authenticate(OWNER);
    const response = await request(app()).post(`/api/reunions/${REUNION}/activities`).send({
      title: "Sunday breakfast",
      description: "Help us plan seating.",
      maxSelectionsPerRegistrant: 1,
      options: ["Hotel", "Cafe"],
    });
    expect(response.status).toBe(201);
    expect(response.body.description).toBe("Help us plan seating.");
    expect(response.body.options).toHaveLength(2);
  });
});