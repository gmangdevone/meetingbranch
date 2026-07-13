import type { Request, Response, NextFunction } from "express";
import { db, reunionsTable, reunionOrganizersTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import type { Reunion } from "@workspace/db";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      managedReunion?: Reunion;
    }
  }
}

/**
 * Authorizes the current user to manage a specific reunion.
 * Allows the reunion's owner, any added co-organizer, OR any platform admin.
 * Must run after attachAuth (so req.userId / req.isAdmin are set).
 */
export async function requireReunionManager(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const reunionId = Number(req.params.reunionId);
  if (!Number.isInteger(reunionId)) {
    res.status(400).json({ error: "Invalid reunion id" });
    return;
  }
  if (!req.userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const [reunion] = await db
    .select()
    .from(reunionsTable)
    .where(eq(reunionsTable.id, reunionId));

  if (!reunion) {
    res.status(404).json({ error: "Reunion not found" });
    return;
  }

  let authorized = reunion.organizerId === req.userId || req.isAdmin === true;

  if (!authorized) {
    const [coOrganizer] = await db
      .select({ id: reunionOrganizersTable.id })
      .from(reunionOrganizersTable)
      .where(
        and(
          eq(reunionOrganizersTable.reunionId, reunionId),
          eq(reunionOrganizersTable.userId, req.userId),
        ),
      );
    authorized = Boolean(coOrganizer);
  }

  if (!authorized) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  req.managedReunion = reunion;
  next();
}
