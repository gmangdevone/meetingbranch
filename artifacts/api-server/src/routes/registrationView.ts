import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { GetMyRegistrationViewResponse, UpdateMyRegistrationViewBody, UpdateMyRegistrationViewResponse } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { upsertUserFromClerk } from "../lib/users";

const router = Router();
const inputSchema = UpdateMyRegistrationViewBody.strict();
const defaults = ["date", "balance", "payment"] as const;

router.get("/me/registration-view", requireAuth, async (req, res) => {
  res.set("Cache-Control", "private, no-store");
  try {
    const [user] = await db.select({
      fields: usersTable.registrationViewFields, isManaged: usersTable.isManaged,
    }).from(usersTable).where(eq(usersTable.id, req.userId!));
    if (user?.isManaged) { res.status(403).json({ error: "Preferences unavailable for this account." }); return; }
    const stored = user?.fields;
    const parsed = stored == null ? null : inputSchema.safeParse({ fields: stored });
    res.json(GetMyRegistrationViewResponse.parse({
      fields: parsed?.success ? [...new Set(parsed.data.fields)] : [...defaults],
      resetInvalid: parsed != null && !parsed.success,
    }));
  } catch (err) {
    req.log?.error({ err }, "Registration view could not be loaded");
    res.status(503).json({ error: "Your registration view could not be loaded. Please try again." });
  }
});

router.put("/me/registration-view", requireAuth, async (req, res) => {
  res.set("Cache-Control", "private, no-store");
  const parsed = inputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Choose only supported registration view fields." });
    return;
  }
  try {
    const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, req.userId!));
    if (!existing) await upsertUserFromClerk(req.userId!, req.log);
    const fields = [...new Set(parsed.data.fields)];
    const [saved] = await db.update(usersTable).set({ registrationViewFields: fields })
      .where(and(eq(usersTable.id, req.userId!), eq(usersTable.isManaged, false)))
      .returning({ id: usersTable.id });
    if (!saved) { res.status(403).json({ error: "Preferences unavailable for this account." }); return; }
    res.json(UpdateMyRegistrationViewResponse.parse({ fields, resetInvalid: false }));
  } catch (err) {
    req.log?.error({ err }, "Registration view could not be saved");
    res.status(503).json({ error: "Your registration view could not be saved. Please try again." });
  }
});

export default router;
