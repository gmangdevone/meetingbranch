import { Router, type IRouter } from "express";
import { eq, desc, asc, sql, and } from "drizzle-orm";
import {
  db,
  reunionsTable,
  reunionBranchesTable,
  reunionFeesTable,
  reunionOrganizersTable,
  registrationsTable,
  registrationFeesTable,
  attendeesTable,
  usersTable,
  announcementsTable,
  scheduleItemsTable,
} from "@workspace/db";
import {
  CreateReunionBody,
  CreateReunionResponse,
  ListMyReunionsResponse,
  GetReunionByCodeResponse,
  GetReunionResponse,
  UpdateReunionBody,
  UpdateReunionResponse,
  GetReunionSummaryResponse,
  ListReunionAnnouncementsResponse,
  ListReunionScheduleResponse,
  CreateAnnouncementBody,
  UpdateAnnouncementBody,
  CreateScheduleItemBody,
  UpdateScheduleItemBody,
  CreateBranchBody,
  UpdateBranchBody,
  ListReunionRegistrationsResponse,
  UpdateRegistrationPaymentBody,
  GetReunionReportsResponse,
  ListReunionOrganizersResponse,
  AddReunionOrganizerBody,
  TransferReunionOwnershipBody,
  CreateFeeBody,
  UpdateFeeBody,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { attachAuth } from "../middlewares/requireAdmin";
import {
  requireReunionManager,
  requireReunionOwner,
} from "../middlewares/requireReunionManager";
import { generateUniqueReunionCode } from "../lib/reunionCode";
import { getOrCreateSettings } from "../lib/settings";
import { upsertUserFromClerk } from "../lib/users";

const router: IRouter = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────
async function getReunionWithBranches(reunionId: number) {
  const [reunion] = await db
    .select()
    .from(reunionsTable)
    .where(eq(reunionsTable.id, reunionId));
  if (!reunion) return null;
  const branches = await db
    .select()
    .from(reunionBranchesTable)
    .where(eq(reunionBranchesTable.reunionId, reunionId))
    .orderBy(asc(reunionBranchesTable.sortOrder), asc(reunionBranchesTable.id));
  const fees = await db
    .select()
    .from(reunionFeesTable)
    .where(eq(reunionFeesTable.reunionId, reunionId))
    .orderBy(asc(reunionFeesTable.sortOrder), asc(reunionFeesTable.id));
  return { ...reunion, branches, fees };
}

/**
 * Normalize fee input: age tiering only applies to per-person fees, and requires
 * BOTH an age threshold and an under-threshold amount to be meaningful. Anything
 * else clears the tier so we never store a half-configured tier.
 */
function normalizeFeeInput(data: {
  label: string;
  chargeType: "per_person" | "flat";
  isOptional: boolean;
  amount: number;
  ageThreshold?: number | null;
  amountUnderThreshold?: number | null;
  sortOrder: number;
}) {
  const tierValid =
    data.chargeType === "per_person" &&
    data.ageThreshold != null &&
    data.amountUnderThreshold != null;
  return {
    label: data.label.trim(),
    chargeType: data.chargeType,
    isOptional: data.isOptional,
    amount: data.amount,
    ageThreshold: tierValid ? data.ageThreshold! : null,
    amountUnderThreshold: tierValid ? data.amountUnderThreshold! : null,
    sortOrder: data.sortOrder,
  };
}

async function getReunionSummaryPayload(reunionId: number) {
  const reunion = await getReunionWithBranches(reunionId);
  if (!reunion) return null;
  const [counts] = await db
    .select({
      registrationCount: sql<number>`cast(count(*) as int)`,
      attendeeCount: sql<number>`cast(coalesce(sum(${registrationsTable.attendeeCount}), 0) as int)`,
    })
    .from(registrationsTable)
    .where(eq(registrationsTable.reunionId, reunionId));
  return {
    reunion,
    registrationCount: counts?.registrationCount ?? 0,
    attendeeCount: counts?.attendeeCount ?? 0,
  };
}

// ── Create a reunion ──────────────────────────────────────────────────────────
router.post("/reunions", requireAuth, async (req, res): Promise<void> => {
  const settings = await getOrCreateSettings();
  if (!settings.reunionCreationEnabled) {
    res.status(403).json({ error: "Reunion creation is currently disabled." });
    return;
  }

  const parsed = CreateReunionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const userId = (req as any).userId as string;

  // JIT-provision the organizer's user row with authoritative Clerk profile data
  await upsertUserFromClerk(userId, req.log);

  const code = await generateUniqueReunionCode();
  const { name, startDate, endDate, feePerPerson, paymentHandle, paymentUrl, branches } =
    parsed.data;

  const [reunion] = await db
    .insert(reunionsTable)
    .values({
      code,
      name,
      startDate,
      endDate,
      paymentHandle,
      paymentUrl: paymentUrl ?? null,
      organizerId: userId,
    })
    .returning();

  // Seed the initial per-person "Registration Fee" from the provided amount.
  // Organizers can relabel it and add more fees & dues from settings afterwards.
  await db.insert(reunionFeesTable).values({
    reunionId: reunion.id,
    label: "Registration Fee",
    chargeType: "per_person",
    isOptional: false,
    amount: feePerPerson,
    sortOrder: 0,
  });

  // De-dupe branch names, preserve order
  const seen = new Set<string>();
  const branchRows = branches
    .map((b) => b.trim())
    .filter((b) => b.length > 0 && !seen.has(b.toLowerCase()) && seen.add(b.toLowerCase()))
    .map((name, i) => ({ reunionId: reunion.id, name, sortOrder: i }));

  if (branchRows.length > 0) {
    await db.insert(reunionBranchesTable).values(branchRows);
  }

  const full = await getReunionWithBranches(reunion.id);
  res.status(201).json(CreateReunionResponse.parse(full));
});

// ── Reunions I organize ───────────────────────────────────────────────────────
router.get("/reunions/mine", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as any).userId as string;
  // Reunions I own, plus reunions where I'm an added co-organizer.
  const owned = await db
    .select()
    .from(reunionsTable)
    .where(eq(reunionsTable.organizerId, userId));
  const coOrganized = await db
    .select({ reunion: reunionsTable })
    .from(reunionOrganizersTable)
    .innerJoin(reunionsTable, eq(reunionOrganizersTable.reunionId, reunionsTable.id))
    .where(eq(reunionOrganizersTable.userId, userId));

  const byId = new Map<number, (typeof owned)[number]>();
  for (const r of owned) byId.set(r.id, r);
  for (const { reunion } of coOrganized) byId.set(reunion.id, reunion);

  const mine = [...byId.values()].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  const withDetail = await Promise.all(
    mine.map(async (r) => (await getReunionSummaryPayload(r.id))!),
  );
  res.json(ListMyReunionsResponse.parse(withDetail));
});

// ── Public lookup by code ─────────────────────────────────────────────────────
router.get("/reunions/by-code/:code", async (req, res): Promise<void> => {
  const code = String(req.params.code).toUpperCase();
  const [reunion] = await db
    .select()
    .from(reunionsTable)
    .where(eq(reunionsTable.code, code));
  if (!reunion) {
    res.status(404).json({ error: "No reunion found with that code." });
    return;
  }
  const full = await getReunionWithBranches(reunion.id);
  // Public endpoint: never expose the organizer's internal user id.
  const { organizerId, ...pub } = full!;
  res.json(GetReunionByCodeResponse.parse(pub));
});

// ── Public summary ────────────────────────────────────────────────────────────
router.get("/reunions/:reunionId/summary", async (req, res): Promise<void> => {
  const reunionId = Number(req.params.reunionId);
  if (!Number.isInteger(reunionId)) {
    res.status(400).json({ error: "Invalid reunion id" });
    return;
  }
  const byGroup = await db
    .select({
      branchName: registrationsTable.branchName,
      registrationCount: sql<number>`cast(count(*) as int)`,
      attendeeCount: sql<number>`cast(sum(${registrationsTable.attendeeCount}) as int)`,
    })
    .from(registrationsTable)
    .where(eq(registrationsTable.reunionId, reunionId))
    .groupBy(registrationsTable.branchName)
    .orderBy(registrationsTable.branchName);

  const [total] = await db
    .select({
      totalRegistrations: sql<number>`cast(count(*) as int)`,
      totalAttendees: sql<number>`cast(coalesce(sum(${registrationsTable.attendeeCount}), 0) as int)`,
    })
    .from(registrationsTable)
    .where(eq(registrationsTable.reunionId, reunionId));

  res.json(
    GetReunionSummaryResponse.parse({
      totalRegistrations: total?.totalRegistrations ?? 0,
      totalAttendees: total?.totalAttendees ?? 0,
      byGroup,
    }),
  );
});

// ── Public announcements list ─────────────────────────────────────────────────
router.get("/reunions/:reunionId/announcements", async (req, res): Promise<void> => {
  const reunionId = Number(req.params.reunionId);
  if (!Number.isInteger(reunionId)) {
    res.status(400).json({ error: "Invalid reunion id" });
    return;
  }
  const items = await db
    .select()
    .from(announcementsTable)
    .where(eq(announcementsTable.reunionId, reunionId))
    .orderBy(desc(announcementsTable.pinned), desc(announcementsTable.createdAt));
  res.json(ListReunionAnnouncementsResponse.parse(items));
});

// ── Public schedule list ──────────────────────────────────────────────────────
router.get("/reunions/:reunionId/schedule", async (req, res): Promise<void> => {
  const reunionId = Number(req.params.reunionId);
  if (!Number.isInteger(reunionId)) {
    res.status(400).json({ error: "Invalid reunion id" });
    return;
  }
  const items = await db
    .select()
    .from(scheduleItemsTable)
    .where(eq(scheduleItemsTable.reunionId, reunionId))
    .orderBy(asc(scheduleItemsTable.sortOrder), asc(scheduleItemsTable.id));
  res.json(ListReunionScheduleResponse.parse(items));
});

// ═══════════════════════════════════════════════════════════════════════════════
// Management endpoints (organizer of the reunion OR platform admin)
// ═══════════════════════════════════════════════════════════════════════════════
const manage = [attachAuth, requireReunionManager] as const;

// Reunion detail for management
router.get("/reunions/:reunionId", ...manage, async (req, res): Promise<void> => {
  const payload = await getReunionSummaryPayload(req.managedReunion!.id);
  res.json(GetReunionResponse.parse(payload));
});

// Update reunion settings
router.put("/reunions/:reunionId", ...manage, async (req, res): Promise<void> => {
  const body = UpdateReunionBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const { name, startDate, endDate, paymentHandle, paymentUrl } = body.data;
  await db
    .update(reunionsTable)
    .set({
      name,
      startDate,
      endDate,
      paymentHandle,
      paymentUrl: paymentUrl ?? null,
    })
    .where(eq(reunionsTable.id, req.managedReunion!.id));
  const full = await getReunionWithBranches(req.managedReunion!.id);
  res.json(UpdateReunionResponse.parse(full));
});

// ── Branches ──────────────────────────────────────────────────────────────────
router.post("/reunions/:reunionId/branches", ...manage, async (req, res): Promise<void> => {
  const body = CreateBranchBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [created] = await db
    .insert(reunionBranchesTable)
    .values({
      reunionId: req.managedReunion!.id,
      name: body.data.name.trim(),
      sortOrder: body.data.sortOrder ?? 0,
    })
    .returning();
  res.status(201).json(created);
});

router.put("/reunions/:reunionId/branches/:branchId", ...manage, async (req, res): Promise<void> => {
  const body = UpdateBranchBody.safeParse(req.body);
  const branchId = Number(req.params.branchId);
  if (!body.success || !Number.isInteger(branchId)) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const [updated] = await db
    .update(reunionBranchesTable)
    .set({ name: body.data.name.trim(), sortOrder: body.data.sortOrder ?? 0 })
    .where(
      and(
        eq(reunionBranchesTable.id, branchId),
        eq(reunionBranchesTable.reunionId, req.managedReunion!.id),
      ),
    )
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Branch not found" });
    return;
  }
  res.json(updated);
});

router.delete("/reunions/:reunionId/branches/:branchId", ...manage, async (req, res): Promise<void> => {
  const branchId = Number(req.params.branchId);
  if (!Number.isInteger(branchId)) {
    res.status(400).json({ error: "Invalid branch id" });
    return;
  }
  const [deleted] = await db
    .delete(reunionBranchesTable)
    .where(
      and(
        eq(reunionBranchesTable.id, branchId),
        eq(reunionBranchesTable.reunionId, req.managedReunion!.id),
      ),
    )
    .returning();
  if (!deleted) {
    res.status(404).json({ error: "Branch not found" });
    return;
  }
  res.status(204).send();
});

// ── Fees & dues (manage) ──────────────────────────────────────────────────────
router.post("/reunions/:reunionId/fees", ...manage, async (req, res): Promise<void> => {
  const body = CreateFeeBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [created] = await db
    .insert(reunionFeesTable)
    .values({
      reunionId: req.managedReunion!.id,
      ...normalizeFeeInput(body.data),
    })
    .returning();
  res.status(201).json(created);
});

router.put("/reunions/:reunionId/fees/:feeId", ...manage, async (req, res): Promise<void> => {
  const body = UpdateFeeBody.safeParse(req.body);
  const feeId = Number(req.params.feeId);
  if (!body.success || !Number.isInteger(feeId)) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const [updated] = await db
    .update(reunionFeesTable)
    .set(normalizeFeeInput(body.data))
    .where(
      and(
        eq(reunionFeesTable.id, feeId),
        eq(reunionFeesTable.reunionId, req.managedReunion!.id),
      ),
    )
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Fee not found" });
    return;
  }
  res.json(updated);
});

router.delete("/reunions/:reunionId/fees/:feeId", ...manage, async (req, res): Promise<void> => {
  const feeId = Number(req.params.feeId);
  if (!Number.isInteger(feeId)) {
    res.status(400).json({ error: "Invalid fee id" });
    return;
  }
  const [deleted] = await db
    .delete(reunionFeesTable)
    .where(
      and(
        eq(reunionFeesTable.id, feeId),
        eq(reunionFeesTable.reunionId, req.managedReunion!.id),
      ),
    )
    .returning();
  if (!deleted) {
    res.status(404).json({ error: "Fee not found" });
    return;
  }
  res.status(204).send();
});

// ── Announcements (manage) ────────────────────────────────────────────────────
router.post("/reunions/:reunionId/announcements", ...manage, async (req, res): Promise<void> => {
  const body = CreateAnnouncementBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [created] = await db
    .insert(announcementsTable)
    .values({
      reunionId: req.managedReunion!.id,
      title: body.data.title,
      body: body.data.body,
      pinned: body.data.pinned ?? false,
    })
    .returning();
  res.status(201).json(created);
});

router.put("/reunions/:reunionId/announcements/:announcementId", ...manage, async (req, res): Promise<void> => {
  const body = UpdateAnnouncementBody.safeParse(req.body);
  const announcementId = Number(req.params.announcementId);
  if (!body.success || !Number.isInteger(announcementId)) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const [updated] = await db
    .update(announcementsTable)
    .set({ title: body.data.title, body: body.data.body, pinned: body.data.pinned ?? false })
    .where(
      and(
        eq(announcementsTable.id, announcementId),
        eq(announcementsTable.reunionId, req.managedReunion!.id),
      ),
    )
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Announcement not found" });
    return;
  }
  res.json(updated);
});

router.delete("/reunions/:reunionId/announcements/:announcementId", ...manage, async (req, res): Promise<void> => {
  const announcementId = Number(req.params.announcementId);
  if (!Number.isInteger(announcementId)) {
    res.status(400).json({ error: "Invalid announcement id" });
    return;
  }
  const [deleted] = await db
    .delete(announcementsTable)
    .where(
      and(
        eq(announcementsTable.id, announcementId),
        eq(announcementsTable.reunionId, req.managedReunion!.id),
      ),
    )
    .returning();
  if (!deleted) {
    res.status(404).json({ error: "Announcement not found" });
    return;
  }
  res.status(204).send();
});

// ── Schedule (manage) ─────────────────────────────────────────────────────────
router.post("/reunions/:reunionId/schedule", ...manage, async (req, res): Promise<void> => {
  const body = CreateScheduleItemBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [created] = await db
    .insert(scheduleItemsTable)
    .values({
      reunionId: req.managedReunion!.id,
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

router.put("/reunions/:reunionId/schedule/:scheduleId", ...manage, async (req, res): Promise<void> => {
  const body = UpdateScheduleItemBody.safeParse(req.body);
  const scheduleId = Number(req.params.scheduleId);
  if (!body.success || !Number.isInteger(scheduleId)) {
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
    .where(
      and(
        eq(scheduleItemsTable.id, scheduleId),
        eq(scheduleItemsTable.reunionId, req.managedReunion!.id),
      ),
    )
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Schedule item not found" });
    return;
  }
  res.json(updated);
});

router.delete("/reunions/:reunionId/schedule/:scheduleId", ...manage, async (req, res): Promise<void> => {
  const scheduleId = Number(req.params.scheduleId);
  if (!Number.isInteger(scheduleId)) {
    res.status(400).json({ error: "Invalid schedule id" });
    return;
  }
  const [deleted] = await db
    .delete(scheduleItemsTable)
    .where(
      and(
        eq(scheduleItemsTable.id, scheduleId),
        eq(scheduleItemsTable.reunionId, req.managedReunion!.id),
      ),
    )
    .returning();
  if (!deleted) {
    res.status(404).json({ error: "Schedule item not found" });
    return;
  }
  res.status(204).send();
});

// ── Registrations (manage) ────────────────────────────────────────────────────
router.get("/reunions/:reunionId/registrations", ...manage, async (req, res): Promise<void> => {
  const reunionId = req.managedReunion!.id;
  const rows = await db
    .select({
      id: registrationsTable.id,
      reunionId: registrationsTable.reunionId,
      userId: registrationsTable.userId,
      branchName: registrationsTable.branchName,
      attendeeCount: registrationsTable.attendeeCount,
      paymentStatus: registrationsTable.paymentStatus,
      createdAt: registrationsTable.createdAt,
      userEmail: usersTable.email,
      userName: sql<string | null>`
        CASE WHEN ${usersTable.firstName} IS NOT NULL
          THEN ${usersTable.firstName} || ' ' || COALESCE(${usersTable.lastName}, '')
          ELSE NULL END
      `,
    })
    .from(registrationsTable)
    .leftJoin(usersTable, eq(registrationsTable.userId, usersTable.id))
    .where(eq(registrationsTable.reunionId, reunionId))
    .orderBy(desc(registrationsTable.createdAt));

  const withAttendees = await Promise.all(
    rows.map(async (r) => {
      const [attendees, selectedFees] = await Promise.all([
        db.select().from(attendeesTable).where(eq(attendeesTable.registrationId, r.id)),
        db
          .select({ feeId: registrationFeesTable.feeId })
          .from(registrationFeesTable)
          .where(eq(registrationFeesTable.registrationId, r.id)),
      ]);
      return {
        ...r,
        attendees,
        selectedFeeIds: selectedFees.map((f) => f.feeId),
        userEmail: r.userEmail ?? "",
      };
    }),
  );

  res.json(ListReunionRegistrationsResponse.parse(withAttendees));
});

router.get("/reunions/:reunionId/registrations/export", ...manage, async (req, res): Promise<void> => {
  const reunion = req.managedReunion!;
  const rows = await db
    .select({
      id: registrationsTable.id,
      branchName: registrationsTable.branchName,
      attendeeCount: registrationsTable.attendeeCount,
      paymentStatus: registrationsTable.paymentStatus,
      createdAt: registrationsTable.createdAt,
      userEmail: usersTable.email,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
    })
    .from(registrationsTable)
    .leftJoin(usersTable, eq(registrationsTable.userId, usersTable.id))
    .where(eq(registrationsTable.reunionId, reunion.id))
    .orderBy(desc(registrationsTable.createdAt));

  const regIds = rows.map((r) => r.id);
  const attendeeRows =
    regIds.length > 0
      ? await db
          .select()
          .from(attendeesTable)
          .where(
            sql`${attendeesTable.registrationId} IN (${sql.join(regIds, sql`, `)})`,
          )
      : [];
  const attendeeMap = new Map<number, typeof attendeeRows>();
  for (const a of attendeeRows) {
    const list = attendeeMap.get(a.registrationId) ?? [];
    list.push(a);
    attendeeMap.set(a.registrationId, list);
  }

  const escape = (v: string | null | undefined) => `"${(v ?? "").replace(/"/g, '""')}"`;
  const csvLines: string[] = [
    "Registration ID,Branch,Registrant Email,First Name,Last Name,Attendee Count,Payment Status,Registered At,Attendee Names,Shirt Sizes,Dietary Restrictions",
  ];
  for (const r of rows) {
    const attendees = attendeeMap.get(r.id) ?? [];
    csvLines.push(
      [
        r.id,
        escape(r.branchName),
        escape(r.userEmail),
        escape(r.firstName),
        escape(r.lastName),
        r.attendeeCount,
        r.paymentStatus,
        new Date(r.createdAt).toISOString(),
        escape(attendees.map((a) => a.name).join("; ")),
        escape(attendees.map((a) => a.shirtSize).join("; ")),
        escape(attendees.map((a) => a.dietaryRestrictions ?? "").join("; ")),
      ].join(","),
    );
  }

  const slug = reunion.code.toLowerCase();
  res.setHeader("Content-Type", "text/csv");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${slug}-registrations-${new Date().toISOString().slice(0, 10)}.csv"`,
  );
  res.send(csvLines.join("\n"));
});

router.patch(
  "/reunions/:reunionId/registrations/:registrationId/payment",
  ...manage,
  async (req, res): Promise<void> => {
    const body = UpdateRegistrationPaymentBody.safeParse(req.body);
    const registrationId = Number(req.params.registrationId);
    if (!body.success || !Number.isInteger(registrationId)) {
      res.status(400).json({ error: "Invalid input" });
      return;
    }
    const [updated] = await db
      .update(registrationsTable)
      .set({ paymentStatus: body.data.paymentStatus })
      .where(
        and(
          eq(registrationsTable.id, registrationId),
          eq(registrationsTable.reunionId, req.managedReunion!.id),
        ),
      )
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Registration not found" });
      return;
    }
    const [attendees, selectedFees, [user]] = await Promise.all([
      db.select().from(attendeesTable).where(eq(attendeesTable.registrationId, updated.id)),
      db
        .select({ feeId: registrationFeesTable.feeId })
        .from(registrationFeesTable)
        .where(eq(registrationFeesTable.registrationId, updated.id)),
      db
        .select({
          email: usersTable.email,
          firstName: usersTable.firstName,
          lastName: usersTable.lastName,
        })
        .from(usersTable)
        .where(eq(usersTable.id, updated.userId)),
    ]);
    res.json({
      ...updated,
      attendees,
      selectedFeeIds: selectedFees.map((f) => f.feeId),
      userEmail: user?.email ?? "",
      userName: user?.firstName ? `${user.firstName} ${user.lastName ?? ""}`.trim() : null,
    });
  },
);

// ── Reports (manage) ──────────────────────────────────────────────────────────
router.get("/reunions/:reunionId/reports", ...manage, async (req, res): Promise<void> => {
  const reunionId = req.managedReunion!.id;
  const [totals, byGroup, byShirtSize, paymentCounts, dietaryCount, overTime] =
    await Promise.all([
      db
        .select({
          totalRegistrations: sql<number>`cast(count(*) as int)`,
          totalAttendees: sql<number>`cast(coalesce(sum(${registrationsTable.attendeeCount}), 0) as int)`,
        })
        .from(registrationsTable)
        .where(eq(registrationsTable.reunionId, reunionId)),
      db
        .select({
          branchName: registrationsTable.branchName,
          registrationCount: sql<number>`cast(count(*) as int)`,
          attendeeCount: sql<number>`cast(sum(${registrationsTable.attendeeCount}) as int)`,
        })
        .from(registrationsTable)
        .where(eq(registrationsTable.reunionId, reunionId))
        .groupBy(registrationsTable.branchName)
        .orderBy(registrationsTable.branchName),
      db
        .select({
          shirtSize: attendeesTable.shirtSize,
          count: sql<number>`cast(count(*) as int)`,
        })
        .from(attendeesTable)
        .innerJoin(registrationsTable, eq(attendeesTable.registrationId, registrationsTable.id))
        .where(eq(registrationsTable.reunionId, reunionId))
        .groupBy(attendeesTable.shirtSize)
        .orderBy(attendeesTable.shirtSize),
      db
        .select({
          paymentStatus: registrationsTable.paymentStatus,
          count: sql<number>`cast(count(*) as int)`,
        })
        .from(registrationsTable)
        .where(eq(registrationsTable.reunionId, reunionId))
        .groupBy(registrationsTable.paymentStatus),
      db
        .select({ count: sql<number>`cast(count(*) as int)` })
        .from(attendeesTable)
        .innerJoin(registrationsTable, eq(attendeesTable.registrationId, registrationsTable.id))
        .where(
          and(
            eq(registrationsTable.reunionId, reunionId),
            sql`${attendeesTable.dietaryRestrictions} IS NOT NULL AND trim(${attendeesTable.dietaryRestrictions}) != ''`,
          ),
        ),
      db
        .select({
          date: sql<string>`date(${registrationsTable.createdAt} AT TIME ZONE 'UTC')`,
          count: sql<number>`cast(count(*) as int)`,
        })
        .from(registrationsTable)
        .where(eq(registrationsTable.reunionId, reunionId))
        .groupBy(sql`date(${registrationsTable.createdAt} AT TIME ZONE 'UTC')`)
        .orderBy(asc(sql`date(${registrationsTable.createdAt} AT TIME ZONE 'UTC')`)),
    ]);

  const payMap = Object.fromEntries(paymentCounts.map((p) => [p.paymentStatus, p.count]));
  res.json(
    GetReunionReportsResponse.parse({
      totalRegistrations: totals[0]?.totalRegistrations ?? 0,
      totalAttendees: totals[0]?.totalAttendees ?? 0,
      paidCount: payMap["paid"] ?? 0,
      pendingCount: payMap["pending"] ?? 0,
      waivedCount: payMap["waived"] ?? 0,
      dietaryCount: dietaryCount[0]?.count ?? 0,
      byGroup,
      byShirtSize,
      registrationsOverTime: overTime,
    }),
  );
});

// ── Co-organizers (manage) ────────────────────────────────────────────────────
// List all organizers: the owner (isOwner=true) followed by added co-organizers.
router.get("/reunions/:reunionId/organizers", ...manage, async (req, res): Promise<void> => {
  const reunion = req.managedReunion!;

  const [owner] = await db
    .select({
      userId: usersTable.id,
      email: usersTable.email,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
    })
    .from(usersTable)
    .where(eq(usersTable.id, reunion.organizerId));

  const co = await db
    .select({
      userId: usersTable.id,
      email: usersTable.email,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
    })
    .from(reunionOrganizersTable)
    .innerJoin(usersTable, eq(reunionOrganizersTable.userId, usersTable.id))
    .where(eq(reunionOrganizersTable.reunionId, reunion.id))
    .orderBy(asc(reunionOrganizersTable.createdAt));

  const payload = [
    ...(owner
      ? [{ ...owner, isOwner: true }]
      : [{ userId: reunion.organizerId, email: "", firstName: null, lastName: null, isOwner: true }]),
    ...co.map((c) => ({ ...c, isOwner: false })),
  ];

  res.json(ListReunionOrganizersResponse.parse(payload));
});

// Add a co-organizer by their account email.
router.post("/reunions/:reunionId/organizers", ...manage, async (req, res): Promise<void> => {
  const body = AddReunionOrganizerBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const reunion = req.managedReunion!;
  const email = body.data.email.trim().toLowerCase();

  const [user] = await db
    .select()
    .from(usersTable)
    .where(sql`lower(${usersTable.email}) = ${email}`);

  if (!user) {
    res.status(404).json({
      error: "No FamJam account found with that email. Ask them to sign in once first.",
    });
    return;
  }

  if (user.id === reunion.organizerId) {
    res.status(409).json({ error: "That person is already the reunion owner." });
    return;
  }

  const [existing] = await db
    .select({ id: reunionOrganizersTable.id })
    .from(reunionOrganizersTable)
    .where(
      and(
        eq(reunionOrganizersTable.reunionId, reunion.id),
        eq(reunionOrganizersTable.userId, user.id),
      ),
    );
  if (existing) {
    res.status(409).json({ error: "That person is already a co-organizer." });
    return;
  }

  await db
    .insert(reunionOrganizersTable)
    .values({ reunionId: reunion.id, userId: user.id });

  res.status(201).json({
    userId: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    isOwner: false,
  });
});

// Remove a co-organizer. The owner cannot be removed here.
router.delete(
  "/reunions/:reunionId/organizers/:userId",
  ...manage,
  async (req, res): Promise<void> => {
    const reunion = req.managedReunion!;
    const userId = String(req.params.userId);

    if (userId === reunion.organizerId) {
      res.status(400).json({ error: "The reunion owner cannot be removed." });
      return;
    }

    const [deleted] = await db
      .delete(reunionOrganizersTable)
      .where(
        and(
          eq(reunionOrganizersTable.reunionId, reunion.id),
          eq(reunionOrganizersTable.userId, userId),
        ),
      )
      .returning();
    if (!deleted) {
      res.status(404).json({ error: "Co-organizer not found" });
      return;
    }
    res.status(204).send();
  },
);

// Transfer ownership to an existing co-organizer. Owner-only (guarded beyond the
// shared manager check). The previous owner is demoted to a co-organizer and the
// promoted user is removed from the co-organizers list (they are now the owner).
router.post(
  "/reunions/:reunionId/transfer-ownership",
  ...manage,
  requireReunionOwner,
  async (req, res): Promise<void> => {
    const body = TransferReunionOwnershipBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }
    const reunion = req.managedReunion!;
    const newOwnerId = body.data.userId;

    if (newOwnerId === reunion.organizerId) {
      res.status(400).json({ error: "That person is already the reunion owner." });
      return;
    }

    // The target must currently be a co-organizer of this reunion.
    const [coOrganizer] = await db
      .select({ id: reunionOrganizersTable.id })
      .from(reunionOrganizersTable)
      .where(
        and(
          eq(reunionOrganizersTable.reunionId, reunion.id),
          eq(reunionOrganizersTable.userId, newOwnerId),
        ),
      );
    if (!coOrganizer) {
      res.status(404).json({
        error: "You can only transfer ownership to an existing co-organizer.",
      });
      return;
    }

    const previousOwnerId = reunion.organizerId;

    await db.transaction(async (tx) => {
      // Promote: new owner becomes reunions.organizerId
      await tx
        .update(reunionsTable)
        .set({ organizerId: newOwnerId })
        .where(eq(reunionsTable.id, reunion.id));

      // Remove the new owner from the co-organizers list (they are now the owner)
      await tx
        .delete(reunionOrganizersTable)
        .where(
          and(
            eq(reunionOrganizersTable.reunionId, reunion.id),
            eq(reunionOrganizersTable.userId, newOwnerId),
          ),
        );

      // Demote: previous owner becomes a co-organizer (skip if somehow present)
      const [alreadyCo] = await tx
        .select({ id: reunionOrganizersTable.id })
        .from(reunionOrganizersTable)
        .where(
          and(
            eq(reunionOrganizersTable.reunionId, reunion.id),
            eq(reunionOrganizersTable.userId, previousOwnerId),
          ),
        );
      if (!alreadyCo) {
        await tx
          .insert(reunionOrganizersTable)
          .values({ reunionId: reunion.id, userId: previousOwnerId });
      }
    });

    // Return the refreshed organizer list (owner first, then co-organizers).
    const [owner] = await db
      .select({
        userId: usersTable.id,
        email: usersTable.email,
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
      })
      .from(usersTable)
      .where(eq(usersTable.id, newOwnerId));

    const co = await db
      .select({
        userId: usersTable.id,
        email: usersTable.email,
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
      })
      .from(reunionOrganizersTable)
      .innerJoin(usersTable, eq(reunionOrganizersTable.userId, usersTable.id))
      .where(eq(reunionOrganizersTable.reunionId, reunion.id))
      .orderBy(asc(reunionOrganizersTable.createdAt));

    const payload = [
      ...(owner
        ? [{ ...owner, isOwner: true }]
        : [{ userId: newOwnerId, email: "", firstName: null, lastName: null, isOwner: true }]),
      ...co.map((c) => ({ ...c, isOwner: false })),
    ];

    res.json(ListReunionOrganizersResponse.parse(payload));
  },
);

export default router;
