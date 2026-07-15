import { Router, type IRouter } from "express";
import { eq, desc, asc, sql } from "drizzle-orm";
import {
  db,
  registrationsTable,
  attendeesTable,
  usersTable,
  reunionsTable,
  reunionBranchesTable,
  reunionFeesTable,
  reunionOrganizersTable,
  sponsorshipContributionsTable,
  appSettingsTable,
} from "@workspace/db";
import { inArray } from "drizzle-orm";
import {
  AdminUpdateSettingsBody,
  AdminListReunionsResponse,
  AdminToggleAdminFlagParams,
  AdminToggleAdminFlagBody,
  AdminRemoveUserParams,
  AdminRemoveUserBody,
} from "@workspace/api-zod";
import { attachAuth, requireAdmin } from "../middlewares/requireAdmin";
import { requireAuth } from "../middlewares/requireAuth";
import { getAuth } from "@clerk/express";
import { getOrCreateSettings } from "../lib/settings";
import { invalidateSettingsCache } from "../lib/access";

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
router.get("/admin/settings", async (_req, res): Promise<void> => {
  const settings = await getOrCreateSettings();
  res.json({
    reunionCreationEnabled: settings.reunionCreationEnabled,
    signInsLocked: settings.signInsLocked,
    testerEmails: settings.testerEmails,
  });
});

router.patch("/admin/settings", async (req, res): Promise<void> => {
  const body = AdminUpdateSettingsBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const { reunionCreationEnabled, signInsLocked, testerEmails } = body.data;
  const current = await getOrCreateSettings();
  const [saved] = await db
    .update(appSettingsTable)
    .set({
      ...(reunionCreationEnabled === undefined ? {} : { reunionCreationEnabled }),
      ...(signInsLocked === undefined ? {} : { signInsLocked }),
      ...(testerEmails === undefined
        ? {}
        : {
            testerEmails: [
              ...new Set(
                testerEmails.map((e) => e.trim().toLowerCase()).filter(Boolean),
              ),
            ],
          }),
      updatedAt: new Date(),
    })
    .where(eq(appSettingsTable.id, current.id))
    .returning();
  invalidateSettingsCache();
  res.json({
    reunionCreationEnabled: saved.reunionCreationEnabled,
    signInsLocked: saved.signInsLocked,
    testerEmails: saved.testerEmails,
  });
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
      const fees = await db
        .select()
        .from(reunionFeesTable)
        .where(eq(reunionFeesTable.reunionId, r.id))
        .orderBy(asc(reunionFeesTable.sortOrder), asc(reunionFeesTable.id));
      const [counts] = await db
        .select({
          registrationCount: sql<number>`cast(count(*) as int)`,
          attendeeCount: sql<number>`cast(coalesce(sum(${registrationsTable.attendeeCount}), 0) as int)`,
        })
        .from(registrationsTable)
        .where(eq(registrationsTable.reunionId, r.id));
      return {
        reunion: { ...r, branches, fees },
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

// Remove a user account. Blocked while they still own a reunion (transfer or
// delete it first) and for self-removal (the platform can never lose its last
// admin by accident). Optionally deletes their registrations; otherwise the
// registrations stay on record with no linked account.
router.post("/admin/users/:id/remove", async (req, res): Promise<void> => {
  const params = AdminRemoveUserParams.safeParse(req.params);
  const body = AdminRemoveUserBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const targetId = params.data.id;
  const { deleteRegistrations } = body.data;

  if (targetId === req.userId) {
    res.status(400).json({
      error: "You cannot remove your own account. Ask another administrator.",
    });
    return;
  }

  const [target] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.id, targetId));
  if (!target) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const [owned] = await db
    .select({ id: reunionsTable.id })
    .from(reunionsTable)
    .where(eq(reunionsTable.organizerId, targetId))
    .limit(1);
  if (owned) {
    res.status(409).json({
      error:
        "This user still owns a reunion. Transfer ownership or delete the reunion before removing the account.",
    });
    return;
  }

  await db.transaction(async (tx) => {
    // Revoke co-organizer roles (FK to users would otherwise block deletion).
    await tx
      .delete(reunionOrganizersTable)
      .where(eq(reunionOrganizersTable.userId, targetId));

    if (deleteRegistrations) {
      const regs = await tx
        .select({ id: registrationsTable.id })
        .from(registrationsTable)
        .where(eq(registrationsTable.userId, targetId));
      const regIds = regs.map((r) => r.id);
      if (regIds.length > 0) {
        // attendees has no FK cascade — delete explicitly. registration_fees
        // and sponsorship rows cascade / set-null via their FKs.
        await tx
          .delete(attendeesTable)
          .where(inArray(attendeesTable.registrationId, regIds));
        await tx
          .delete(registrationsTable)
          .where(inArray(registrationsTable.id, regIds));
      }
    }

    // Sponsorship contributions keep their amount and display name for fund
    // accounting, but drop the reference to the removed account.
    await tx
      .update(sponsorshipContributionsTable)
      .set({ contributorUserId: null })
      .where(eq(sponsorshipContributionsTable.contributorUserId, targetId));

    await tx.delete(usersTable).where(eq(usersTable.id, targetId));
  });

  res.status(204).end();
});

export default router;
