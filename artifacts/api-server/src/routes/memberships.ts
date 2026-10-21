import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, reunionsTable, reunionOrganizersTable, registrationsTable, branchFeeElectionsTable } from "@workspace/db";
import { ListMyEventMembershipsResponse } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { mergeMemberships } from "../lib/memberships";
import { attachAuth } from "../middlewares/requireAdmin";
import { hasReunionPermission } from "../middlewares/requireReunionManager";

const router: IRouter = Router();

const cols = {
  id: reunionsTable.id,
  code: reunionsTable.code,
  name: reunionsTable.name,
  startDate: reunionsTable.startDate,
  endDate: reunionsTable.endDate,
};

// GET /me/event-memberships — see lib/memberships.ts for the exact sources.
router.get("/me/event-memberships", requireAuth, attachAuth, async (req, res): Promise<void> => {
  const userId = (req as any).userId as string;
  const [owned, coOrganized, regs, elections] = await Promise.all([
    db.select(cols).from(reunionsTable).where(eq(reunionsTable.organizerId, userId)),
    db
      .select({ ...cols, roles: reunionOrganizersTable.roles })
      .from(reunionOrganizersTable)
      .innerJoin(reunionsTable, eq(reunionOrganizersTable.reunionId, reunionsTable.id))
      .where(eq(reunionOrganizersTable.userId, userId)),
    db
      .select({ status: registrationsTable.status, reunion: cols })
      .from(registrationsTable)
      .innerJoin(reunionsTable, eq(registrationsTable.reunionId, reunionsTable.id))
      .where(and(eq(registrationsTable.userId, userId), eq(registrationsTable.status, "active"))),
    db
      .select(cols)
      .from(branchFeeElectionsTable)
      .innerJoin(reunionsTable, eq(branchFeeElectionsTable.reunionId, reunionsTable.id))
      .where(and(eq(branchFeeElectionsTable.userId, userId), eq(branchFeeElectionsTable.status, "active"))),
  ]);
  res.set("Cache-Control", "private, no-store");
  const memberships = mergeMemberships({ owned, coOrganized, registrations: regs, branchFeeElections: elections });
  res.json(ListMyEventMembershipsResponse.parse(memberships.map(m => ({
    ...m,
    canViewReports: (m.isOrganizer || m.isCoOrganizer) && hasReunionPermission({
      isOwner: m.isOrganizer,
      isAdmin: req.isAdmin === true,
      roles: coOrganized.find(r => r.id === m.reunionId)?.roles ?? [],
    }, "reports"),
  }))));
});

export default router;
