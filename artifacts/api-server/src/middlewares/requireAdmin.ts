import { getAuth } from "@clerk/express";
import type { Request, Response, NextFunction } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { upsertUserFromClerk } from "../lib/users";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
      isAdmin?: boolean;
    }
  }
}

/** Attaches userId and isAdmin to req. Does NOT block — call requireAdmin for that. */
export async function attachAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const auth = getAuth(req);
  const userId = (auth?.sessionClaims?.userId || auth?.userId) as string | undefined;
  req.userId = userId;

  if (userId) {
    const ADMIN_USER_ID = process.env.ADMIN_USER_ID;
    if (ADMIN_USER_ID && userId === ADMIN_USER_ID) {
      // Auto-promote via env var — also persist to DB
      await db
        .insert(usersTable)
        .values({ id: userId, email: "", isAdmin: true })
        .onConflictDoUpdate({ target: usersTable.id, set: { isAdmin: true } });
      req.isAdmin = true;
    } else {
      const [user] = await db
        .select({ isAdmin: usersTable.isAdmin })
        .from(usersTable)
        .where(eq(usersTable.id, userId));
      if (!user) {
        // First request from a brand-new sign-in: provision the local user row
        // (with email/name from Clerk) so the account is visible in the admin
        // Users list even before it registers or creates a reunion.
        try {
          await upsertUserFromClerk(userId, req.log);
        } catch (err) {
          // Provisioning is best-effort — never block the request on it.
          req.log?.warn({ err, userId }, "First-sign-in user provisioning failed");
        }
        req.isAdmin = false;
      } else {
        req.isAdmin = user.isAdmin ?? false;
      }
    }
  } else {
    req.isAdmin = false;
  }

  next();
}

/** Blocks non-admins with 401/403. Must be used after attachAuth. */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (!req.isAdmin) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}
