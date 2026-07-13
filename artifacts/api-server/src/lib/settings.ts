import { db, appSettingsTable } from "@workspace/db";
import { asc, sql } from "drizzle-orm";
import type { AppSettings } from "@workspace/db";

// Arbitrary constant key for the transaction-scoped advisory lock that
// serializes concurrent first-time creation of the singleton settings row.
const SETTINGS_LOCK_KEY = 4820193;

/** Returns the single settings row, creating it with defaults if missing. */
export async function getOrCreateSettings(): Promise<AppSettings> {
  return db.transaction(async (tx) => {
    // Serialize concurrent creators so we never insert two settings rows.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${SETTINGS_LOCK_KEY})`);

    const [existing] = await tx
      .select()
      .from(appSettingsTable)
      .orderBy(asc(appSettingsTable.id))
      .limit(1);
    if (existing) return existing;

    const [created] = await tx.insert(appSettingsTable).values({}).returning();
    return created;
  });
}
