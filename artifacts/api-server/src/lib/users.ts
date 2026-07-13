import { clerkClient } from "@clerk/express";
import { db, usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

/**
 * Provision (or refresh) the local user row for a Clerk user.
 *
 * The session token does NOT reliably carry email / first name / last name,
 * so we fetch the authoritative profile from Clerk's Backend API and upsert it.
 * Existing rows are updated so names/emails backfill on the user's next action.
 */
export interface ClerkProfile {
  email: string;
  firstName: string | null;
  lastName: string | null;
}

export async function upsertUserFromClerk(userId: string): Promise<ClerkProfile> {
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
  } catch {
    // If Clerk lookup fails, still ensure a row exists so FKs hold.
  }

  await db
    .insert(usersTable)
    .values({ id: userId, email, firstName, lastName })
    .onConflictDoUpdate({
      target: usersTable.id,
      set: {
        // Only overwrite when we actually got fresh, non-empty values.
        email: sql`CASE WHEN ${email} <> '' THEN ${email} ELSE ${usersTable.email} END`,
        firstName: sql`COALESCE(${firstName}, ${usersTable.firstName})`,
        lastName: sql`COALESCE(${lastName}, ${usersTable.lastName})`,
      },
    });

  return { email, firstName, lastName };
}
