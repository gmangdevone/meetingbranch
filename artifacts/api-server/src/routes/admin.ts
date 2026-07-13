import { Router, type IRouter } from "express";
import { eq, desc, sql } from "drizzle-orm";
import {
  db,
  registrationsTable,
  usersTable,
  reunionsTable,
  reunionBranchesTable,
  appSettingsTable,
} from "@workspace/db";
import {
  AdminUpdateSettingsBody,
  AdminListReunionsResponse,
  AdminToggleAdminFlagParams,
  AdminToggleAdminFlagBody,
} from "@workspace/api-zod";
import { attachAuth, requireAdmin } from "../middlewares/requireAdmin";
import { requireAuth } from "../middlewares/requireAuth";
import { getAuth } from "@clerk/express";
import { getOrCreateSettings } from "../lib/settings";

const router: IRouter = Router();

// ──────────────────────────────────────────────────────────────
// First-run admin setup (public to any signed-in user, self-closing)
// ──────────────────────────────────────────────────────────────
// Public, read-only companion to /admin/setup: lets the app decide whether to
// show the first-run "become the administrator" prompt. Reveals only whether
// any admin exists yet (a boolean), so it needs no auth and never mutates.
router.get("/admin/setup-status", async (_req, res): Promise<void> => {
  const [existingAdmin] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.isAdmin, true))
    .limit(1);

  res.json({ adminExists: !!existingAdmin });
});

// One-time bootstrap: promotes the first signed-in user to platform admin IF no
// admin exists yet. Once any admin exists, this route refuses (409). Must be
// registered BEFORE the requireAdmin gate so the first operator can reach it.
router.get("/admin/setup", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as any).userId as string;

  const [existingAdmin] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.isAdmin, true))
    .limit(1);

  if (existingAdmin) {
    res.status(409).json({
      error:
        "Admin setup is already complete. An administrator already exists; ask them to grant you access from the admin dashboard.",
    });
    return;
  }

  const auth = getAuth(req);
  const clerkEmail = (auth?.sessionClaims?.email as string | undefined) ?? "";
  const clerkFirstName =
    (auth?.sessionClaims?.firstName as string | undefined) ??
    (auth?.sessionClaims?.given_name as string | undefined) ??
    null;
  const clerkLastName =
    (auth?.sessionClaims?.lastName as string | undefined) ??
    (auth?.sessionClaims?.family_name as string | undefined) ??
    null;

  await db
    .insert(usersTable)
    .values({
      id: userId,
      email: clerkEmail,
      firstName: clerkFirstName,
      lastName: clerkLastName,
      isAdmin: true,
    })
    .onConflictDoUpdate({ target: usersTable.id, set: { isAdmin: true } });

  res.json({
    success: true,
    message:
      "You are now the administrator. The admin dashboard is unlocked. This setup step is now closed.",
    userId,
  });
});

// All routes below require auth + platform-admin role
router.use(attachAuth, requireAdmin);

// ──────────────────────────────────────────────────────────────
// Platform settings — reunion creation toggle
// ──────────────────────────────────────────────────────────────
router.patch("/admin/settings", async (req, res): Promise<void> => {
  const body = AdminUpdateSettingsBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const current = await getOrCreateSettings();
  const [saved] = await db
    .update(appSettingsTable)
    .set({ reunionCreationEnabled: body.data.reunionCreationEnabled, updatedAt: new Date() })
    .where(eq(appSettingsTable.id, current.id))
    .returning();
  res.json({ reunionCreationEnabled: saved.reunionCreationEnabled });
});

// ──────────────────────────────────────────────────────────────
// All reunions (cross-reunion oversight)
// ──────────────────────────────────────────────────────────────
router.get("/admin/reunions", async (_req, res): Promise<void> => {
  const reunions = await db
    .select()
    .from(reunionsTable)
    .orderBy(desc(reunionsTable.createdAt));

  const withDetail = await Promise.all(
    reunions.map(async (r) => {
      const branches = await db
        .select()
        .from(reunionBranchesTable)
        .where(eq(reunionBranchesTable.reunionId, r.id))
        .orderBy(reunionBranchesTable.sortOrder);
      const [counts] = await db
        .select({
          registrationCount: sql<number>`cast(count(*) as int)`,
          attendeeCount: sql<number>`cast(coalesce(sum(${registrationsTable.attendeeCount}), 0) as int)`,
        })
        .from(registrationsTable)
        .where(eq(registrationsTable.reunionId, r.id));
      return {
        reunion: { ...r, branches },
        registrationCount: counts?.registrationCount ?? 0,
        attendeeCount: counts?.attendeeCount ?? 0,
      };
    }),
  );

  res.json(AdminListReunionsResponse.parse(withDetail));
});

// ──────────────────────────────────────────────────────────────
// Users
// ──────────────────────────────────────────────────────────────
router.get("/admin/users", async (_req, res): Promise<void> => {
  const users = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      isAdmin: usersTable.isAdmin,
      createdAt: usersTable.createdAt,
      registrationCount: sql<number>`cast(count(${registrationsTable.id}) as int)`,
      attendeeCount: sql<number>`cast(coalesce(sum(${registrationsTable.attendeeCount}), 0) as int)`,
    })
    .from(usersTable)
    .leftJoin(registrationsTable, eq(registrationsTable.userId, usersTable.id))
    .groupBy(
      usersTable.id,
      usersTable.email,
      usersTable.firstName,
      usersTable.lastName,
      usersTable.isAdmin,
      usersTable.createdAt,
    )
    .orderBy(desc(usersTable.createdAt));

  res.json(users);
});

router.patch("/admin/users/:id/admin", async (req, res): Promise<void> => {
  const params = AdminToggleAdminFlagParams.safeParse(req.params);
  const body = AdminToggleAdminFlagBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }

  const [updated] = await db
    .update(usersTable)
    .set({ isAdmin: body.data.isAdmin })
    .where(eq(usersTable.id, params.data.id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const [stats] = await db
    .select({
      registrationCount: sql<number>`cast(count(*) as int)`,
      attendeeCount: sql<number>`cast(coalesce(sum(${registrationsTable.attendeeCount}), 0) as int)`,
    })
    .from(registrationsTable)
    .where(eq(registrationsTable.userId, updated.id));

  res.json({
    ...updated,
    registrationCount: stats?.registrationCount ?? 0,
    attendeeCount: stats?.attendeeCount ?? 0,
  });
});

export default router;
