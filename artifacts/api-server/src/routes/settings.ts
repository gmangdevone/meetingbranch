import { Router, type IRouter } from "express";
import { GetSettingsResponse } from "@workspace/api-zod";
import { getOrCreateSettings } from "../lib/settings";

const router: IRouter = Router();

// GET /settings (public) — used by the frontend to gate the "create reunion" flow
router.get("/settings", async (_req, res): Promise<void> => {
  const settings = await getOrCreateSettings();
  res.json(
    GetSettingsResponse.parse({
      reunionCreationEnabled: settings.reunionCreationEnabled,
    }),
  );
});

export default router;
