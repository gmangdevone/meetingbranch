import { Router, type IRouter } from "express";
import { desc } from "drizzle-orm";
import { db, announcementsTable } from "@workspace/db";
import { ListAnnouncementsResponse } from "@workspace/api-zod";

const router: IRouter = Router();

// GET /announcements
router.get("/announcements", async (_req, res): Promise<void> => {
  const items = await db
    .select()
    .from(announcementsTable)
    .orderBy(
      // Pinned first, then newest
      desc(announcementsTable.pinned),
      desc(announcementsTable.createdAt),
    );

  res.json(ListAnnouncementsResponse.parse(items));
});

export default router;
