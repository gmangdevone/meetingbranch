import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import {
  db,
  registrationsTable,
  registrationFeesTable,
  attendeesTable,
  usersTable,
  reunionsTable,
  reunionBranchesTable,
  reunionFeesTable,
  reunionOrganizersTable,
  sponsorshipContributionsTable,
} from "@workspace/db";
import { and } from "drizzle-orm";
import { inArray } from "drizzle-orm";
import {
  CreateRegistrationBody,
  GetRegistrationParams,
  CreateRegistrationResponse,
  ListMyRegistrationsResponse,
  GetRegistrationResponse,
  TransferRegistrationBody,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { sendRegistrationConfirmation } from "../lib/email";
import { upsertUserFromClerk } from "../lib/users";

const router: IRouter = Router();

// Build a full registration object with attendees + reunion name/code
async function getFullRegistration(id: number) {
  const [row] = await db
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
      reunionName: reunionsTable.name,
      reunionCode: reunionsTable.code,
    })
    .from(registrationsTable)
    .leftJoin(reunionsTable, eq(registrationsTable.reunionId, reunionsTable.id))
    .where(eq(registrationsTable.id, id));

  if (!row) return null;

  const [attendees, selectedFees] = await Promise.all([
    db.select().from(attendeesTable).where(eq(attendeesTable.registrationId, id)),
    db
      .select({ feeId: registrationFeesTable.feeId })
      .from(registrationFeesTable)
      .where(eq(registrationFeesTable.registrationId, id)),
  ]);

  return { ...row, attendees, selectedFeeIds: selectedFees.map((f) => f.feeId) };
}

// POST /registrations
router.post("/registrations", requireAuth, async (req, res): Promise<void> => {
  const parsed = CreateRegistrationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const userId = (req as any).userId as string;
  const { reunionId, branchName, attendees, selectedFeeIds, sponsorshipContribution } =
    parsed.data;

  // Reunion must exist
  const [reunion] = await db
    .select()
    .from(reunionsTable)
    .where(eq(reunionsTable.id, reunionId));
  if (!reunion) {
    res.status(400).json({ error: "That reunion no longer exists." });
    return;
  }
  if (!reunion.registrationsOpen) {
    res.status(403).json({
      error: "Registration is currently closed for this reunion. Check back later or contact your organizer.",
    });
    return;
  }

  // Load this reunion's fees; only its OWN optional fees may be selected.
  const fees = await db
    .select()
    .from(reunionFeesTable)
    .where(eq(reunionFeesTable.reunionId, reunionId));
  const optionalFeeIds = new Set(fees.filter((f) => f.isOptional).map((f) => f.id));
  const chosenFeeIds = [...new Set(selectedFeeIds ?? [])];
  if (!chosenFeeIds.every((id) => optionalFeeIds.has(id))) {
    res.status(400).json({ error: "One or more selected fees are not available for this reunion." });
    return;
  }

  // Branch must be one of the reunion's configured branches (when it has any)
  const branches = await db
    .select({ name: reunionBranchesTable.name })
    .from(reunionBranchesTable)
    .where(eq(reunionBranchesTable.reunionId, reunionId));
  if (branches.length > 0 && !branches.some((b) => b.name === branchName)) {
    res.status(400).json({ error: "Selected branch is not part of this reunion." });
    return;
  }

  // JIT-provision user row with authoritative Clerk profile data
  const { email: clerkEmail, firstName: clerkFirstName } =
    await upsertUserFromClerk(userId, req.log);

  const [registration] = await db
    .insert(registrationsTable)
    .values({ reunionId, userId, branchName, attendeeCount: attendees.length })
    .returning();

  await db.insert(attendeesTable).values(
    attendees.map((a) => ({
      registrationId: registration.id,
      name: a.name,
      shirtSize: a.shirtSize,
      dietaryRestrictions: a.dietaryRestrictions ?? null,
      age: a.age ?? null,
    })),
  );

  if (chosenFeeIds.length > 0) {
    await db.insert(registrationFeesTable).values(
      chosenFeeIds.map((feeId) => ({ registrationId: registration.id, feeId })),
    );
  }

  if (sponsorshipContribution && sponsorshipContribution > 0) {
    await db.insert(sponsorshipContributionsTable).values({
      reunionId,
      registrationId: registration.id,
      contributorUserId: userId,
      amount: sponsorshipContribution,
      source: "registration",
    });
  }

  const full = await getFullRegistration(registration.id);

  // Send email confirmation (non-blocking)
  if (clerkEmail && full) {
    sendRegistrationConfirmation({
      toEmail: clerkEmail,
      toName: clerkFirstName || "Family Member",
      branchName,
      attendees: full.attendees,
      selectedFeeIds: chosenFeeIds,
      registrationId: registration.id,
      registeredAt: registration.createdAt,
      reunion: {
        name: reunion.name,
        startDate: reunion.startDate,
        endDate: reunion.endDate,
        fees,
        paymentHandle: reunion.paymentHandle,
        paymentUrl: reunion.paymentUrl,
      },
    }).catch((err) => req.log.error({ err }, "Email send error"));
  }

  res.status(201).json(CreateRegistrationResponse.parse(full));
});

// GET /registrations/mine
router.get("/registrations/mine", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as any).userId as string;

  const myRegistrations = await db
    .select({ id: registrationsTable.id })
    .from(registrationsTable)
    .where(eq(registrationsTable.userId, userId))
    .orderBy(desc(registrationsTable.createdAt));

  const withDetail = await Promise.all(
    myRegistrations.map(async (r) => (await getFullRegistration(r.id))!),
  );

  res.json(ListMyRegistrationsResponse.parse(withDetail));
});

// GET /registrations/:id
router.get("/registrations/:id", requireAuth, async (req, res): Promise<void> => {
  const params = GetRegistrationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid registration ID" });
    return;
  }

  const userId = (req as any).userId as string;
  const full = await getFullRegistration(params.data.id);
  if (!full) {
    res.status(404).json({ error: "Registration not found" });
    return;
  }

  // Owner, the reunion's organizer, or a platform admin may view
  const [userRecord] = await db
    .select({ isAdmin: usersTable.isAdmin })
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  const isAdmin = userRecord?.isAdmin ?? false;

  const [reunion] = await db
    .select({ organizerId: reunionsTable.organizerId })
    .from(reunionsTable)
    .where(eq(reunionsTable.id, full.reunionId));
  const isOrganizer = reunion?.organizerId === userId;

  if (full.userId !== userId && !isAdmin && !isOrganizer) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  res.json(GetRegistrationResponse.parse(full));
});

// Can this user manage registrations for the reunion? (owner, platform
// admin, or co-organizer holding the "registration" role)
async function canManageRegistrations(userId: string, reunionId: number): Promise<boolean> {
  const [[reunion], [userRecord], [organizer]] = await Promise.all([
    db
      .select({ organizerId: reunionsTable.organizerId })
      .from(reunionsTable)
      .where(eq(reunionsTable.id, reunionId)),
    db
      .select({ isAdmin: usersTable.isAdmin })
      .from(usersTable)
      .where(eq(usersTable.id, userId)),
    db
      .select({ roles: reunionOrganizersTable.roles })
      .from(reunionOrganizersTable)
      .where(
        and(
          eq(reunionOrganizersTable.reunionId, reunionId),
          eq(reunionOrganizersTable.userId, userId),
        ),
      ),
  ]);
  if (reunion?.organizerId === userId) return true;
  if (userRecord?.isAdmin) return true;
  return organizer?.roles?.includes("registration") ?? false;
}

// POST /registrations/:id/transfer
// kind=registration: hand the whole registration to another account (by email).
// kind=payment: move this registration's PAID status onto another registration
// in the same reunion. Registrants may transfer their own; organizers with the
// registration role may transfer any.
router.post("/registrations/:id/transfer", requireAuth, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const body = TransferRegistrationBody.safeParse(req.body);
  if (!body.success || !Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }

  const userId = (req as any).userId as string;
  const [reg] = await db
    .select()
    .from(registrationsTable)
    .where(eq(registrationsTable.id, id));
  if (!reg) {
    res.status(404).json({ error: "Registration not found" });
    return;
  }

  const isOwn = reg.userId === userId;
  if (!isOwn && !(await canManageRegistrations(userId, reg.reunionId))) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  if (reg.status === "cancelled") {
    res.status(400).json({ error: "This registration has been cancelled." });
    return;
  }

  if (body.data.kind === "registration") {
    const email = body.data.targetEmail?.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ error: "Enter the email address of the person taking over." });
      return;
    }
    const [target] = await db.select().from(usersTable).where(eq(usersTable.email, email));
    if (!target) {
      res.status(400).json({
        error: "No account found with that email. Ask them to sign in to FamJam first.",
      });
      return;
    }
    if (target.id === reg.userId) {
      res.status(400).json({ error: "This registration already belongs to that person." });
      return;
    }
    await db
      .update(registrationsTable)
      .set({ userId: target.id })
      .where(eq(registrationsTable.id, reg.id));
  } else {
    const targetId = body.data.targetRegistrationId;
    if (!targetId) {
      res.status(400).json({ error: "Choose the registration that should receive the payment." });
      return;
    }
    if (reg.paymentStatus !== "paid") {
      res.status(400).json({ error: "Only a paid registration's payment can be transferred." });
      return;
    }
    const [target] = await db
      .select()
      .from(registrationsTable)
      .where(eq(registrationsTable.id, targetId));
    if (!target || target.reunionId !== reg.reunionId || target.id === reg.id) {
      res.status(400).json({ error: "The receiving registration must be in the same reunion." });
      return;
    }
    if (target.status === "cancelled") {
      res.status(400).json({ error: "The receiving registration has been cancelled." });
      return;
    }
    if (target.paymentStatus === "paid") {
      res.status(400).json({ error: "The receiving registration is already paid." });
      return;
    }
    // Both sides of the payment move must land together, and the guards are
    // re-checked inside the transaction so a race cannot double-move a payment.
    try {
      await db.transaction(async (tx) => {
        const [source] = await tx
          .update(registrationsTable)
          .set({ paymentStatus: "pending" })
          .where(
            and(
              eq(registrationsTable.id, reg.id),
              eq(registrationsTable.paymentStatus, "paid"),
              eq(registrationsTable.status, "active"),
            ),
          )
          .returning();
        const [received] = await tx
          .update(registrationsTable)
          .set({ paymentStatus: "paid" })
          .where(
            and(
              eq(registrationsTable.id, target.id),
              eq(registrationsTable.paymentStatus, "pending"),
              eq(registrationsTable.status, "active"),
            ),
          )
          .returning();
        if (!source || !received) {
          throw new Error("PAYMENT_TRANSFER_CONFLICT");
        }
      });
    } catch (err) {
      if (err instanceof Error && err.message === "PAYMENT_TRANSFER_CONFLICT") {
        res.status(409).json({
          error: "The payment could not be transferred — one of the registrations changed. Refresh and try again.",
        });
        return;
      }
      throw err;
    }
  }

  const full = await getFullRegistration(reg.id);
  res.json(GetRegistrationResponse.parse(full));
});

export default router;
