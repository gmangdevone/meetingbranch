import { Router, type IRouter } from "express";
import { eq, desc, ilike, and, sql, asc, or } from "drizzle-orm";
import {
  db,
  registrationsTable,
  attendeesTable,
  usersTable,
  announcementsTable,
  scheduleItemsTable,
} from "@workspace/db";
import {
  AdminListRegistrationsQueryParams,
  AdminUpdatePaymentStatusBody,
  AdminUpdatePaymentStatusParams,
  AdminCreateAnnouncementBody,
  AdminUpdateAnnouncementBody,
  AdminUpdateAnnouncementParams,
  AdminDeleteAnnouncementParams,
  AdminCreateScheduleItemBody,
  AdminUpdateScheduleItemBody,
  AdminUpdateScheduleItemParams,
  AdminDeleteScheduleItemParams,
  AdminToggleAdminFlagParams,
  AdminToggleAdminFlagBody,
} from "@workspace/api-zod";
import { attachAuth, requireAdmin } from "../middlewares/requireAdmin";

const router: IRouter = Router();

// All admin routes require auth + admin role
router.use(attachAuth, requireAdmin);

// ──────────────────────────────────────────────────────────────
// Registrations
// ──────────────────────────────────────────────────────────────

router.get("/admin/registrations", async (req, res): Promise<void> => {
  const query = AdminListRegistrationsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const { page = 1, limit = 20, search, siblingName, paymentStatus } = query.data;
  const offset = (page - 1) * limit;

  // Build filters
  const filters: ReturnType<typeof eq>[] = [];

  if (siblingName) {
    filters.push(eq(registrationsTable.siblingName, siblingName));
  }
  if (paymentStatus) {
    filters.push(eq(registrationsTable.paymentStatus, paymentStatus));
  }
  if (search) {
    // Search by user email or attendee name
    const emailMatches = db
      .select({ userId: usersTable.id })
      .from(usersTable)
      .where(ilike(usersTable.email, `%${search}%`));

    filters.push(
      or(
        sql`${registrationsTable.userId} IN (${emailMatches})`,
        sql`EXISTS (
          SELECT 1 FROM attendees a
          WHERE a.registration_id = ${registrationsTable.id}
            AND a.name ILIKE ${"%" + search + "%"}
        )`,
      ) as ReturnType<typeof eq>,
    );
  }

  const whereClause = filters.length > 0 ? and(...filters) : undefined;

  const [countResult, rows] = await Promise.all([
    db
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(registrationsTable)
      .where(whereClause),
    db
      .select({
        id: registrationsTable.id,
        userId: registrationsTable.userId,
        siblingName: registrationsTable.siblingName,
        attendeeCount: registrationsTable.attendeeCount,
        paymentStatus: registrationsTable.paymentStatus,
        createdAt: registrationsTable.createdAt,
        userEmail: usersTable.email,
        userName: sql<string | null>`
          CASE
            WHEN ${usersTable.firstName} IS NOT NULL
            THEN ${usersTable.firstName} || ' ' || COALESCE(${usersTable.lastName}, '')
            ELSE NULL
          END
        `,
      })
      .from(registrationsTable)
      .leftJoin(usersTable, eq(registrationsTable.userId, usersTable.id))
      .where(whereClause)
      .orderBy(desc(registrationsTable.createdAt))
      .limit(limit)
      .offset(offset),
  ]);

  const withAttendees = await Promise.all(
    rows.map(async (r) => {
      const attendees = await db
        .select()
        .from(attendeesTable)
        .where(eq(attendeesTable.registrationId, r.id));
      return { ...r, attendees, userEmail: r.userEmail ?? "" };
    }),
  );

  res.json({
    registrations: withAttendees,
    total: countResult[0]?.count ?? 0,
    page,
    limit,
  });
});

// CSV export
router.get("/admin/registrations/export", async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      id: registrationsTable.id,
      siblingName: registrationsTable.siblingName,
      attendeeCount: registrationsTable.attendeeCount,
      paymentStatus: registrationsTable.paymentStatus,
      createdAt: registrationsTable.createdAt,
      userEmail: usersTable.email,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
    })
    .from(registrationsTable)
    .leftJoin(usersTable, eq(registrationsTable.userId, usersTable.id))
    .orderBy(desc(registrationsTable.createdAt));

  const attendeeRows = await db.select().from(attendeesTable);
  const attendeeMap = new Map<number, typeof attendeeRows>();
  for (const a of attendeeRows) {
    const list = attendeeMap.get(a.registrationId) ?? [];
    list.push(a);
    attendeeMap.set(a.registrationId, list);
  }

  const csvLines: string[] = [
    "Registration ID,Sibling Group,Registrant Email,First Name,Last Name,Attendee Count,Payment Status,Registered At,Attendee Names,Shirt Sizes,Dietary Restrictions",
  ];

  for (const r of rows) {
    const attendees = attendeeMap.get(r.id) ?? [];
    const names = attendees.map((a) => a.name).join("; ");
    const shirts = attendees.map((a) => a.shirtSize).join("; ");
    const diets = attendees.map((a) => a.dietaryRestrictions ?? "").join("; ");
    const escape = (v: string | null | undefined) =>
      `"${(v ?? "").replace(/"/g, '""')}"`;

    csvLines.push(
      [
        r.id,
        escape(r.siblingName),
        escape(r.userEmail),
        escape(r.firstName),
        escape(r.lastName),
        r.attendeeCount,
        r.paymentStatus,
        new Date(r.createdAt).toISOString(),
        escape(names),
        escape(shirts),
        escape(diets),
      ].join(","),
    );
  }

  res.setHeader("Content-Type", "text/csv");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="lacey-reunion-registrations-${new Date().toISOString().slice(0, 10)}.csv"`,
  );
  res.send(csvLines.join("\n"));
});

// Update payment status
router.patch("/admin/registrations/:id/payment", async (req, res): Promise<void> => {
  const params = AdminUpdatePaymentStatusParams.safeParse(req.params);
  const body = AdminUpdatePaymentStatusBody.safeParse(req.body);

  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }

  const [updated] = await db
    .update(registrationsTable)
    .set({ paymentStatus: body.data.paymentStatus })
    .where(eq(registrationsTable.id, params.data.id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Registration not found" });
    return;
  }

  const attendees = await db
    .select()
    .from(attendeesTable)
    .where(eq(attendeesTable.registrationId, updated.id));

  const [user] = await db
    .select({ email: usersTable.email, firstName: usersTable.firstName, lastName: usersTable.lastName })
    .from(usersTable)
    .where(eq(usersTable.id, updated.userId));

  res.json({
    ...updated,
    attendees,
    userEmail: user?.email ?? "",
    userName: user?.firstName ? `${user.firstName} ${user.lastName ?? ""}`.trim() : null,
  });
});

// ──────────────────────────────────────────────────────────────
// Reports
// ──────────────────────────────────────────────────────────────

router.get("/admin/reports", async (_req, res): Promise<void> => {
  const [totals, byGroup, byShirtSize, paymentCounts, dietaryCount, overTime] =
    await Promise.all([
      // Total registrations + attendees
      db
        .select({
          totalRegistrations: sql<number>`cast(count(*) as int)`,
          totalAttendees: sql<number>`cast(sum(${registrationsTable.attendeeCount}) as int)`,
        })
        .from(registrationsTable),

      // By sibling group
      db
        .select({
          siblingName: registrationsTable.siblingName,
          registrationCount: sql<number>`cast(count(*) as int)`,
          attendeeCount: sql<number>`cast(sum(${registrationsTable.attendeeCount}) as int)`,
        })
        .from(registrationsTable)
        .groupBy(registrationsTable.siblingName)
        .orderBy(registrationsTable.siblingName),

      // Shirt size totals (from attendees)
      db
        .select({
          shirtSize: attendeesTable.shirtSize,
          count: sql<number>`cast(count(*) as int)`,
        })
        .from(attendeesTable)
        .groupBy(attendeesTable.shirtSize)
        .orderBy(attendeesTable.shirtSize),

      // Payment status counts
      db
        .select({
          paymentStatus: registrationsTable.paymentStatus,
          count: sql<number>`cast(count(*) as int)`,
        })
        .from(registrationsTable)
        .groupBy(registrationsTable.paymentStatus),

      // Attendees with dietary restrictions
      db
        .select({ count: sql<number>`cast(count(*) as int)` })
        .from(attendeesTable)
        .where(
          sql`${attendeesTable.dietaryRestrictions} IS NOT NULL AND trim(${attendeesTable.dietaryRestrictions}) != ''`,
        ),

      // Registrations per day
      db
        .select({
          date: sql<string>`date(${registrationsTable.createdAt} AT TIME ZONE 'UTC')`,
          count: sql<number>`cast(count(*) as int)`,
        })
        .from(registrationsTable)
        .groupBy(sql`date(${registrationsTable.createdAt} AT TIME ZONE 'UTC')`)
        .orderBy(asc(sql`date(${registrationsTable.createdAt} AT TIME ZONE 'UTC')`)),
    ]);

  const payMap = Object.fromEntries(paymentCounts.map((p) => [p.paymentStatus, p.count]));

  res.json({
    totalRegistrations: totals[0]?.totalRegistrations ?? 0,
    totalAttendees: totals[0]?.totalAttendees ?? 0,
    paidCount: payMap["paid"] ?? 0,
    pendingCount: payMap["pending"] ?? 0,
    waivedCount: payMap["waived"] ?? 0,
    dietaryCount: dietaryCount[0]?.count ?? 0,
    byGroup,
    byShirtSize,
    registrationsOverTime: overTime,
  });
});

// ──────────────────────────────────────────────────────────────
// Announcements CRUD
// ──────────────────────────────────────────────────────────────

router.post("/admin/announcements", async (req, res): Promise<void> => {
  const body = AdminCreateAnnouncementBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [created] = await db
    .insert(announcementsTable)
    .values({
      title: body.data.title,
      body: body.data.body,
      pinned: body.data.pinned ?? false,
    })
    .returning();

  res.status(201).json(created);
});

router.put("/admin/announcements/:id", async (req, res): Promise<void> => {
  const params = AdminUpdateAnnouncementParams.safeParse(req.params);
  const body = AdminUpdateAnnouncementBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }

  const [updated] = await db
    .update(announcementsTable)
    .set({
      title: body.data.title,
      body: body.data.body,
      pinned: body.data.pinned ?? false,
    })
    .where(eq(announcementsTable.id, params.data.id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Announcement not found" });
    return;
  }

  res.json(updated);
});

router.delete("/admin/announcements/:id", async (req, res): Promise<void> => {
  const params = AdminDeleteAnnouncementParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const [deleted] = await db
    .delete(announcementsTable)
    .where(eq(announcementsTable.id, params.data.id))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "Announcement not found" });
    return;
  }

  res.status(204).send();
});

// ──────────────────────────────────────────────────────────────
// Schedule CRUD
// ──────────────────────────────────────────────────────────────

router.post("/admin/schedule", async (req, res): Promise<void> => {
  const body = AdminCreateScheduleItemBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [created] = await db
    .insert(scheduleItemsTable)
    .values({
      day: body.data.day,
      startTime: body.data.startTime,
      endTime: body.data.endTime ?? null,
      title: body.data.title,
      description: body.data.description ?? null,
      location: body.data.location ?? null,
      sortOrder: body.data.sortOrder ?? 0,
    })
    .returning();

  res.status(201).json(created);
});

router.put("/admin/schedule/:id", async (req, res): Promise<void> => {
  const params = AdminUpdateScheduleItemParams.safeParse(req.params);
  const body = AdminUpdateScheduleItemBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }

  const [updated] = await db
    .update(scheduleItemsTable)
    .set({
      day: body.data.day,
      startTime: body.data.startTime,
      endTime: body.data.endTime ?? null,
      title: body.data.title,
      description: body.data.description ?? null,
      location: body.data.location ?? null,
      sortOrder: body.data.sortOrder ?? 0,
    })
    .where(eq(scheduleItemsTable.id, params.data.id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Schedule item not found" });
    return;
  }

  res.json(updated);
});

router.delete("/admin/schedule/:id", async (req, res): Promise<void> => {
  const params = AdminDeleteScheduleItemParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const [deleted] = await db
    .delete(scheduleItemsTable)
    .where(eq(scheduleItemsTable.id, params.data.id))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "Schedule item not found" });
    return;
  }

  res.status(204).send();
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

  // Return with registration stats
  const [stats] = await db
    .select({
      registrationCount: sql<number>`cast(count(*) as int)`,
      attendeeCount: sql<number>`cast(coalesce(sum(${registrationsTable.attendeeCount}), 0) as int)`,
    })
    .from(registrationsTable)
    .where(eq(registrationsTable.userId, updated.id));

  res.json({ ...updated, registrationCount: stats?.registrationCount ?? 0, attendeeCount: stats?.attendeeCount ?? 0 });
});

export default router;
