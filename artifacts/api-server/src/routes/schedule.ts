import { Router, type IRouter } from "express";
import { asc } from "drizzle-orm";
import { db, scheduleItemsTable } from "@workspace/db";
import { ListScheduleItemsResponse } from "@workspace/api-zod";

const router: IRouter = Router();

// GET /schedule
router.get("/schedule", async (_req, res): Promise<void> => {
  const items = await db
    .select()
    .from(scheduleItemsTable)
    .orderBy(asc(scheduleItemsTable.sortOrder), asc(scheduleItemsTable.id));

  res.json(ListScheduleItemsResponse.parse(items));
});

export default router;
