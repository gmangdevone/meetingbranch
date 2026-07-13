import { db, reunionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// Unambiguous alphabet (no 0/O/1/I) for easy sharing by voice/text.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 7;

export function generateCode(length = CODE_LENGTH): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

/** Generates a code guaranteed unique against existing reunions. */
export async function generateUniqueReunionCode(): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = generateCode();
    const [existing] = await db
      .select({ id: reunionsTable.id })
      .from(reunionsTable)
      .where(eq(reunionsTable.code, code))
      .limit(1);
    if (!existing) return code;
  }
  throw new Error("Could not generate a unique reunion code");
}
