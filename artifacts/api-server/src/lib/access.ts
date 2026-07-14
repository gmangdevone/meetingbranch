import {
  db,
  usersTable,
  reunionsTable,
  reunionOrganizersTable,
  appSettingsTable,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import type { AppSettings } from "@workspace/db";

// Read-only view of the settings the lockdown check needs. Defaults mirror the
// schema so a missing singleton row behaves like a fresh install (no lockdown).
export interface AccessSettings {
  reunionCreationEnabled: boolean;
  signInsLocked: boolean;
  testerEmails: string[];
}

const DEFAULT_SETTINGS: AccessSettings = {
  reunionCreationEnabled: true,
  signInsLocked: false,
  testerEmails: [],
};

// Short in-memory cache so the lockdown check doesn't add a settings query to
// every authenticated request.
const SETTINGS_CACHE_MS = 10_000;
let cached: { settings: AccessSettings; at: number } | null = null;

export async function getCachedSettings(): Promise<AccessSettings> {
  if (cached && Date.now() - cached.at < SETTINGS_CACHE_MS) return cached.settings;
  // Plain read — the singleton row is created lazily by the write paths.
  const rows: AppSettings[] = await db.select().from(appSettingsTable);
  const row = rows[0];
  const settings: AccessSettings = row
    ? {
        reunionCreationEnabled: row.reunionCreationEnabled,
        signInsLocked: row.signInsLocked ?? false,
        testerEmails: row.testerEmails ?? [],
      }
    : DEFAULT_SETTINGS;
  cached = { settings, at: Date.now() };
  return settings;
}

/** Call after admin settings updates so changes take effect immediately. */
export function invalidateSettingsCache(): void {
  cached = null;
}

/**
 * Whether this signed-in user may use the app while the sign-in lockdown is
 * active. Platform admins, reunion organizers (owners and co-organizers), and
 * allowlisted tester emails are exempt.
 */
export async function isExemptFromLockdown(
  userId: string,
  isAdmin: boolean,
  testerEmails: string[],
): Promise<boolean> {
  if (isAdmin) return true;

  const [organizerOf] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(reunionsTable)
    .where(eq(reunionsTable.organizerId, userId));
  if (organizerOf.count > 0) return true;

  const [coOrganizerOf] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(reunionOrganizersTable)
    .where(eq(reunionOrganizersTable.userId, userId));
  if (coOrganizerOf.count > 0) return true;

  if (testerEmails.length > 0) {
    const [user] = await db
      .select({ email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.id, userId));
    const email = user?.email?.trim().toLowerCase();
    if (email && testerEmails.some((t) => t.trim().toLowerCase() === email)) {
      return true;
    }
  }

  return false;
}
