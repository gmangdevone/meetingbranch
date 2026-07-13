import { Router, type IRouter } from "express";
import { eq, desc, sql } from "drizzle-orm";
import { db, registrationsTable, attendeesTable, usersTable } from "@workspace/db";
import {
  CreateRegistrationBody,
  GetRegistrationParams,
  CreateRegistrationResponse,
  ListMyRegistrationsResponse,
  GetRegistrationResponse,
  GetRegistrationSummaryResponse,
} from "@workspace/api-zod";
import { requireAuth, getClerkUserId } from "../middlewares/requireAuth";
import { sendRegistrationConfirmation } from "../lib/email";
import { getAuth } from "@clerk/express";

const router: IRouter = Router();

// Build a full registration object with attendees
async function getFullRegistration(id: number) {
  const [registration] = await db
    .select()
    .from(registrationsTable)
    .where(eq(registrationsTable.id, id));

  if (!registration) return null;

  const attendees = await db
    .select()
    .from(attendeesTable)
    .where(eq(attendeesTable.registrationId, id));

  return { ...registration, attendees };
}

// POST /registrations
router.post("/registrations", requireAuth, async (req, res): Promise<void> => {
  const parsed = CreateRegistrationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const userId = (req as any).userId as string;
  const { siblingName, attendees } = parsed.data;

  // JIT-provision user row if not exists
  const auth = getAuth(req);
  const clerkEmail =
    (auth?.sessionClaims?.email as string | undefined) ?? "";
  const clerkFirstName =
    (auth?.sessionClaims?.firstName as string | undefined) ??
    (auth?.sessionClaims?.given_name as string | undefined) ??
    "";

  await db
    .insert(usersTable)
    .values({ id: userId, email: clerkEmail, firstName: clerkFirstName })
    .onConflictDoNothing();

  // Create the registration
  const [registration] = await db
    .insert(registrationsTable)
    .values({
      userId,
      siblingName,
      attendeeCount: attendees.length,
    })
    .returning();

  // Create attendees
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
  const toEmail = clerkEmail;
  if (toEmail && full) {
    sendRegistrationConfirmation({
      toEmail,
      toName: clerkFirstName || "Family Member",
      siblingName,
      attendees: full.attendees,
      registrationId: registration.id,
      registeredAt: registration.createdAt,
    }).catch((err) => req.log.error({ err }, "Email send error"));
  }

  res.status(201).json(CreateRegistrationResponse.parse(full));
});

// GET /registrations/summary (public)
router.get("/registrations/summary", async (_req, res): Promise<void> => {
  const total = await db
    .select({
      totalRegistrations: sql<number>`cast(count(*) as int)`,
      totalAttendees: sql<number>`cast(sum(${registrationsTable.attendeeCount}) as int)`,
    })
    .from(registrationsTable);

  const byGroup = await db
    .select({
      siblingName: registrationsTable.siblingName,
      registrationCount: sql<number>`cast(count(*) as int)`,
      attendeeCount: sql<number>`cast(sum(${registrationsTable.attendeeCount}) as int)`,
    })
    .from(registrationsTable)
    .groupBy(registrationsTable.siblingName)
    .orderBy(registrationsTable.siblingName);

  const summary = {
    totalRegistrations: total[0]?.totalRegistrations ?? 0,
    totalAttendees: total[0]?.totalAttendees ?? 0,
    byGroup,
  };

  res.json(GetRegistrationSummaryResponse.parse(summary));
});

// GET /registrations/mine
router.get("/registrations/mine", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as any).userId as string;

  const myRegistrations = await db
    .select()
    .from(registrationsTable)
    .where(eq(registrationsTable.userId, userId))
    .orderBy(desc(registrationsTable.createdAt));

  const withAttendees = await Promise.all(
    myRegistrations.map(async (r) => {
      const attendees = await db
        .select()
        .from(attendeesTable)
        .where(eq(attendeesTable.registrationId, r.id));
      return { ...r, attendees };
    }),
  );

  res.json(ListMyRegistrationsResponse.parse(withAttendees));
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

  // Users can only view their own registrations (admins can view all — handled in admin task)
  const userRecord = await db
    .select({ isAdmin: usersTable.isAdmin })
    .from(usersTable)
    .where(eq(usersTable.id, userId));

  const isAdmin = userRecord[0]?.isAdmin ?? false;

  if (full.userId !== userId && !isAdmin) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  res.json(GetRegistrationResponse.parse(full));
});

export default router;
