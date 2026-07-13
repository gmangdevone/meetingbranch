import type { Request, Response, NextFunction } from "express";
import { db, reunionsTable, reunionOrganizersTable, REUNION_ROLES } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import type { Reunion, ReunionRole } from "@workspace/db";

/**
 * The current viewer's effective access to req.managedReunion, computed once by
 * requireReunionManager and reused by requireReunionPermission / handlers.
 * Owners and platform admins receive every role plus organizer-management rights.
 */
export interface ReunionAccess {
  isOwner: boolean;
  isAdmin: boolean;
  canManageOrganizers: boolean;
  roles: ReunionRole[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      managedReunion?: Reunion;
      reunionAccess?: ReunionAccess;
    }
  }
}

/**
 * Authorizes the current user to manage a specific reunion.
 * Allows the reunion's owner, any added co-organizer (regardless of their role
 * set), OR any platform admin. Populates req.managedReunion and req.reunionAccess
 * so downstream role checks and handlers can reuse the viewer's permissions.
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

  const isOwner = reunion.organizerId === req.userId;
  const isAdmin = req.isAdmin === true;

  let access: ReunionAccess | null = null;

  if (isOwner || isAdmin) {
    // Owners and platform admins implicitly have every area.
    access = {
      isOwner,
      isAdmin,
      canManageOrganizers: true,
      roles: [...REUNION_ROLES],
    };
  } else {
    const [coOrganizer] = await db
      .select({ roles: reunionOrganizersTable.roles })
      .from(reunionOrganizersTable)
      .where(
        and(
          eq(reunionOrganizersTable.reunionId, reunionId),
          eq(reunionOrganizersTable.userId, req.userId),
        ),
      );
    if (coOrganizer) {
      access = {
        isOwner: false,
        isAdmin: false,
        canManageOrganizers: false,
        roles: (coOrganizer.roles ?? []) as ReunionRole[],
      };
    }
  }

  if (!access) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  req.managedReunion = reunion;
  req.reunionAccess = access;
  next();
}

/**
 * Restricts an area-specific action to viewers who hold the given role.
 * Owners and platform admins always pass (they hold every role). Must run AFTER
 * requireReunionManager, which populates req.reunionAccess.
 */
export function requireReunionPermission(role: ReunionRole) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const access = req.reunionAccess;
    if (!access) {
      res
        .status(500)
        .json({ error: "requireReunionPermission must run after requireReunionManager" });
      return;
    }
    if (access.isOwner || access.isAdmin || access.roles.includes(role)) {
      next();
      return;
    }
    res.status(403).json({ error: "You don't have permission to manage this area." });
  };
}

/**
 * Restricts an action to the reunion's owner (or a platform admin).
 * Co-organizers are explicitly not allowed. Must run AFTER
 * requireReunionManager, which populates req.managedReunion.
 */
export async function requireReunionOwner(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const reunion = req.managedReunion;
  if (!reunion) {
    res.status(500).json({ error: "requireReunionOwner must run after requireReunionManager" });
    return;
  }
  if (reunion.organizerId !== req.userId && req.isAdmin !== true) {
    res.status(403).json({ error: "Only the reunion owner can perform this action." });
    return;
  }
  next();
}
