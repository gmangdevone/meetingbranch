import { Router, type IRouter } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db, reunionImagesTable } from "@workspace/db";
import {
  CreateReunionImageBody,
  CreateReunionImageResponse,
  ListReunionImagesResponse,
} from "@workspace/api-zod";
import { attachAuth } from "../middlewares/requireAdmin";
import {
  requireReunionManager,
  requireReunionPermission,
} from "../middlewares/requireReunionManager";

/**
 * Image library: every image an organizer uploads is registered here so it
 * can be browsed and reused across the site (hero banner, hub cards, etc.)
 * without re-uploading. Registering the same objectPath twice returns the
 * existing entry, so "upload then register" is idempotent.
 */
const router: IRouter = Router();

const manage = [attachAuth, requireReunionManager, requireReunionPermission("power_user")] as const;

router.get("/reunions/:reunionId/images", ...manage, async (req, res): Promise<void> => {
  const images = await db
    .select()
    .from(reunionImagesTable)
    .where(eq(reunionImagesTable.reunionId, req.managedReunion!.id))
    .orderBy(desc(reunionImagesTable.createdAt), desc(reunionImagesTable.id));
  res.json(ListReunionImagesResponse.parse({ images }));
});

router.post("/reunions/:reunionId/images", ...manage, async (req, res): Promise<void> => {
  const body = CreateReunionImageBody.safeParse(req.body);
  if (!body.success || !body.data.objectPath.startsWith("/objects/")) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const reunionId = req.managedReunion!.id;
  // Concurrency-safe idempotency: upsert on the (reunionId, objectPath)
  // unique constraint; on conflict, fall back to the existing row.
  const [created] = await db
    .insert(reunionImagesTable)
    .values({
      reunionId,
      fileName: body.data.fileName,
      objectPath: body.data.objectPath,
      uploadedBy: req.userId!,
    })
    .onConflictDoNothing()
    .returning();
  if (created) {
    res.status(201).json(CreateReunionImageResponse.parse(created));
    return;
  }
  const [existing] = await db
    .select()
    .from(reunionImagesTable)
    .where(
      and(
        eq(reunionImagesTable.reunionId, reunionId),
        eq(reunionImagesTable.objectPath, body.data.objectPath),
      ),
    );
  res.status(201).json(CreateReunionImageResponse.parse(existing));
});

router.delete("/reunions/:reunionId/images/:imageId", ...manage, async (req, res): Promise<void> => {
  const imageId = Number(req.params.imageId);
  if (!Number.isInteger(imageId)) {
    res.status(404).json({ error: "Image not found" });
    return;
  }
  const [deleted] = await db
    .delete(reunionImagesTable)
    .where(
      and(
        eq(reunionImagesTable.id, imageId),
        eq(reunionImagesTable.reunionId, req.managedReunion!.id),
      ),
    )
    .returning();
  if (!deleted) {
    res.status(404).json({ error: "Image not found" });
    return;
  }
  res.status(204).end();
});

export default router;
