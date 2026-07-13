import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import {
  db,
  registrationsTable,
  attendeesTable,
  usersTable,
  reunionsTable,
  reunionBranchesTable,
} from "@workspace/db";
import {
  CreateRegistrationBody,
  GetRegistrationParams,
  CreateRegistrationResponse,
  ListMyRegistrationsResponse,
  GetRegistrationResponse,
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
      createdAt: registrationsTable.createdAt,
      reunionName: reunionsTable.name,
      reunionCode: reunionsTable.code,
    })
    .from(registrationsTable)
    .leftJoin(reunionsTable, eq(registrationsTable.reunionId, reunionsTable.id))
    .where(eq(registrationsTable.id, id));

  if (!row) return null;

  const attendees = await db
    .select()
    .from(attendeesTable)
    .where(eq(attendeesTable.registrationId, id));

  return { ...row, attendees };
}

// POST /registrations
router.post("/registrations", requireAuth, async (req, res): Promise<void> => {
  const parsed = CreateRegistrationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const userId = (req as any).userId as string;
  const { reunionId, branchName, attendees } = parsed.data;

  // Reunion must exist
  const [reunion] = await db
    .select()
    .from(reunionsTable)
    .where(eq(reunionsTable.id, reunionId));
  if (!reunion) {
    res.status(400).json({ error: "That reunion no longer exists." });
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
    await upsertUserFromClerk(userId);

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
    })),
  );

  const full = await getFullRegistration(registration.id);

  // Send email confirmation (non-blocking)
  if (clerkEmail && full) {
    sendRegistrationConfirmation({
      toEmail: clerkEmail,
      toName: clerkFirstName || "Family Member",
      branchName,
      attendees: full.attendees,
      registrationId: registration.id,
      registeredAt: registration.createdAt,
      reunion: {
        name: reunion.name,
        startDate: reunion.startDate,
        endDate: reunion.endDate,
        feePerPerson: reunion.feePerPerson,
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

export default router;
