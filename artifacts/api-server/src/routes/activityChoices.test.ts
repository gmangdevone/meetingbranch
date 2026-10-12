import { beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

// Focused directory routes and retirement of legacy activity selections.
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
    activity_choice_options: ["id", "groupId", "label", "position", "description", "address", "mapUrl", "websiteUrl"],
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
  class Update {
    private data: Record<string, unknown> = {};
    private condition: unknown;
    constructor(private source: string) {}
    set(data: Record<string, unknown>) { this.data = data; return this; }
    where(condition: unknown) { this.condition = condition; return this; }
    returning() {
      const rows = (state.rows[this.source] ?? []).filter(row => matches(this.condition, { [this.source]: row }));
      rows.forEach(row => Object.assign(row, this.data));
      return Promise.resolve(rows.map(row => ({ ...row })));
    }
  }
  const db = {
    select: (projection?: Record<string, unknown>) => new Select(projection),
    insert: (token: any) => new Insert(token.__table),
    update: (token: any) => new Update(token.__table),
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

describe("retired activity selections", () => {
  it("blocks selections without deleting historical choices", async () => {
    state.rows.activity_choice_selections = [{ id: 99, groupId: GROUP, optionId: OPTION_A, userId: ACTIVE_UNCHECKED }];
    authenticate(ACTIVE_UNCHECKED);
    const response = await request(app()).put(`/api/reunions/${REUNION}/activities/${GROUP}/selections`).send({ optionIds: [OPTION_A] });
    expect(response.status).toBe(410);
    expect(state.rows.activity_choice_selections).toHaveLength(1);
  });

  it("rejects a signed-in user without an active registration", async () => {
    authenticate(OUTSIDER);
    const response = await request(app()).put(`/api/reunions/${REUNION}/activities/${GROUP}/selections`).send({ optionIds: [OPTION_A] });
    expect(response.status).toBe(410);
  });

  it("rejects excessive selections and options owned by another group", async () => {
    authenticate(ACTIVE_UNCHECKED);
    const tooMany = await request(app()).put(`/api/reunions/${REUNION}/activities/${GROUP}/selections`).send({ optionIds: [OPTION_A, OPTION_B] });
    expect(tooMany.status).toBe(410);
    const wrongGroup = await request(app()).put(`/api/reunions/${REUNION}/activities/${GROUP}/selections`).send({ optionIds: [OTHER_OPTION] });
    expect(wrongGroup.status).toBe(410);
  });

  it("lists all activities without selection eligibility or results, including previously closed lists", async () => {
    authenticate(OUTSIDER);
    state.rows.activity_choice_groups[0].isOpen = false;
    state.rows.activity_choice_groups[0].liveResults = true;
    const res = await request(app()).get(`/api/reunions/${REUNION}/activities`);
    expect(res.status).toBe(200);
    expect(res.body.groups).toHaveLength(2);
    for (const item of res.body.groups) {
      expect(item.canSelect).toBe(false);
      expect(item.myOptionIds).toEqual([]);
      expect(item.results).toBeUndefined();
    }
  });

  it("allows removing an activity down to one, but not deleting the final item", async () => {
    authenticate(OWNER);
    expect((await request(app()).delete(`/api/reunions/${REUNION}/activities/${GROUP}/options/${OPTION_B}`)).status).toBe(204);
    expect((await request(app()).delete(`/api/reunions/${REUNION}/activities/${GROUP}/options/${OPTION_A}`)).status).toBe(400);
  });
});

describe("activity choice organizer creation", () => {
  it("round-trips item details and clears them without changing historical identities", async () => {
    authenticate(OWNER);
    const details = { label: "Walk", description: " Riverside ", address: "123 Main St", mapUrl: "https://maps.example/walk", websiteUrl: "https://example.com" };
    const created = await request(app()).post(`/api/reunions/${REUNION}/activities`).send({ title: "Local", options: ["Legacy", details] });
    expect(created.status).toBe(201);
    expect(created.body.options[1]).toMatchObject({ ...details, description: "Riverside" });
    const added = await request(app()).post(`/api/reunions/${REUNION}/activities/${GROUP}/options`).send(details);
    expect(added.status).toBe(201);
    expect(added.body.address).toBe(details.address);
    const path = `/api/reunions/${REUNION}/activities/${GROUP}/options/${added.body.id}`;
    const renamed = await request(app()).patch(path).send({ label: "Long walk" });
    expect(renamed.body.mapUrl).toBe(details.mapUrl);
    const cleared = await request(app()).patch(path).send({ label: "Long walk", description: "", address: null, mapUrl: "", websiteUrl: null });
    expect(cleared.body).toMatchObject({ id: added.body.id, description: null, address: null, mapUrl: null, websiteUrl: null });
    const member = await request(app()).get(`/api/reunions/${REUNION}/activities`);
    expect(member.body.groups.find((item: any) => item.group.id === created.body.id).group.options[1].description).toBe("Riverside");
  });
  it("rejects unsafe links on every write and preserves organizer boundaries", async () => {
    authenticate(OWNER);
    const data = { label: "Walk", mapUrl: "javascript:alert(1)" };
    expect((await request(app()).post(`/api/reunions/${REUNION}/activities`).send({ title: "Bad", options: [data] })).status).toBe(400);
    expect((await request(app()).post(`/api/reunions/${REUNION}/activities/${GROUP}/options`).send(data)).status).toBe(400);
    expect((await request(app()).patch(`/api/reunions/${REUNION}/activities/${GROUP}/options/${OPTION_A}`).send(data)).status).toBe(400);
    expect((await request(app()).patch(`/api/reunions/${REUNION}/activities/${GROUP}/options/${OTHER_OPTION}`).send({ label: "Wrong" })).status).toBe(404);
    authenticate(OUTSIDER);
    expect((await request(app()).patch(`/api/reunions/${REUNION}/activities/${GROUP}/options/${OPTION_A}`).send({ label: "Wrong", address: "Elsewhere" })).status).toBe(403);
  });
  it("creates a list with one activity and no polling settings", async () => {
    authenticate(OWNER);
    const res = await request(app()).post(`/api/reunions/${REUNION}/activities`).send({
      title: "Nearby museum", description: "Open daily.", options: ["History museum"],
    });
    expect(res.status).toBe(201);
    expect(res.body.options).toHaveLength(1);
  });
  it("does not let members create activity lists", async () => {
    authenticate(OUTSIDER);
    const res = await request(app()).post(`/api/reunions/${REUNION}/activities`).send({
      title: "Nearby", options: ["Museum"],
    });
    expect(res.status).toBe(403);
  });
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