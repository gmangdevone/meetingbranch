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
  sponsorshipContributionsTable,
  sponsorshipAllocationsTable,
  REUNION_ROLES,
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
  CreateManagedRegistrationBody,
  CreateManagedRegistrationResponse,
  UpdateRegistrationPaymentBody,
  GetReunionReportsResponse,
  ListReunionOrganizersResponse,
  AddReunionOrganizerBody,
  UpdateOrganizerRolesBody,
  TransferReunionOwnershipBody,
  CreateFeeBody,
  UpdateFeeBody,
  CancelRegistrationBody,
  CreateSponsorshipAllocationBody,
  CreateSponsorshipContributionBody,
  GetMyContributionsResponse,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { attachAuth } from "../middlewares/requireAdmin";
import {
  requireReunionManager,
  requireReunionOwner,
  requireReunionPermission,
} from "../middlewares/requireReunionManager";
import { generateUniqueReunionCode } from "../lib/reunionCode";
import { computeTotal } from "../lib/fees";
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
 * Normalize fee input: age tiers only apply to per-person fees (flat fees get an
 * empty list). A null minAge means "and below"; a null maxAge means "and above".
 * Rejected (caller returns 400 when this returns null): a tier with both bounds
 * null, an inverted range (minAge > maxAge), or overlapping tiers.
 */
function normalizeFeeInput(data: {
  label: string;
  chargeType: "per_person" | "flat";
  isOptional: boolean;
  amount: number;
  ageTiers?: { minAge?: number | null; maxAge?: number | null; amount: number }[];
  sortOrder: number;
}) {
  const rawTiers = data.chargeType === "per_person" ? (data.ageTiers ?? []) : [];
  const tiers = rawTiers.map((t) => ({
    minAge: t.minAge ?? null,
    maxAge: t.maxAge ?? null,
    amount: t.amount,
  }));
  if (tiers.some((t) => t.minAge == null && t.maxAge == null)) return null;
  if (tiers.some((t) => t.minAge != null && t.maxAge != null && t.minAge > t.maxAge)) return null;
  // Treat null bounds as unbounded and reject any intersecting ranges.
  const sorted = [...tiers].sort(
    (a, b) => (a.minAge ?? Number.NEGATIVE_INFINITY) - (b.minAge ?? Number.NEGATIVE_INFINITY),
  );
  for (let i = 1; i < sorted.length; i++) {
    const prevMax = sorted[i - 1].maxAge ?? Number.POSITIVE_INFINITY;
    const curMin = sorted[i].minAge ?? Number.NEGATIVE_INFINITY;
    if (curMin <= prevMax) return null; // overlapping ranges
  }
  return {
    label: data.label.trim(),
    chargeType: data.chargeType,
    isOptional: data.isOptional,
    amount: data.amount,
    ageTiers: sorted,
    sortOrder: data.sortOrder,
  };
}

/** Active (non-cancelled) registrations of a reunion — cancelled ones never count. */
function activeInReunion(reunionId: number) {
  return and(
    eq(registrationsTable.reunionId, reunionId),
    eq(registrationsTable.status, "active"),
  );
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
    .where(
      and(
        eq(registrationsTable.reunionId, reunionId),
        eq(registrationsTable.status, "active"),
      ),
    );
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
    .where(
      and(
        eq(registrationsTable.reunionId, reunionId),
        eq(registrationsTable.status, "active"),
      ),
    )
    .groupBy(registrationsTable.branchName)
    .orderBy(registrationsTable.branchName);

  const [total] = await db
    .select({
      totalRegistrations: sql<number>`cast(count(*) as int)`,
      totalAttendees: sql<number>`cast(coalesce(sum(${registrationsTable.attendeeCount}), 0) as int)`,
    })
    .from(registrationsTable)
    .where(
      and(
        eq(registrationsTable.reunionId, reunionId),
        eq(registrationsTable.status, "active"),
      ),
    );

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

// Reunion detail for management. Open to any manager (even a co-organizer with
// no roles) so they can load the organize shell; the viewer's permissions ride
// along so the client can filter navigation and pages.
router.get("/reunions/:reunionId", ...manage, async (req, res): Promise<void> => {
  const payload = await getReunionSummaryPayload(req.managedReunion!.id);
  res.json(GetReunionResponse.parse({ ...payload, viewer: req.reunionAccess }));
});

// Update reunion settings (Power User area)
router.put(
  "/reunions/:reunionId",
  ...manage,
  requireReunionPermission("power_user"),
  async (req, res): Promise<void> => {
  const body = UpdateReunionBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const { name, startDate, endDate, paymentHandle, paymentUrl, registrationsOpen, allowRegistrantEdits, heroImageUrl, scheduleCardImageUrl, announcementsCardImageUrl, pollsCardImageUrl } = body.data;
  // Partial update: only fields present in the request body are changed, so
  // concurrent editors can't clobber each other's unrelated settings.
  const updates = {
    ...(name === undefined ? {} : { name }),
    ...(startDate === undefined ? {} : { startDate }),
    ...(endDate === undefined ? {} : { endDate }),
    ...(paymentHandle === undefined ? {} : { paymentHandle }),
    ...(paymentUrl === undefined ? {} : { paymentUrl: paymentUrl || null }),
    ...(registrationsOpen === undefined ? {} : { registrationsOpen }),
    ...(allowRegistrantEdits === undefined ? {} : { allowRegistrantEdits }),
    ...(heroImageUrl === undefined ? {} : { heroImageUrl: heroImageUrl || null }),
    ...(scheduleCardImageUrl === undefined ? {} : { scheduleCardImageUrl: scheduleCardImageUrl || null }),
    ...(announcementsCardImageUrl === undefined ? {} : { announcementsCardImageUrl: announcementsCardImageUrl || null }),
    ...(pollsCardImageUrl === undefined ? {} : { pollsCardImageUrl: pollsCardImageUrl || null }),
  };
  if (Object.keys(updates).length > 0) {
    await db
      .update(reunionsTable)
      .set(updates)
      .where(eq(reunionsTable.id, req.managedReunion!.id));
  }
  const full = await getReunionWithBranches(req.managedReunion!.id);
  res.json(UpdateReunionResponse.parse(full));
});

// ── Branches ──────────────────────────────────────────────────────────────────
router.post("/reunions/:reunionId/branches", ...manage, requireReunionPermission("branches"), async (req, res): Promise<void> => {
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

router.put("/reunions/:reunionId/branches/:branchId", ...manage, requireReunionPermission("branches"), async (req, res): Promise<void> => {
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

router.delete("/reunions/:reunionId/branches/:branchId", ...manage, requireReunionPermission("branches"), async (req, res): Promise<void> => {
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
router.post("/reunions/:reunionId/fees", ...manage, requireReunionPermission("power_user"), async (req, res): Promise<void> => {
  const body = CreateFeeBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const normalized = normalizeFeeInput(body.data);
  if (!normalized) {
    res.status(400).json({ error: "Age tiers must not overlap, and each tier's minimum age must not exceed its maximum age" });
    return;
  }
  const [created] = await db
    .insert(reunionFeesTable)
    .values({
      reunionId: req.managedReunion!.id,
      ...normalized,
    })
    .returning();
  res.status(201).json(created);
});

router.put("/reunions/:reunionId/fees/:feeId", ...manage, requireReunionPermission("power_user"), async (req, res): Promise<void> => {
  const body = UpdateFeeBody.safeParse(req.body);
  const feeId = Number(req.params.feeId);
  if (!body.success || !Number.isInteger(feeId)) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const normalizedUpdate = normalizeFeeInput(body.data);
  if (!normalizedUpdate) {
    res.status(400).json({ error: "Age tiers must not overlap, and each tier's minimum age must not exceed its maximum age" });
    return;
  }
  const [updated] = await db
    .update(reunionFeesTable)
    .set(normalizedUpdate)
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

router.delete("/reunions/:reunionId/fees/:feeId", ...manage, requireReunionPermission("power_user"), async (req, res): Promise<void> => {
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
router.post("/reunions/:reunionId/announcements", ...manage, requireReunionPermission("announcements"), async (req, res): Promise<void> => {
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

router.put("/reunions/:reunionId/announcements/:announcementId", ...manage, requireReunionPermission("announcements"), async (req, res): Promise<void> => {
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

router.delete("/reunions/:reunionId/announcements/:announcementId", ...manage, requireReunionPermission("announcements"), async (req, res): Promise<void> => {
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
router.post("/reunions/:reunionId/schedule", ...manage, requireReunionPermission("schedule"), async (req, res): Promise<void> => {
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

router.put("/reunions/:reunionId/schedule/:scheduleId", ...manage, requireReunionPermission("schedule"), async (req, res): Promise<void> => {
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

router.delete("/reunions/:reunionId/schedule/:scheduleId", ...manage, requireReunionPermission("schedule"), async (req, res): Promise<void> => {
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
router.get("/reunions/:reunionId/registrations", ...manage, requireReunionPermission("registration"), async (req, res): Promise<void> => {
  const reunionId = req.managedReunion!.id;
  const rows = await db
    .select({
      id: registrationsTable.id,
      reunionId: registrationsTable.reunionId,
      userId: registrationsTable.userId,
      branchName: registrationsTable.branchName,
      attendeeCount: registrationsTable.attendeeCount,
      paymentStatus: registrationsTable.paymentStatus,
      status: registrationsTable.status,
      cancellationResolution: registrationsTable.cancellationResolution,
      createdAt: registrationsTable.createdAt,
      userEmail: usersTable.email,
      userName: sql<string | null>`
        CASE WHEN ${usersTable.firstName} IS NOT NULL
          THEN ${usersTable.firstName} || ' ' || COALESCE(${usersTable.lastName}, '')
          ELSE NULL END
      `,
      registrantIsManaged: usersTable.isManaged,
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
        registrantIsManaged: r.registrantIsManaged ?? false,
      };
    }),
  );

  res.json(ListReunionRegistrationsResponse.parse(withAttendees));
});

// POST /reunions/:reunionId/registrations — organizer registers a family
// member who can't do it themselves. Creates a "managed" account (no Clerk
// identity, shared default contact email derived from the reunion name) and
// the registration in one transaction. Deliberately allowed even while
// registrations are closed — the organizer is acting on purpose.
router.post("/reunions/:reunionId/registrations", ...manage, requireReunionPermission("registration"), async (req, res): Promise<void> => {
  const body = CreateManagedRegistrationBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const reunion = req.managedReunion!;
  const { memberFirstName, memberLastName, branchName, attendees, selectedFeeIds } = body.data;

  // Same validations as self-service registration: branch + optional fees.
  const branches = await db
    .select({ name: reunionBranchesTable.name })
    .from(reunionBranchesTable)
    .where(eq(reunionBranchesTable.reunionId, reunion.id));
  if (branches.length > 0 && !branches.some((b) => b.name === branchName)) {
    res.status(400).json({ error: "Selected branch is not part of this reunion." });
    return;
  }
  const fees = await db
    .select()
    .from(reunionFeesTable)
    .where(eq(reunionFeesTable.reunionId, reunion.id));
  const optionalFeeIds = new Set(fees.filter((f) => f.isOptional).map((f) => f.id));
  const chosenFeeIds = [...new Set(selectedFeeIds ?? [])];
  if (!chosenFeeIds.every((id) => optionalFeeIds.has(id))) {
    res.status(400).json({ error: "One or more selected fees are not available for this reunion." });
    return;
  }

  // Shared default contact email derived from the reunion's family name.
  const slug =
    reunion.name.toLowerCase().replace(/[^a-z0-9]+/g, "") || "family";
  const defaultEmail = `${slug}@famjam.cg`;
  const managedUserId = `managed_${crypto.randomUUID()}`;

  const created = await db.transaction(async (tx) => {
    await tx.insert(usersTable).values({
      id: managedUserId,
      email: defaultEmail,
      firstName: memberFirstName.trim(),
      lastName: memberLastName?.trim() || null,
      isManaged: true,
    });
    const [registration] = await tx
      .insert(registrationsTable)
      .values({
        reunionId: reunion.id,
        userId: managedUserId,
        branchName,
        attendeeCount: attendees.length,
      })
      .returning();
    await tx.insert(attendeesTable).values(
      attendees.map((a) => ({
        registrationId: registration.id,
        name: a.name,
        shirtSize: a.shirtSize,
        dietaryRestrictions: a.dietaryRestrictions ?? null,
        age: a.age ?? null,
      })),
    );
    if (chosenFeeIds.length > 0) {
      await tx.insert(registrationFeesTable).values(
        chosenFeeIds.map((feeId) => ({ registrationId: registration.id, feeId })),
      );
    }
    return registration;
  });

  const [attendeeRows, feeRows] = await Promise.all([
    db.select().from(attendeesTable).where(eq(attendeesTable.registrationId, created.id)),
    db
      .select({ feeId: registrationFeesTable.feeId })
      .from(registrationFeesTable)
      .where(eq(registrationFeesTable.registrationId, created.id)),
  ]);
  const memberName = [memberFirstName.trim(), memberLastName?.trim()].filter(Boolean).join(" ");

  res.status(201).json(
    CreateManagedRegistrationResponse.parse({
      ...created,
      userEmail: defaultEmail,
      userName: memberName,
      registrantIsManaged: true,
      attendees: attendeeRows,
      selectedFeeIds: feeRows.map((f) => f.feeId),
    }),
  );
});

router.get("/reunions/:reunionId/registrations/export", ...manage, requireReunionPermission("registration"), async (req, res): Promise<void> => {
  const reunion = req.managedReunion!;
  const rows = await db
    .select({
      id: registrationsTable.id,
      branchName: registrationsTable.branchName,
      attendeeCount: registrationsTable.attendeeCount,
      paymentStatus: registrationsTable.paymentStatus,
      status: registrationsTable.status,
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
    "Registration ID,Branch,Registrant Email,First Name,Last Name,Attendee Count,Payment Status,Status,Registered At,Attendee Names,Shirt Sizes,Dietary Restrictions",
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
        r.status,
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
  requireReunionPermission("registration"),
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
router.get("/reunions/:reunionId/reports", ...manage, requireReunionPermission("reports"), async (req, res): Promise<void> => {
  const reunionId = req.managedReunion!.id;
  const [totals, byGroup, byShirtSize, paymentCounts, dietaryCount, overTime] =
    await Promise.all([
      db
        .select({
          totalRegistrations: sql<number>`cast(count(*) as int)`,
          totalAttendees: sql<number>`cast(coalesce(sum(${registrationsTable.attendeeCount}), 0) as int)`,
        })
        .from(registrationsTable)
        .where(activeInReunion(reunionId)),
      db
        .select({
          branchName: registrationsTable.branchName,
          registrationCount: sql<number>`cast(count(*) as int)`,
          attendeeCount: sql<number>`cast(sum(${registrationsTable.attendeeCount}) as int)`,
        })
        .from(registrationsTable)
        .where(activeInReunion(reunionId))
        .groupBy(registrationsTable.branchName)
        .orderBy(registrationsTable.branchName),
      db
        .select({
          shirtSize: attendeesTable.shirtSize,
          count: sql<number>`cast(count(*) as int)`,
        })
        .from(attendeesTable)
        .innerJoin(registrationsTable, eq(attendeesTable.registrationId, registrationsTable.id))
        .where(activeInReunion(reunionId))
        .groupBy(attendeesTable.shirtSize)
        .orderBy(attendeesTable.shirtSize),
      db
        .select({
          paymentStatus: registrationsTable.paymentStatus,
          count: sql<number>`cast(count(*) as int)`,
        })
        .from(registrationsTable)
        .where(activeInReunion(reunionId))
        .groupBy(registrationsTable.paymentStatus),
      db
        .select({ count: sql<number>`cast(count(*) as int)` })
        .from(attendeesTable)
        .innerJoin(registrationsTable, eq(attendeesTable.registrationId, registrationsTable.id))
        .where(
          and(
            activeInReunion(reunionId),
            sql`${attendeesTable.dietaryRestrictions} IS NOT NULL AND trim(${attendeesTable.dietaryRestrictions}) != ''`,
          ),
        ),
      db
        .select({
          date: sql<string>`date(${registrationsTable.createdAt} AT TIME ZONE 'UTC')`,
          count: sql<number>`cast(count(*) as int)`,
        })
        .from(registrationsTable)
        .where(activeInReunion(reunionId))
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
// Owner-only (plus platform admin) — co-organizers cannot manage the roster.
router.get("/reunions/:reunionId/organizers", ...manage, requireReunionOwner, async (req, res): Promise<void> => {
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
      roles: reunionOrganizersTable.roles,
    })
    .from(reunionOrganizersTable)
    .innerJoin(usersTable, eq(reunionOrganizersTable.userId, usersTable.id))
    .where(eq(reunionOrganizersTable.reunionId, reunion.id))
    .orderBy(asc(reunionOrganizersTable.createdAt));

  const payload = [
    ...(owner
      ? [{ ...owner, isOwner: true, roles: [] }]
      : [{ userId: reunion.organizerId, email: "", firstName: null, lastName: null, isOwner: true, roles: [] }]),
    ...co.map((c) => ({ ...c, roles: c.roles ?? [], isOwner: false })),
  ];

  res.json(ListReunionOrganizersResponse.parse(payload));
});

// Add a co-organizer by their account email. Owner-only (plus platform admin).
router.post("/reunions/:reunionId/organizers", ...manage, requireReunionOwner, async (req, res): Promise<void> => {
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

  const roles = body.data.roles ?? [];
  await db
    .insert(reunionOrganizersTable)
    .values({ reunionId: reunion.id, userId: user.id, roles });

  res.status(201).json({
    userId: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    isOwner: false,
    roles,
  });
});

// Remove a co-organizer. The owner cannot be removed here. Owner-only.
router.delete(
  "/reunions/:reunionId/organizers/:userId",
  ...manage,
  requireReunionOwner,
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
        // The demoted previous owner keeps every role so they retain full
        // management access as a co-organizer after the handoff.
        await tx
          .insert(reunionOrganizersTable)
          .values({ reunionId: reunion.id, userId: previousOwnerId, roles: [...REUNION_ROLES] });
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
        roles: reunionOrganizersTable.roles,
      })
      .from(reunionOrganizersTable)
      .innerJoin(usersTable, eq(reunionOrganizersTable.userId, usersTable.id))
      .where(eq(reunionOrganizersTable.reunionId, reunion.id))
      .orderBy(asc(reunionOrganizersTable.createdAt));

    const payload = [
      ...(owner
        ? [{ ...owner, isOwner: true, roles: [] }]
        : [{ userId: newOwnerId, email: "", firstName: null, lastName: null, isOwner: true, roles: [] }]),
      ...co.map((c) => ({ ...c, roles: c.roles ?? [], isOwner: false })),
    ];

    res.json(ListReunionOrganizersResponse.parse(payload));
  },
);

// Update a co-organizer's roles. Owner-only (plus platform admin). The owner
// cannot be given a role set here — their access is implicit and full.
router.put(
  "/reunions/:reunionId/organizers/:userId/roles",
  ...manage,
  requireReunionOwner,
  async (req, res): Promise<void> => {
    const reunion = req.managedReunion!;
    const userId = String(req.params.userId);

    const body = UpdateOrganizerRolesBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }

    if (userId === reunion.organizerId) {
      res.status(400).json({ error: "The reunion owner already has full access." });
      return;
    }

    const [updated] = await db
      .update(reunionOrganizersTable)
      .set({ roles: body.data.roles })
      .where(
        and(
          eq(reunionOrganizersTable.reunionId, reunion.id),
          eq(reunionOrganizersTable.userId, userId),
        ),
      )
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Co-organizer not found" });
      return;
    }

    const [user] = await db
      .select({
        userId: usersTable.id,
        email: usersTable.email,
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
      })
      .from(usersTable)
      .where(eq(usersTable.id, userId));

    res.json({
      userId,
      email: user?.email ?? "",
      firstName: user?.firstName ?? null,
      lastName: user?.lastName ?? null,
      isOwner: false,
      roles: updated.roles ?? [],
    });
  },
);

// ── Cancellation & sponsorship fund ─────────────────────────────────────────

async function adminRegistrationShape(reg: typeof registrationsTable.$inferSelect) {
  const [attendees, selectedFees, [user]] = await Promise.all([
    db.select().from(attendeesTable).where(eq(attendeesTable.registrationId, reg.id)),
    db
      .select({ feeId: registrationFeesTable.feeId })
      .from(registrationFeesTable)
      .where(eq(registrationFeesTable.registrationId, reg.id)),
    db
      .select({
        email: usersTable.email,
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
        isManaged: usersTable.isManaged,
      })
      .from(usersTable)
      .where(eq(usersTable.id, reg.userId)),
  ]);
  return {
    ...reg,
    attendees,
    selectedFeeIds: selectedFees.map((f) => f.feeId),
    userEmail: user?.email ?? "",
    userName: user?.firstName ? `${user.firstName} ${user.lastName ?? ""}`.trim() : null,
    registrantIsManaged: user?.isManaged ?? false,
  };
}

// POST /reunions/:reunionId/registrations/:registrationId/cancel
// Cancelling is an organizer action (registration area). When the household
// had paid, the organizer chooses: refund outside the app, or donate the paid
// amount to the sponsorship fund.
router.post(
  "/reunions/:reunionId/registrations/:registrationId/cancel",
  ...manage,
  requireReunionPermission("registration"),
  async (req, res): Promise<void> => {
    const body = CancelRegistrationBody.safeParse(req.body ?? {});
    const registrationId = Number(req.params.registrationId);
    if (!body.success || !Number.isInteger(registrationId)) {
      res.status(400).json({ error: "Invalid input" });
      return;
    }

    const [reg] = await db
      .select()
      .from(registrationsTable)
      .where(
        and(
          eq(registrationsTable.id, registrationId),
          eq(registrationsTable.reunionId, req.managedReunion!.id),
        ),
      );
    if (!reg) {
      res.status(404).json({ error: "Registration not found" });
      return;
    }
    if (reg.status === "cancelled") {
      res.status(400).json({ error: "This registration is already cancelled." });
      return;
    }

    const wasPaid = reg.paymentStatus === "paid";
    if (wasPaid && !body.data.resolution) {
      res.status(400).json({
        error: "This registration is paid — choose whether to refund or donate the payment.",
      });
      return;
    }
    const resolution = wasPaid ? body.data.resolution! : "no_payment";

    if (resolution === "donated_to_fund") {
      const [fees, attendees, selectedFees] = await Promise.all([
        db
          .select()
          .from(reunionFeesTable)
          .where(eq(reunionFeesTable.reunionId, reg.reunionId)),
        db.select().from(attendeesTable).where(eq(attendeesTable.registrationId, reg.id)),
        db
          .select({ feeId: registrationFeesTable.feeId })
          .from(registrationFeesTable)
          .where(eq(registrationFeesTable.registrationId, reg.id)),
      ]);
      const paidAmount = computeTotal(
        fees,
        attendees,
        selectedFees.map((f) => f.feeId),
      );
      // Donation + cancellation must land together.
      const updated = await db.transaction(async (tx) => {
        if (paidAmount > 0) {
          await tx.insert(sponsorshipContributionsTable).values({
            reunionId: reg.reunionId,
            registrationId: reg.id,
            contributorUserId: reg.userId,
            amount: paidAmount,
            source: "cancellation",
          });
        }
        const [row] = await tx
          .update(registrationsTable)
          .set({
            status: "cancelled",
            cancelledAt: new Date(),
            cancellationResolution: resolution,
          })
          .where(
            and(
              eq(registrationsTable.id, reg.id),
              eq(registrationsTable.status, "active"),
            ),
          )
          .returning();
        if (!row) throw new Error("Registration was already cancelled");
        return row;
      });
      res.json(await adminRegistrationShape(updated));
      return;
    }

    const [updated] = await db
      .update(registrationsTable)
      .set({
        status: "cancelled",
        cancelledAt: new Date(),
        cancellationResolution: resolution,
      })
      .where(
        and(eq(registrationsTable.id, reg.id), eq(registrationsTable.status, "active")),
      )
      .returning();
    if (!updated) {
      res.status(400).json({ error: "This registration is already cancelled." });
      return;
    }

    res.json(await adminRegistrationShape(updated));
  },
);

class FundBalanceError extends Error {
  constructor(public balance: number) {
    super("Insufficient sponsorship fund balance");
  }
}

async function buildSponsorshipFund(reunionId: number) {
  const [contributions, allocations] = await Promise.all([
    db
      .select()
      .from(sponsorshipContributionsTable)
      .where(eq(sponsorshipContributionsTable.reunionId, reunionId))
      .orderBy(desc(sponsorshipContributionsTable.createdAt)),
    db
      .select({
        id: sponsorshipAllocationsTable.id,
        registrationId: sponsorshipAllocationsTable.registrationId,
        amount: sponsorshipAllocationsTable.amount,
        fundedFrom: sponsorshipAllocationsTable.fundedFrom,
        sponsorName: sponsorshipAllocationsTable.sponsorName,
        note: sponsorshipAllocationsTable.note,
        createdAt: sponsorshipAllocationsTable.createdAt,
        branchName: registrationsTable.branchName,
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
        email: usersTable.email,
      })
      .from(sponsorshipAllocationsTable)
      .leftJoin(
        registrationsTable,
        eq(sponsorshipAllocationsTable.registrationId, registrationsTable.id),
      )
      .leftJoin(usersTable, eq(registrationsTable.userId, usersTable.id))
      .where(eq(sponsorshipAllocationsTable.reunionId, reunionId))
      .orderBy(desc(sponsorshipAllocationsTable.createdAt)),
  ]);

  const totalContributed = contributions.reduce((s, c) => s + c.amount, 0);
  const totalAllocated = allocations
    .filter((a) => a.fundedFrom === "fund")
    .reduce((s, a) => s + a.amount, 0);

  return {
    balance: totalContributed - totalAllocated,
    totalContributed,
    totalAllocated,
    contributions,
    allocations: allocations.map((a) => ({
      id: a.id,
      registrationId: a.registrationId,
      registrantName: a.firstName ? `${a.firstName} ${a.lastName ?? ""}`.trim() : null,
      registrantEmail: a.email ?? null,
      branchName: a.branchName ?? null,
      amount: a.amount,
      fundedFrom: a.fundedFrom,
      sponsorName: a.sponsorName,
      note: a.note,
      createdAt: a.createdAt,
    })),
  };
}

// GET /reunions/:reunionId/sponsorship — fund balance + ledger.
// Power-user area only: contributor and sponsored-household details are
// never exposed to regular members.
router.get(
  "/reunions/:reunionId/sponsorship",
  ...manage,
  requireReunionPermission("power_user"),
  async (req, res): Promise<void> => {
    res.json(await buildSponsorshipFund(req.managedReunion!.id));
  },
);

// POST /reunions/:reunionId/sponsorship/allocations — apply fund money (or a
// direct individual sponsor) to a registration.
router.post(
  "/reunions/:reunionId/sponsorship/allocations",
  ...manage,
  requireReunionPermission("power_user"),
  async (req, res): Promise<void> => {
    const body = CreateSponsorshipAllocationBody.safeParse(req.body);
    if (!body.success) {
      // Surface a human-readable message for the most common field error.
      const amountIssue = body.error.issues.find((i) => i.path[0] === "amount");
      const message = amountIssue
        ? "Amount must be at least $1"
        : "Invalid input";
      res.status(400).json({ error: message });
      return;
    }
    const { registrationId, amount, fundedFrom, sponsorName, note } = body.data;

    const [reg] = await db
      .select()
      .from(registrationsTable)
      .where(
        and(
          eq(registrationsTable.id, registrationId),
          eq(registrationsTable.reunionId, req.managedReunion!.id),
        ),
      );
    if (!reg) {
      res.status(400).json({ error: "That registration is not part of this reunion." });
      return;
    }
    if (reg.status === "cancelled") {
      res.status(400).json({ error: "Cannot sponsor a cancelled registration." });
      return;
    }

    // Balance check + insert must be atomic: lock the reunion row so two
    // concurrent fund allocations cannot both validate against the same balance.
    const reunionId = req.managedReunion!.id;
    try {
      await db.transaction(async (tx) => {
        if (fundedFrom === "fund") {
          await tx.execute(
            sql`SELECT id FROM reunions WHERE id = ${reunionId} FOR UPDATE`,
          );
          const [{ contributed }] = await tx
            .select({
              contributed: sql<number>`cast(coalesce(sum(${sponsorshipContributionsTable.amount}), 0) as int)`,
            })
            .from(sponsorshipContributionsTable)
            .where(eq(sponsorshipContributionsTable.reunionId, reunionId));
          const [{ allocated }] = await tx
            .select({
              allocated: sql<number>`cast(coalesce(sum(${sponsorshipAllocationsTable.amount}), 0) as int)`,
            })
            .from(sponsorshipAllocationsTable)
            .where(
              and(
                eq(sponsorshipAllocationsTable.reunionId, reunionId),
                eq(sponsorshipAllocationsTable.fundedFrom, "fund"),
              ),
            );
          const balance = contributed - allocated;
          if (amount > balance) {
            throw new FundBalanceError(balance);
          }
        }
        await tx.insert(sponsorshipAllocationsTable).values({
          reunionId,
          registrationId,
          amount,
          fundedFrom,
          sponsorName: sponsorName ?? null,
          note: note ?? null,
          createdBy: req.userId!,
        });
      });
    } catch (err) {
      if (err instanceof FundBalanceError) {
        res.status(400).json({
          error: `Only ${err.balance} is available in the sponsorship fund.`,
        });
        return;
      }
      throw err;
    }

    res.status(201).json(await buildSponsorshipFund(req.managedReunion!.id));
  },
);

// GET /reunions/:reunionId/sponsorship/my-contributions — any signed-in member
// can view their own contribution history. Fund totals stay private to
// organizers/power users.
router.get(
  "/reunions/:reunionId/sponsorship/my-contributions",
  requireAuth,
  async (req, res): Promise<void> => {
    const reunionId = Number(req.params.reunionId);
    if (!Number.isInteger(reunionId)) {
      res.status(400).json({ error: "Invalid reunion id" });
      return;
    }
    const [reunion] = await db
      .select({ id: reunionsTable.id })
      .from(reunionsTable)
      .where(eq(reunionsTable.id, reunionId));
    if (!reunion) {
      res.status(404).json({ error: "Reunion not found" });
      return;
    }
    const userId = (req as any).userId as string;
    const contributions = await db
      .select()
      .from(sponsorshipContributionsTable)
      .where(
        and(
          eq(sponsorshipContributionsTable.reunionId, reunionId),
          eq(sponsorshipContributionsTable.contributorUserId, userId),
        ),
      )
      .orderBy(desc(sponsorshipContributionsTable.createdAt));
    res.json(GetMyContributionsResponse.parse({ contributions }));
  },
);

// POST /reunions/:reunionId/sponsorship/contributions — any signed-in member
// can chip in. Returns only the contributor's own record; fund totals stay
// private to organizers/power users.
router.post(
  "/reunions/:reunionId/sponsorship/contributions",
  requireAuth,
  async (req, res): Promise<void> => {
    const body = CreateSponsorshipContributionBody.safeParse(req.body);
    const reunionId = Number(req.params.reunionId);
    if (!body.success || !Number.isInteger(reunionId)) {
      res.status(400).json({ error: "Invalid input" });
      return;
    }
    const [reunion] = await db
      .select({ id: reunionsTable.id })
      .from(reunionsTable)
      .where(eq(reunionsTable.id, reunionId));
    if (!reunion) {
      res.status(404).json({ error: "Reunion not found" });
      return;
    }
    const [created] = await db
      .insert(sponsorshipContributionsTable)
      .values({
        reunionId,
        contributorUserId: (req as any).userId as string,
        contributorName: body.data.contributorName ?? null,
        amount: body.data.amount,
        source: "direct",
      })
      .returning();
    res.status(201).json(created);
  },
);

export default router;
