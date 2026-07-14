import { Router, type IRouter } from "express";
import { GetSettingsResponse, GetMyAccessResponse } from "@workspace/api-zod";
import { getOrCreateSettings } from "../lib/settings";
import { getCachedSettings, isExemptFromLockdown } from "../lib/access";
import { attachAuth } from "../middlewares/requireAdmin";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

// GET /settings (public) — used by the frontend to gate the "create reunion"
// flow and surface the sign-in lockdown notice.
router.get("/settings", async (_req, res): Promise<void> => {
  const settings = await getOrCreateSettings();
  res.json(
    GetSettingsResponse.parse({
      reunionCreationEnabled: settings.reunionCreationEnabled,
      signInsLocked: settings.signInsLocked,
    }),
  );
});

// GET /me/access — lets a signed-in user (and the frontend shell) discover
// whether the current lockdown blocks them. Never itself blocked by lockdown.
router.get("/me/access", attachAuth, requireAuth, async (req, res): Promise<void> => {
  const settings = await getCachedSettings();
  const allowed =
    !settings.signInsLocked ||
    (await isExemptFromLockdown(req.userId!, req.isAdmin ?? false, settings.testerEmails));
  res.json(GetMyAccessResponse.parse({ allowed, signInsLocked: settings.signInsLocked }));
});

export default router;
