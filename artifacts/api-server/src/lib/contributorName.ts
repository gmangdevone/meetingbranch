import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// Resolve against the app profile, which preserves the member's edited name.
export async function resolveContributorName(userId: string, displayName?: string | null): Promise<string | null> {
  if (displayName?.trim()) return displayName.trim();
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  return [user?.firstName, user?.lastName].map(part => part?.trim()).filter(Boolean).join(" ") || null;
}
