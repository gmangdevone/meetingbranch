import { Router } from "express";
import { clerkClient, getAuth } from "@clerk/express";
import { db, usersTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { upsertUserFromClerk } from "../lib/users";
import { GetMyProfileResponse, UpdateMyProfileBody } from "@workspace/api-zod";

const router = Router();
export const profileInput = UpdateMyProfileBody.extend({
  firstName: UpdateMyProfileBody.shape.firstName.trim().min(1, "Enter your first name."),
  lastName: UpdateMyProfileBody.shape.lastName.trim().min(1, "Enter your last name."),
}).strict();

router.all("/me/profile", requireAuth);
router.route("/me/profile").get(handleProfile).put(handleProfile);

async function handleProfile(req: import("express").Request, res: import("express").Response) {
  res.setHeader("Cache-Control", "no-store");
  const { userId, sessionId } = getAuth(req);
  if (!userId || !sessionId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const parsed = req.method === "PUT" ? profileInput.safeParse(req.body) : null;
  if (parsed && !parsed.success) {
    res.status(400).json({ error: "Please enter both names.", fields: parsed.error.flatten().fieldErrors });
    return;
  }
  try {
    let [row] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    if (!row) {
      await upsertUserFromClerk(userId, req.log);
      [row] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    }
    if (!row || row.isManaged) { res.status(403).json({ error: "Profile unavailable" }); return; }
    if (!row.greetingInitialized) {
      // Verify the signup session, not merely the first local profile read.
      let initialSession: string | null = null;
      {
        const [user, session, sessions] = await Promise.all([
          clerkClient.users.getUser(userId),
          clerkClient.sessions.getSession(sessionId),
          clerkClient.sessions.getSessionList({ userId, limit: 2 }),
        ]);
        if (sessions.totalCount === 1 && session.createdAt >= user.createdAt &&
            session.createdAt - user.createdAt < 60_000) initialSession = sessionId;
      }
      await db.update(usersTable).set({ greetingInitialized: true, initialGreetingSession: initialSession })
        .where(and(eq(usersTable.id, userId), eq(usersTable.greetingInitialized, false)));
    }
    if (parsed?.success) {
      await db.update(usersTable).set({ ...parsed.data, nameSavedByUser: true })
        .where(and(eq(usersTable.id, userId), eq(usersTable.isManaged, false)));
    }
    [row] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    res.json(GetMyProfileResponse.parse({
      firstName: row.firstName, lastName: row.lastName,
      isNewAccount: row.initialGreetingSession === sessionId,
    }));
  } catch (err) {
    req.log.error({ err }, "Profile request failed");
    res.status(503).json({ error: "Your profile could not be loaded or saved. Please try again." });
  }
}
export default router;