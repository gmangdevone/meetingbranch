import { Router, type IRouter } from "express";
import { eq, desc, sql } from "drizzle-orm";
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
  sponsorshipAllocationsTable,
  paymentSubmissionsTable,
} from "@workspace/db";
import { and, isNull } from "drizzle-orm";
import { branchIdForRegistration, loadBranchFeeLedgers } from "../lib/branchFees";
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
import { ensureLedgerInitialized, rows, isValidCents, isValidIsoDate, parseDollarsToCents, loadLedgers, lockReunionRow, syncLedgerStatus, LedgerError, fmtCents } from "../lib/ledger";
import { sendRegistrationConfirmation } from "../lib/email";
import { upsertUserFromClerk } from "../lib/users";

import { findDestinationKeys, resolveRecipient, unavailableMethodError } from "../lib/paymentRecipients";
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

  const ledger = (await loadLedgers(db, [row.id])).get(row.id);
  return { ...row, attendees, selectedFeeIds: selectedFees.map((f) => f.feeId), ledger };
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
    .where(and(eq(reunionBranchesTable.reunionId, reunionId), isNull(reunionBranchesTable.archivedAt)));
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
        recipient: await resolveRecipient(reunion.id),
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
export async function canManageRegistrations(userId: string, reunionId: number): Promise<boolean> {
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
    .where(and(eq(reunionBranchesTable.reunionId, registration.reunionId), isNull(reunionBranchesTable.archivedAt)));
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
    // Attendee/fee edits recalculate charges: freeze legacy paid money first,
    // and re-sync the status columns in the same transaction.
    await ensureLedgerInitialized(tx, registration.id, userId);
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
    await syncLedgerStatus(tx, registration.id);
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
    const [target] = await db
      .select()
      .from(registrationsTable)
      .where(eq(registrationsTable.id, targetId));
    if (!target || target.reunionId !== reg.reunionId || target.id === reg.id) {
      res.status(400).json({ error: "The receiving registration must be in the same reunion." });
      return;
    }
    if (target.status === "cancelled") {
      res.status(400).json({ error: "Payments can only move between active registrations." });
      return;
    }
    const requested = (req.body as { amountCents?: unknown })?.amountCents;
    if (requested !== undefined && requested !== null && !isValidCents(requested)) {
      res.status(400).json({ error: "Enter a transfer amount greater than $0.00." });
      return;
    }
    // Moves actual confirmed money (receipts + legacy opening credit) as a
    // signed transfer entry; both sides are re-checked under row locks.
    try {
      await db.transaction(async (tx) => {
        await lockReunionRow(tx, reg.reunionId);
        const [a, b] = reg.id < target.id ? [reg.id, target.id] : [target.id, reg.id];
        // Re-read both statuses under row locks (after the reunion lock, which
        // cancellation also takes) BEFORE any money write: a cancellation that
        // committed after the preflight check must stop the transfer.
        const live = await rows<{ id: number; status: string; reunion_id: number }>(tx, sql`
          SELECT id, status, reunion_id FROM registrations WHERE id IN (${a}, ${b}) ORDER BY id FOR UPDATE`);
        if (live.length !== 2 || live.some((g) => g.status !== "active" || g.reunion_id !== reg.reunionId))
          throw new LedgerError(409, "One of these registrations was cancelled just now, so its money was already resolved. Refresh and try again.");
        await ensureLedgerInitialized(tx, a, userId);
        await ensureLedgerInitialized(tx, b, userId);
        const ledgers = await loadLedgers(tx, [reg.id, target.id]);
        const src = ledgers.get(reg.id)!;
        const dst = ledgers.get(target.id)!;
        const available = src.confirmedCents + src.legacyCreditCents;
        if (available <= 0) throw new LedgerError(400, "This registration has no confirmed payment to transfer.");
        if (dst.waived) throw new LedgerError(400, "The receiving registration's fees are waived.");
        if (dst.balanceCents <= 0) throw new LedgerError(400, "The receiving registration has no remaining balance.");
        const amount = typeof requested === "number" ? requested : Math.min(available, dst.balanceCents);
        if (amount > available) throw new LedgerError(400, `Only ${fmtCents(available)} of confirmed money can be transferred.`);
        if (amount > dst.balanceCents) throw new LedgerError(400, `The receiving registration only owes ${fmtCents(dst.balanceCents)}. Transfer that amount or less.`);
        const r = (await tx.execute(sql`
          INSERT INTO payment_receipts (reunion_id, kind, amount_cents, note, recorded_by)
          VALUES (${reg.reunionId}, 'transfer', ${amount}, ${`Transferred from registration #${reg.id} to #${target.id}`}, ${userId})
          RETURNING id`)) as unknown as { rows: { id: number }[] };
        const rid = r.rows[0].id;
        await tx.execute(sql`INSERT INTO payment_receipt_allocations (receipt_id, reunion_id, registration_id, amount_cents)
          VALUES (${rid}, ${reg.reunionId}, ${reg.id}, ${-amount}), (${rid}, ${reg.reunionId}, ${target.id}, ${amount})`);
        await syncLedgerStatus(tx, reg.id);
        await syncLedgerStatus(tx, target.id);
      });
    } catch (err) {
      if (err instanceof LedgerError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      throw err;
    }
  }

  const full = await getFullRegistration(reg.id);
  res.json(GetRegistrationResponse.parse(full));
});

// GET /registrations/:id/branch-fee
// The ONE shared special fee for this registration's branch. Members see the
// shared balance and dated confirmed amounts, never who paid.
router.get("/registrations/:id/branch-fee", requireAuth, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid registration ID" });
    return;
  }
  const userId = (req as any).userId as string;
  const [registration] = await db.select().from(registrationsTable).where(eq(registrationsTable.id, id));
  if (!registration) {
    res.status(404).json({ error: "Registration not found" });
    return;
  }
  const manager = await canManageRegistrations(userId, registration.reunionId);
  if (registration.userId !== userId && !manager) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const branchId = await branchIdForRegistration(db, id);
  const fee = branchId == null ? undefined : (await loadBranchFeeLedgers(db, registration.reunionId, { branchIds: [branchId], includePayers: manager }))[0];
  res.json({ branchFee: fee && (fee.enabled || fee.entries.length > 0) ? fee : null });
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
    if (findDestinationKeys(req.body).length > 0) {
      res.status(400).json({ error: "Payment submissions cannot set a receiving destination." });
      return;
    }
    // The receiving account is server-controlled: a Cash App submission is only
    // accepted while the reunion has an owner-approved recipient.
    {
      const unavailable = await unavailableMethodError(body.data.method, registration.reunionId);
      if (unavailable) {
        res.status(409).json({ error: unavailable });
        return;
      }
    }

    // Which registrations does this payment cover? Defaults to just the path
    // registration; when provided it must include it, and every covered
    // registration must be active, in the same reunion, and belong to the same
    // account (unless the submitter can manage registrations).
    const requestedIds = body.data.registrationIds ?? [registration.id];
    const coveredIds = [...new Set(requestedIds)];
    const wantsBranchFee = body.data.branchFeeAmount != null && body.data.branchFeeAmount > 0;
    if (coveredIds.length === 0 && !wantsBranchFee) {
      res.status(400).json({ error: "Choose what this payment is for." });
      return;
    }
    if (coveredIds.length > 0 && !coveredIds.includes(registration.id)) {
      res.status(400).json({ error: "registrationIds must include the registration being paid." });
      return;
    }
    const coveredRegistrations = coveredIds.length
      ? await db
          .select()
          .from(registrationsTable)
          .where(inArray(registrationsTable.id, coveredIds))
      : [];
    if (coveredRegistrations.length !== coveredIds.length) {
      res.status(400).json({ error: "One or more registrations were not found." });
      return;
    }
    let canManage: boolean | null = registration.userId === userId ? null : true;
    for (const covered of coveredRegistrations) {
      if (covered.reunionId !== registration.reunionId) {
        res.status(400).json({ error: "All registrations must belong to the same reunion." });
        return;
      }
      if (covered.status !== "active") {
        res.status(400).json({ error: "Cancelled registrations cannot record payments." });
        return;
      }
      if (covered.userId !== userId) {
        // Covering someone else's registration requires manage rights.
        canManage ??= await canManageRegistrations(userId, registration.reunionId);
        if (!canManage) {
          res.status(403).json({ error: "Forbidden" });
          return;
        }
      }
    }

    // Standalone fund chip-ins this payment also covers: each must be a
    // pending, registration-less contribution in the same reunion, owned by
    // the submitter (or the submitter must have manage rights).
    const contributionIds = [...new Set(body.data.contributionIds ?? [])];
    if (contributionIds.length > 0) {
      const coveredContributions = await db
        .select()
        .from(sponsorshipContributionsTable)
        .where(inArray(sponsorshipContributionsTable.id, contributionIds));
      if (coveredContributions.length !== contributionIds.length) {
        res.status(400).json({ error: "One or more fund chip-ins were not found." });
        return;
      }
      for (const c of coveredContributions) {
        if (c.reunionId !== registration.reunionId) {
          // Same "not found" shape as a nonexistent id: outsiders can't
          // distinguish other reunions' chip-ins from missing ones.
          res.status(400).json({ error: "One or more fund chip-ins were not found." });
          return;
        }
        // Ownership first, so callers can't probe another member's chip-in
        // state via the different error messages below.
        if (c.contributorUserId !== userId) {
          canManage ??= await canManageRegistrations(userId, registration.reunionId);
          if (!canManage) {
            res.status(403).json({ error: "Forbidden" });
            return;
          }
        }
        if (c.registrationId !== null) {
          res.status(400).json({ error: "Invalid fund chip-in for this payment." });
          return;
        }
        if (c.paymentStatus !== "pending") {
          res.status(400).json({ error: "That fund chip-in is already settled." });
          return;
        }
      }
    }

    const { method, amount, reference, givenDate, note } = body.data;
    // Method-specific validation the OpenAPI shape can't express:
    // exact dollars-and-cents amounts, and each method's reconciliation key.
    // Reported amounts are informational; they never reduce the balance.
    const amountCents = parseDollarsToCents(amount);
    if (amountCents === null) {
      res.status(400).json({ error: "Enter an amount greater than $0.00 with at most two decimal places." });
      return;
    }
    if ((method === "cashapp" || method === "zelle" || method === "cash") && !reference?.trim()) {
      const label =
        method === "cashapp" ? "your $cashtag" : method === "zelle" ? "your Zelle ID" : "who received the cash";
      res.status(400).json({ error: `Please include ${label}.` });
      return;
    }
    if (method === "cash" && !isValidIsoDate(givenDate ?? "")) {
      res.status(400).json({ error: "Please include the date the cash was given (YYYY-MM-DD)." });
      return;
    }
    // Branch special fee: explicit opt-in, re-validated against the live
    // shared balance (a stale page can't report against a settled fee).
    let branchFeeBranchId: number | null = null;
    let branchFeeCents: number | null = null;
    if (wantsBranchFee) {
      branchFeeCents = parseDollarsToCents(body.data.branchFeeAmount!);
      if (branchFeeCents === null) {
        res.status(400).json({ error: "Enter the branch fee portion in dollars and cents." });
        return;
      }
      branchFeeBranchId = await branchIdForRegistration(db, registration.id);
      const fee = branchFeeBranchId == null ? undefined : (await loadBranchFeeLedgers(db, registration.reunionId, { branchIds: [branchFeeBranchId], includePayers: false }))[0];
      if (!fee || !fee.enabled || fee.amountCents <= 0) {
        res.status(409).json({ error: "Your branch doesn't have a special fee right now. Refresh to see the latest." });
        return;
      }
      if (fee.remainingCents <= 0) {
        res.status(409).json({ error: `Your branch's ${fee.label} is already paid in full. Nothing more is owed.` });
        return;
      }
      if (branchFeeCents > fee.remainingCents) {
        res.status(409).json({ error: `Only ${fmtCents(fee.remainingCents)} is left on your branch's ${fee.label}.` });
        return;
      }
      if (branchFeeCents > amountCents) {
        res.status(400).json({ error: "The branch fee portion can't be more than the total amount." });
        return;
      }
      if (coveredIds.length === 0 && contributionIds.length === 0 && branchFeeCents !== amountCents) {
        res.status(400).json({ error: "For a branch fee payment, the amount must match the branch fee portion." });
        return;
      }
    }
    const [created] = await db
      .insert(paymentSubmissionsTable)
      .values({
        reunionId: registration.reunionId,
        registrationId: registration.id,
        registrationIds: coveredIds,
        contributionIds,
        submittedBy: userId,
        method,
        amount: Math.floor(amountCents / 100),
        amountCents,
        branchFeeBranchId,
        branchFeeCents,
        reference: reference || null,
        givenDate: givenDate || null,
        note: note || null,
      })
      .returning();
    // Resolve chip-in details for the response (mirrors the list endpoint).
    const contributions =
      contributionIds.length > 0
        ? await db
            .select({
              id: sponsorshipContributionsTable.id,
              contributorName: sponsorshipContributionsTable.contributorName,
              amount: sponsorshipContributionsTable.amount,
              paymentStatus: sponsorshipContributionsTable.paymentStatus,
              createdAt: sponsorshipContributionsTable.createdAt,
              source: sponsorshipContributionsTable.source,
              registrationId: sponsorshipContributionsTable.registrationId,
            })
            .from(sponsorshipContributionsTable)
            .where(inArray(sponsorshipContributionsTable.id, contributionIds))
            .then((rs) => rs.map(({ source, registrationId, ...c }) => ({ ...c, standalone: source === "direct" && registrationId == null })))
        : [];
    const { branchFeeBranchId: _b, branchFeeCents: _c, ...createdOut } = created;
    void _b; void _c;
    let branchFee = null;
    if (branchFeeBranchId != null && branchFeeCents) {
      const [fb] = await db.select().from(reunionBranchesTable).where(eq(reunionBranchesTable.id, branchFeeBranchId));
      branchFee = { branchId: fb.id, branchName: fb.name, label: fb.specialFeeLabel?.trim() || "Branch fee", amountCents: branchFeeCents };
    }
    res.status(201).json(CreatePaymentSubmissionResponse.parse({ ...createdOut, amount: amountCents / 100, amountCents, confirmedReceiptId: null, contributions, branchFee }));
  },
);

export default router;
