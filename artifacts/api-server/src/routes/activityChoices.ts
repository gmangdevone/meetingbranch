import { Router, type IRouter } from "express";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  activityChoiceGroupsTable,
  activityChoiceOptionsTable,
  activityChoiceSelectionsTable,
  db,
  registrationsTable,
  usersTable,
} from "@workspace/db";
import {
  AddActivityChoiceOptionBody,
  AddActivityChoiceOptionParams,
  AddActivityChoiceOptionResponse,
  CreateActivityChoiceGroupBody,
  CreateActivityChoiceGroupParams,
  CreateActivityChoiceGroupResponse,
  DeleteActivityChoiceGroupParams,
  DeleteActivityChoiceOptionParams,
  ListManageActivityChoicesResponse,
  ListManageActivityChoicesParams,
  ListMemberActivityChoicesParams,
  ListMemberActivityChoicesResponse,
  SetActivityChoiceSelectionsBody,
  SetActivityChoiceSelectionsParams,
  SetActivityChoiceSelectionsResponse,
  UpdateActivityChoiceGroupBody,
  UpdateActivityChoiceGroupParams,
  UpdateActivityChoiceGroupResponse,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { attachAuth } from "../middlewares/requireAdmin";
import { requireReunionManager } from "../middlewares/requireReunionManager";

const router: IRouter = Router();
const manage = [attachAuth, requireReunionManager] as const;

async function hasActiveRegistration(
  dbOrTx: Pick<typeof db, "select">,
  reunionId: number,
  userId: string,
) {
  const [registration] = await dbOrTx
    .select({ id: registrationsTable.id })
    .from(registrationsTable)
    .where(
      and(
        eq(registrationsTable.reunionId, reunionId),
        eq(registrationsTable.userId, userId),
        eq(registrationsTable.status, "active"),
      ),
    );
  return Boolean(registration);
}

async function getGroupWithOptions(reunionId: number, groupId: number) {
  const [group] = await db
    .select()
    .from(activityChoiceGroupsTable)
    .where(
      and(
        eq(activityChoiceGroupsTable.id, groupId),
        eq(activityChoiceGroupsTable.reunionId, reunionId),
      ),
    );
  if (!group) return null;
  const options = await db
    .select()
    .from(activityChoiceOptionsTable)
    .where(eq(activityChoiceOptionsTable.groupId, groupId))
    .orderBy(asc(activityChoiceOptionsTable.position), asc(activityChoiceOptionsTable.id));
  return { ...group, options };
}

router.post("/reunions/:reunionId/activities", ...manage, async (req, res): Promise<void> => {
  const params = CreateActivityChoiceGroupParams.safeParse(req.params);
  const body = CreateActivityChoiceGroupBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const reunionId = req.managedReunion!.id;
  const { title, description, maxSelectionsPerRegistrant, options } = body.data;
  const group = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(activityChoiceGroupsTable)
      .values({
        reunionId,
        title: title.trim(),
        description: description?.trim() || null,
        maxSelectionsPerRegistrant,
      })
      .returning();
    await tx.insert(activityChoiceOptionsTable).values(
      options.map((label, position) => ({
        groupId: created.id,
        label: label.trim(),
        position,
      })),
    );
    return created;
  });
  res
    .status(201)
    .json(CreateActivityChoiceGroupResponse.parse(await getGroupWithOptions(reunionId, group.id)));
});

router.get(
  "/reunions/:reunionId/activities/manage",
  ...manage,
  async (req, res): Promise<void> => {
    const params = ListManageActivityChoicesParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const reunionId = req.managedReunion!.id;
    const groups = await db
      .select()
      .from(activityChoiceGroupsTable)
      .where(eq(activityChoiceGroupsTable.reunionId, reunionId))
      .orderBy(desc(activityChoiceGroupsTable.createdAt), desc(activityChoiceGroupsTable.id));
    const groupIds = groups.map((group) => group.id);
    const options = groupIds.length
      ? await db
          .select()
          .from(activityChoiceOptionsTable)
          .where(inArray(activityChoiceOptionsTable.groupId, groupIds))
          .orderBy(asc(activityChoiceOptionsTable.position), asc(activityChoiceOptionsTable.id))
      : [];
    const selections = groupIds.length
      ? await db
          .select({
            groupId: activityChoiceSelectionsTable.groupId,
            optionId: activityChoiceSelectionsTable.optionId,
            userId: activityChoiceSelectionsTable.userId,
            firstName: usersTable.firstName,
            lastName: usersTable.lastName,
            email: usersTable.email,
          })
          .from(activityChoiceSelectionsTable)
          .leftJoin(usersTable, eq(activityChoiceSelectionsTable.userId, usersTable.id))
          .where(inArray(activityChoiceSelectionsTable.groupId, groupIds))
      : [];
    const displayName = (selection: {
      firstName: string | null;
      lastName: string | null;
      email: string | null;
    }) =>
      [selection.firstName, selection.lastName].filter(Boolean).join(" ") ||
      selection.email ||
      "Unknown registrant";
    const payload = groups.map((group) => {
      const groupOptions = options.filter((option) => option.groupId === group.id);
      const groupSelections = selections.filter((selection) => selection.groupId === group.id);
      return {
        group: { ...group, options: groupOptions },
        totalRegistrants: new Set(groupSelections.map((selection) => selection.userId)).size,
        results: groupOptions.map((option) => {
          const selected = groupSelections.filter((selection) => selection.optionId === option.id);
          return {
            optionId: option.id,
            label: option.label,
            selectionCount: selected.length,
            registrants: selected.map(displayName),
          };
        }),
      };
    });
    res.json(ListManageActivityChoicesResponse.parse(payload));
  },
);

router.patch(
  "/reunions/:reunionId/activities/:activityChoiceGroupId",
  ...manage,
  async (req, res): Promise<void> => {
    const params = UpdateActivityChoiceGroupParams.safeParse(req.params);
    const body = UpdateActivityChoiceGroupBody.safeParse(req.body);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }
    const reunionId = req.managedReunion!.id;
    const groupId = params.data.activityChoiceGroupId;
    if (!(await getGroupWithOptions(reunionId, groupId))) {
      res.status(404).json({ error: "Activity choice group not found" });
      return;
    }
    const { title, description, ...flags } = body.data;
    await db
      .update(activityChoiceGroupsTable)
      .set({
        ...flags,
        ...(title === undefined ? {} : { title: title.trim() }),
        ...(description === undefined ? {} : { description: description?.trim() || null }),
      })
      .where(eq(activityChoiceGroupsTable.id, groupId));
    res.json(
      UpdateActivityChoiceGroupResponse.parse(await getGroupWithOptions(reunionId, groupId)),
    );
  },
);

router.delete(
  "/reunions/:reunionId/activities/:activityChoiceGroupId",
  ...manage,
  async (req, res): Promise<void> => {
    const params = DeleteActivityChoiceGroupParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const reunionId = req.managedReunion!.id;
    const existing = await getGroupWithOptions(reunionId, params.data.activityChoiceGroupId);
    if (!existing) {
      res.status(404).json({ error: "Activity choice group not found" });
      return;
    }
    await db
      .delete(activityChoiceGroupsTable)
      .where(eq(activityChoiceGroupsTable.id, params.data.activityChoiceGroupId));
    res.status(204).end();
  },
);

router.post(
  "/reunions/:reunionId/activities/:activityChoiceGroupId/options",
  ...manage,
  async (req, res): Promise<void> => {
    const params = AddActivityChoiceOptionParams.safeParse(req.params);
    const body = AddActivityChoiceOptionBody.safeParse(req.body);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }
    const reunionId = req.managedReunion!.id;
    const groupId = params.data.activityChoiceGroupId;
    const existing = await getGroupWithOptions(reunionId, groupId);
    if (!existing) {
      res.status(404).json({ error: "Activity choice group not found" });
      return;
    }
    const position = existing.options.length
      ? Math.max(...existing.options.map((option) => option.position)) + 1
      : 0;
    const [created] = await db
      .insert(activityChoiceOptionsTable)
      .values({ groupId, label: body.data.label.trim(), position })
      .returning();
    res.status(201).json(AddActivityChoiceOptionResponse.parse(created));
  },
);

router.delete(
  "/reunions/:reunionId/activities/:activityChoiceGroupId/options/:activityChoiceOptionId",
  ...manage,
  async (req, res): Promise<void> => {
    const params = DeleteActivityChoiceOptionParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const reunionId = req.managedReunion!.id;
    const { activityChoiceGroupId: groupId, activityChoiceOptionId: optionId } = params.data;
    const existing = await getGroupWithOptions(reunionId, groupId);
    if (!existing || !existing.options.some((option) => option.id === optionId)) {
      res.status(404).json({ error: "Activity choice option not found" });
      return;
    }
    if (existing.options.length <= 2) {
      res.status(400).json({ error: "An activity choice group needs at least two options" });
      return;
    }
    await db.delete(activityChoiceOptionsTable).where(eq(activityChoiceOptionsTable.id, optionId));
    res.status(204).end();
  },
);

function visibleResults(
  group: { resultsRevealed: boolean; liveResults: boolean },
  options: { id: number; label: string }[],
  selections: { optionId: number }[],
) {
  if (!group.resultsRevealed && !group.liveResults) return undefined;
  return options.map((option) => ({
    optionId: option.id,
    label: option.label,
    selectionCount: selections.filter((selection) => selection.optionId === option.id).length,
  }));
}

router.get("/reunions/:reunionId/activities", requireAuth, async (req, res): Promise<void> => {
  const params = ListMemberActivityChoicesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const reunionId = params.data.reunionId;
  const userId = req.userId!;
  const eligible = await hasActiveRegistration(db, reunionId, userId);
  const groups = await db
    .select()
    .from(activityChoiceGroupsTable)
    .where(eq(activityChoiceGroupsTable.reunionId, reunionId))
    .orderBy(desc(activityChoiceGroupsTable.createdAt), desc(activityChoiceGroupsTable.id));
  const visible = groups.filter((group) => group.isOpen || group.resultsRevealed);
  const groupIds = visible.map((group) => group.id);
  const options = groupIds.length
    ? await db
        .select()
        .from(activityChoiceOptionsTable)
        .where(inArray(activityChoiceOptionsTable.groupId, groupIds))
        .orderBy(asc(activityChoiceOptionsTable.position), asc(activityChoiceOptionsTable.id))
    : [];
  const selections = groupIds.length
    ? await db
        .select()
        .from(activityChoiceSelectionsTable)
        .where(inArray(activityChoiceSelectionsTable.groupId, groupIds))
    : [];
  const payload = {
    eligible,
    groups: visible.map((group) => {
      const groupOptions = options.filter((option) => option.groupId === group.id);
      const groupSelections = selections.filter((selection) => selection.groupId === group.id);
      return {
        group: { ...group, options: groupOptions },
        myOptionIds: groupSelections
          .filter((selection) => selection.userId === userId)
          .map((selection) => selection.optionId),
        canSelect: eligible && group.isOpen,
        results: visibleResults(group, groupOptions, groupSelections),
      };
    }),
  };
  res.json(ListMemberActivityChoicesResponse.parse(payload));
});

router.put(
  "/reunions/:reunionId/activities/:activityChoiceGroupId/selections",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = SetActivityChoiceSelectionsParams.safeParse(req.params);
    const body = SetActivityChoiceSelectionsBody.safeParse(req.body);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }
    const { reunionId, activityChoiceGroupId: groupId } = params.data;
    const userId = req.userId!;
    const optionIds = [...new Set(body.data.optionIds)];
    let failure: { status: number; error: string } | null = null;
    await db.transaction(async (tx) => {
      const [group] = await tx
        .select()
        .from(activityChoiceGroupsTable)
        .where(
          and(
            eq(activityChoiceGroupsTable.id, groupId),
            eq(activityChoiceGroupsTable.reunionId, reunionId),
          ),
        )
        .for("update");
      if (!group) {
        failure = { status: 404, error: "Activity choice group not found" };
        return;
      }
      if (!group.isOpen) {
        failure = { status: 400, error: "Selections are closed for this group" };
        return;
      }
      if (!(await hasActiveRegistration(tx, reunionId, userId))) {
        failure = { status: 403, error: "An active reunion registration is required to select" };
        return;
      }
      if (optionIds.length > group.maxSelectionsPerRegistrant) {
        failure = {
          status: 400,
          error: `You can select at most ${group.maxSelectionsPerRegistrant} option${group.maxSelectionsPerRegistrant === 1 ? "" : "s"}`,
        };
        return;
      }
      const options = await tx
        .select({ id: activityChoiceOptionsTable.id })
        .from(activityChoiceOptionsTable)
        .where(eq(activityChoiceOptionsTable.groupId, groupId));
      const validIds = new Set(options.map((option) => option.id));
      if (!optionIds.every((optionId) => validIds.has(optionId))) {
        failure = { status: 400, error: "Unknown activity choice option" };
        return;
      }
      await tx
        .delete(activityChoiceSelectionsTable)
        .where(
          and(
            eq(activityChoiceSelectionsTable.groupId, groupId),
            eq(activityChoiceSelectionsTable.userId, userId),
          ),
        );
      if (optionIds.length) {
        await tx
          .insert(activityChoiceSelectionsTable)
          .values(optionIds.map((optionId) => ({ groupId, optionId, userId })));
      }
    });
    if (failure) {
      const response = failure as { status: number; error: string };
      res.status(response.status).json({ error: response.error });
      return;
    }
    const group = await getGroupWithOptions(reunionId, groupId);
    if (!group) {
      res.status(404).json({ error: "Activity choice group not found" });
      return;
    }
    const selections = await db
      .select()
      .from(activityChoiceSelectionsTable)
      .where(eq(activityChoiceSelectionsTable.groupId, groupId));
    res.json(
      SetActivityChoiceSelectionsResponse.parse({
        group,
        myOptionIds: selections
          .filter((selection) => selection.userId === userId)
          .map((selection) => selection.optionId),
        canSelect: true,
        results: visibleResults(group, group.options, selections),
      }),
    );
  },
);

export default router;