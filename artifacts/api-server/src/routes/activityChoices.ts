import { Router, type IRouter } from "express";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  activityChoiceGroupsTable,
  activityChoiceOptionsTable,
  db,
} from "@workspace/db";
import {
  AddActivityChoiceOptionBody,
  AddActivityChoiceOptionParams,
  AddActivityChoiceOptionResponse,
  UpdateActivityChoiceOptionBody,
  UpdateActivityChoiceOptionResponse,
  CreateActivityChoiceGroupBody,
  CreateActivityChoiceGroupParams,
  CreateActivityChoiceGroupResponse,
  DeleteActivityChoiceGroupParams,
  DeleteActivityChoiceOptionParams,
  ListManageActivityChoicesResponse,
  ListManageActivityChoicesParams,
  ListMemberActivityChoicesParams,
  ListMemberActivityChoicesResponse,
  UpdateActivityChoiceGroupBody,
  UpdateActivityChoiceGroupParams,
  UpdateActivityChoiceGroupResponse,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { attachAuth } from "../middlewares/requireAdmin";
import { requireReunionManager } from "../middlewares/requireReunionManager";
import { normalizeActivity } from "../lib/activityDetails";

const router: IRouter = Router();
const manage = [attachAuth, requireReunionManager] as const;

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
  const { title, description, options } = body.data;
  if (!title.trim()) {
    res.status(400).json({ error: "List title and activity names cannot be blank." });
    return;
  }
  let normalizedOptions;
  try {
    normalizedOptions = options.map(option => normalizeActivity(typeof option === "string" ? { label: option } : option));
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
    return;
  }
  const group = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(activityChoiceGroupsTable)
      .values({
        reunionId,
        title: title.trim(),
        description: description?.trim() || null,
        maxSelectionsPerRegistrant: 1,
      })
      .returning();
    await tx.insert(activityChoiceOptionsTable).values(
      normalizedOptions.map((option, position) => ({
        groupId: created.id,
        ...option,
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
    const payload = groups.map((group) => {
      const groupOptions = options.filter((option) => option.groupId === group.id);
      return {
        group: { ...group, options: groupOptions },
        totalRegistrants: 0,
        results: [],
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
    const { title, description } = body.data;
    if (title !== undefined && !title.trim()) {
      res.status(400).json({ error: "List title cannot be blank." });
      return;
    }
    await db
      .update(activityChoiceGroupsTable)
      .set({
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
    let activity;
    try { activity = normalizeActivity(body.data); }
    catch (error) { res.status(400).json({ error: (error as Error).message }); return; }
    const [created] = await db
      .insert(activityChoiceOptionsTable)
      .values({ groupId, ...activity, position })
      .returning();
    res.status(201).json(AddActivityChoiceOptionResponse.parse(created));
  },
);

router.patch(
  "/reunions/:reunionId/activities/:activityChoiceGroupId/options/:activityChoiceOptionId",
  ...manage,
  async (req, res): Promise<void> => {
    const params = DeleteActivityChoiceOptionParams.safeParse(req.params);
    const body = UpdateActivityChoiceOptionBody.safeParse(req.body);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }
    const reunionId = req.managedReunion!.id;
    const { activityChoiceGroupId: groupId, activityChoiceOptionId: optionId } = params.data;
    const existing = await getGroupWithOptions(reunionId, groupId);
    if (!existing || !existing.options.some((option) => option.id === optionId)) {
      res.status(404).json({ error: "Activity choice option not found" });
      return;
    }
    let activity;
    try { activity = normalizeActivity(body.data); }
    catch (error) { res.status(400).json({ error: (error as Error).message }); return; }
    const [updated] = await db
      .update(activityChoiceOptionsTable)
      .set(activity)
      .where(eq(activityChoiceOptionsTable.id, optionId))
      .returning();
    res.json(UpdateActivityChoiceOptionResponse.parse(updated));
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
    if (existing.options.length <= 1) {
      res.status(400).json({ error: "An activity list needs at least one activity" });
      return;
    }
    await db.delete(activityChoiceOptionsTable).where(eq(activityChoiceOptionsTable.id, optionId));
    res.status(204).end();
  },
);

router.get("/reunions/:reunionId/activities", requireAuth, async (req, res): Promise<void> => {
  const params = ListMemberActivityChoicesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const reunionId = params.data.reunionId;
  const groups = await db
    .select()
    .from(activityChoiceGroupsTable)
    .where(eq(activityChoiceGroupsTable.reunionId, reunionId))
    .orderBy(desc(activityChoiceGroupsTable.createdAt), desc(activityChoiceGroupsTable.id));
  const visible = groups;
  const groupIds = visible.map((group) => group.id);
  const options = groupIds.length
    ? await db
        .select()
        .from(activityChoiceOptionsTable)
        .where(inArray(activityChoiceOptionsTable.groupId, groupIds))
        .orderBy(asc(activityChoiceOptionsTable.position), asc(activityChoiceOptionsTable.id))
    : [];
  const payload = {
    eligible: false,
    groups: visible.map((group) => {
      const groupOptions = options.filter((option) => option.groupId === group.id);
      return {
        group: { ...group, options: groupOptions },
        myOptionIds: [],
        canSelect: false,
      };
    }),
  };
  res.json(ListMemberActivityChoicesResponse.parse(payload));
});

router.put(
  "/reunions/:reunionId/activities/:activityChoiceGroupId/selections",
  requireAuth,
  async (_req, res): Promise<void> => {
    res.status(410).json({ error: "Activity selections have been retired. Please use the Polls page to vote." });
  },
);

export default router;