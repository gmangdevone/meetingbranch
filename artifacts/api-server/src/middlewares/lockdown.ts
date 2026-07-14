import type { Request, Response, NextFunction } from "express";
import { getClerkUserId } from "./requireAuth";
import { getCachedSettings, isExemptFromLockdown } from "../lib/access";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// Paths (relative to the /api mount) that must stay reachable during a
// sign-in lockdown so the frontend can discover the lockout state.
const LOCKDOWN_EXEMPT_PATHS = new Set(["/me/access", "/settings"]);

/**
 * Platform-wide sign-in lockdown, mounted ahead of ALL /api routes. While
 * app_settings.sign_ins_locked is true, signed-in users who are neither
 * platform admins, reunion organizers (owners or co-organizers), nor
 * allowlisted tester emails receive 403 { code: "SIGN_INS_LOCKED" } on every
 * endpoint. Unauthenticated requests pass through (public reads keep working;
 * protected routes still 401 on their own).
 */
export async function enforceLockdown(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (LOCKDOWN_EXEMPT_PATHS.has(req.path)) {
    next();
    return;
  }

  const userId = getClerkUserId(req);
  if (!userId) {
    next();
    return;
  }

  const settings = await getCachedSettings();
  if (!settings.signInsLocked) {
    next();
    return;
  }

  const [user] = await db
    .select({ isAdmin: usersTable.isAdmin })
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  const isAdmin =
    user?.isAdmin === true ||
    (!!process.env.ADMIN_USER_ID && userId === process.env.ADMIN_USER_ID);

  const exempt = await isExemptFromLockdown(userId, isAdmin, settings.testerEmails);
  if (!exempt) {
    res.status(403).json({
      error: "Sign-ins are temporarily disabled while we prepare the app.",
      code: "SIGN_INS_LOCKED",
    });
    return;
  }

  next();
}
