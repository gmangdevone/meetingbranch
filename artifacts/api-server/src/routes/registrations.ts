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
  paymentSubmissionsTable,
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
  UpdateRegistrationBody,
  UpdateRegistrationParams,
  UpdateRegistrationResponse,
  CreatePaymentSubmissionParams,
  CreatePaymentSubmissionBody,
  CreatePaymentSubmissionResponse,
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

  // Owner, or anyone who may manage this reunion's registrations (reunion
  // owner, platform admin, or co-organizer with registration/power_user role)
  if (full.userId !== userId && !(await canManageRegistrations(userId, full.reunionId))) {
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
  const roles = organizer?.roles ?? [];
  return roles.includes("registration") || roles.includes("power_user");
}

// PUT /registrations/:id
// Organizers with the registration role (and platform admins) may edit any
// registration. The registrant may edit their own ACTIVE registration when the
// reunion's allowRegistrantEdits setting is on.
router.put("/registrations/:id", requireAuth, async (req, res): Promise<void> => {
  const params = UpdateRegistrationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid registration ID" });
    return;
  }
  const body = UpdateRegistrationBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const userId = (req as any).userId as string;
  const [registration] = await db
    .select()
    .from(registrationsTable)
    .where(eq(registrationsTable.id, params.data.id));
  if (!registration) {
    res.status(404).json({ error: "Registration not found" });
    return;
  }

  const [reunion] = await db
    .select()
    .from(reunionsTable)
    .where(eq(reunionsTable.id, registration.reunionId));
  if (!reunion) {
    res.status(404).json({ error: "Reunion not found" });
    return;
  }

  const isManager = await canManageRegistrations(userId, registration.reunionId);
  const isOwner = registration.userId === userId;
  if (!isManager) {
    if (!isOwner) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    if (!reunion.allowRegistrantEdits) {
      res.status(403).json({
        error: "Editing registrations is not enabled for this reunion. Contact your organizer to make changes.",
      });
      return;
    }
  }
  if (registration.status !== "active") {
    res.status(400).json({ error: "Cancelled registrations cannot be edited." });
    return;
  }

  const { branchName, attendees, selectedFeeIds } = body.data;

  // Branch must be one of the reunion's configured branches (when it has any)
  const branches = await db
    .select({ name: reunionBranchesTable.name })
    .from(reunionBranchesTable)
    .where(eq(reunionBranchesTable.reunionId, registration.reunionId));
  if (branches.length > 0 && !branches.some((b) => b.name === branchName)) {
    res.status(400).json({ error: "Selected branch is not part of this reunion." });
    return;
  }

  // Only this reunion's OWN optional fees may be selected
  const fees = await db
    .select()
    .from(reunionFeesTable)
    .where(eq(reunionFeesTable.reunionId, registration.reunionId));
  const optionalFeeIds = new Set(fees.filter((f) => f.isOptional).map((f) => f.id));
  const chosenFeeIds = [...new Set(selectedFeeIds ?? [])];
  if (!chosenFeeIds.every((id) => optionalFeeIds.has(id))) {
    res.status(400).json({ error: "One or more selected fees are not available for this reunion." });
    return;
  }

  await db.transaction(async (tx) => {
    await tx
      .update(registrationsTable)
      .set({ branchName, attendeeCount: attendees.length })
      .where(eq(registrationsTable.id, registration.id));

    // Replace attendees wholesale, preserving check-in state by matching names
    // (attendee ids are not exposed in the edit form input). Matches are
    // consumed one-to-one so duplicate names cannot double-assign a check-in.
    const existing = await tx
      .select()
      .from(attendeesTable)
      .where(eq(attendeesTable.registrationId, registration.id));
    const checkInsByName = new Map<string, Date[]>();
    for (const a of existing) {
      if (!a.checkedInAt) continue;
      const key = a.name.trim().toLowerCase();
      const list = checkInsByName.get(key) ?? [];
      list.push(a.checkedInAt);
      checkInsByName.set(key, list);
    }
    await tx.delete(attendeesTable).where(eq(attendeesTable.registrationId, registration.id));
    await tx.insert(attendeesTable).values(
      attendees.map((a) => ({
        registrationId: registration.id,
        name: a.name,
        shirtSize: a.shirtSize,
        dietaryRestrictions: a.dietaryRestrictions ?? null,
        age: a.age ?? null,
        checkedInAt: checkInsByName.get(a.name.trim().toLowerCase())?.shift() ?? null,
      })),
    );

    await tx
      .delete(registrationFeesTable)
      .where(eq(registrationFeesTable.registrationId, registration.id));
    if (chosenFeeIds.length > 0) {
      await tx.insert(registrationFeesTable).values(
        chosenFeeIds.map((feeId) => ({ registrationId: registration.id, feeId })),
      );
    }
  });

  const full = await getFullRegistration(registration.id);
  res.json(UpdateRegistrationResponse.parse(full));
});

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
    if (!target || target.isManaged) {
      // Managed accounts share a synthetic contact email and can never sign
      // in, so they are not valid transfer targets.
      res.status(400).json({
        error: "No account found with that email. Ask them to sign in to Meeting Branch first.",
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

// POST /registrations/:id/payment-submissions
// A registrant (or a manager on their behalf) records that a payment was
// sent/handed over, with method-specific reconciliation info. This is purely
// informational: it NEVER touches paymentStatus — organizers reconcile
// manually and flip the status themselves.
router.post(
  "/registrations/:id/payment-submissions",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = CreatePaymentSubmissionParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid registration ID" });
      return;
    }
    const body = CreatePaymentSubmissionBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }

    const userId = (req as any).userId as string;
    const [registration] = await db
      .select()
      .from(registrationsTable)
      .where(eq(registrationsTable.id, params.data.id));
    if (!registration) {
      res.status(404).json({ error: "Registration not found" });
      return;
    }
    if (
      registration.userId !== userId &&
      !(await canManageRegistrations(userId, registration.reunionId))
    ) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    if (registration.status !== "active") {
      res.status(400).json({ error: "Cancelled registrations cannot record payments." });
      return;
    }

    const { method, amount, reference, givenDate, note } = body.data;
    // Method-specific validation the OpenAPI shape can't express:
    // whole-dollar amounts only, and each method's reconciliation key.
    if (!Number.isInteger(amount)) {
      res.status(400).json({ error: "Amount must be a whole-dollar number." });
      return;
    }
    if ((method === "cashapp" || method === "zelle" || method === "cash") && !reference?.trim()) {
      const label =
        method === "cashapp" ? "your $cashtag" : method === "zelle" ? "your Zelle ID" : "who received the cash";
      res.status(400).json({ error: `Please include ${label}.` });
      return;
    }
    if (method === "cash" && !/^\d{4}-\d{2}-\d{2}$/.test(givenDate ?? "")) {
      res.status(400).json({ error: "Please include the date the cash was given (YYYY-MM-DD)." });
      return;
    }
    const [created] = await db
      .insert(paymentSubmissionsTable)
      .values({
        reunionId: registration.reunionId,
        registrationId: registration.id,
        submittedBy: userId,
        method,
        amount,
        reference: reference || null,
        givenDate: givenDate || null,
        note: note || null,
      })
      .returning();
    res.status(201).json(CreatePaymentSubmissionResponse.parse(created));
  },
);

export default router;
