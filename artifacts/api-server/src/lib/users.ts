import { clerkClient } from "@clerk/express";
import { db, usersTable } from "@workspace/db";
import { sql } from "drizzle-orm";

export interface ClerkProfile {
  email: string;
  firstName: string | null;
  lastName: string | null;
}

interface Logger {
  warn: (obj: unknown, msg?: string) => void;
}

/**
 * Provision (or refresh) the local user row for a Clerk user.
 *
 * The session token does NOT reliably carry email / first name / last name,
 * so we fetch the authoritative profile from Clerk's Backend API and upsert it.
 *
 * Returns the row as it now exists in the database (not the raw fetch attempt):
 * if the Clerk lookup fails or returns sparse data, previously-stored values are
 * preserved and returned, so callers (e.g. the email confirmation path) still get
 * good data. Empty strings never overwrite existing values.
 */
export async function upsertUserFromClerk(
  userId: string,
  logger?: Logger,
): Promise<ClerkProfile> {
  let email = "";
  let firstName: string | null = null;
  let lastName: string | null = null;

  try {
    const user = await clerkClient.users.getUser(userId);
    email =
      user.primaryEmailAddress?.emailAddress ??
      user.emailAddresses[0]?.emailAddress ??
      "";
    firstName = user.firstName ?? null;
    lastName = user.lastName ?? null;
  } catch (err) {
    logger?.warn({ err, userId }, "Clerk user lookup failed during provisioning");
  }

  const [row] = await db
    .insert(usersTable)
    .values({ id: userId, email, firstName, lastName })
    .onConflictDoUpdate({
      target: usersTable.id,
      set: {
        // Only overwrite when we actually have a fresh, non-empty value;
        // NULLIF('', '') -> NULL so empty strings fall back to the stored value.
        email: sql`COALESCE(NULLIF(${email}, ''), ${usersTable.email})`,
        firstName: sql`COALESCE(NULLIF(${firstName}, ''), ${usersTable.firstName})`,
        lastName: sql`COALESCE(NULLIF(${lastName}, ''), ${usersTable.lastName})`,
      },
    })
    .returning({
      email: usersTable.email,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
    });

  return {
    email: row?.email ?? email,
    firstName: row?.firstName ?? firstName,
    lastName: row?.lastName ?? lastName,
  };
}
