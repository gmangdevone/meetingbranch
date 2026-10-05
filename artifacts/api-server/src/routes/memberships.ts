import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, reunionsTable, reunionOrganizersTable, registrationsTable } from "@workspace/db";
import { ListMyEventMembershipsResponse } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { mergeMemberships } from "../lib/memberships";

const router: IRouter = Router();

const cols = {
  id: reunionsTable.id,
  code: reunionsTable.code,
  name: reunionsTable.name,
  startDate: reunionsTable.startDate,
  endDate: reunionsTable.endDate,
};

// GET /me/event-memberships — see lib/memberships.ts for the exact sources.
router.get("/me/event-memberships", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as any).userId as string;
  const [owned, coOrganized, regs] = await Promise.all([
    db.select(cols).from(reunionsTable).where(eq(reunionsTable.organizerId, userId)),
    db
      .select(cols)
      .from(reunionOrganizersTable)
      .innerJoin(reunionsTable, eq(reunionOrganizersTable.reunionId, reunionsTable.id))
      .where(eq(reunionOrganizersTable.userId, userId)),
    db
      .select({ status: registrationsTable.status, reunion: cols })
      .from(registrationsTable)
      .innerJoin(reunionsTable, eq(registrationsTable.reunionId, reunionsTable.id))
      .where(and(eq(registrationsTable.userId, userId), eq(registrationsTable.status, "active"))),
  ]);
  res.set("Cache-Control", "private, no-store");
  res.json(ListMyEventMembershipsResponse.parse(mergeMemberships({ owned, coOrganized, registrations: regs })));
});

export default router;
