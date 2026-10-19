import { Router, type IRouter } from "express";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db, checklistItemsTable, checklistProgressTable, reunionsTable } from "@workspace/db";
import { SaveChecklistConfigBody, SetChecklistCompletionBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { attachAuth } from "../middlewares/requireAdmin";
import { requireReunionManager, requireReunionPermission } from "../middlewares/requireReunionManager";
import { checklistAutomaticStatus } from "../lib/checklist";
import { lockReunionRow } from "../lib/ledger";

const router: IRouter = Router();
const manage = [attachAuth, requireReunionManager, requireReunionPermission("power_user")] as const;
const validId = (id: unknown) => Number.isSafeInteger(Number(id)) && Number(id) > 0;
const itemsFor = (id: number) => db.select().from(checklistItemsTable)
  .where(eq(checklistItemsTable.reunionId, id)).orderBy(asc(checklistItemsTable.sortOrder), asc(checklistItemsTable.id));

router.get("/reunions/:reunionId/checklist/config", ...manage, async (req, res) => {
  res.json({ enabled: req.managedReunion!.checklistEnabled, items: await itemsFor(req.managedReunion!.id) });
});

router.put("/reunions/:reunionId/checklist/config", ...manage, async (req, res): Promise<void> => {
  const parsed = SaveChecklistConfigBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Check checklist fields and limits.", fields: parsed.error.flatten().fieldErrors }); return; }
  const input = parsed.data;
  const ids = input.items.filter(i => i.id != null).map(i => i.id!);
  if (ids.some(id => !validId(id)) || new Set(ids).size !== ids.length ||
      input.items.some(i => !i.title.trim() || !Number.isSafeInteger(i.sortOrder))) {
    res.status(400).json({ error: "Each checklist item needs a title, a valid order and a unique ID." }); return;
  }
  for (const item of input.items) {
    if (!item.link?.trim()) continue;
    try {
      const url = new URL(item.link.trim());
      if (!["https:", "http:"].includes(url.protocol) || !url.hostname || url.username || url.password) throw new Error();
    } catch { res.status(400).json({ error: "Checklist links must be full http:// or https:// URLs without embedded credentials." }); return; }
  }
  const reunionId = req.managedReunion!.id;
  const result = await db.transaction(async tx => {
    await lockReunionRow(tx, reunionId);
    const current = await tx.select().from(checklistItemsTable).where(eq(checklistItemsTable.reunionId, reunionId));
    if (ids.some(id => !current.some(i => i.id === id))) return null;
    // Wording edits retain progress; changing what an item verifies requires a new item.
    if (input.items.some(i => i.id != null && current.find(c => c.id === i.id)!.kind !== i.kind)) return null;
    const removed = current.filter(i => !ids.includes(i.id)).map(i => i.id);
    if (removed.length) await tx.delete(checklistItemsTable).where(inArray(checklistItemsTable.id, removed));
    for (const [index, item] of input.items.entries()) {
      const fields = { title: item.title.trim(), description: item.description?.trim() || null,
        link: item.link?.trim() || null, kind: item.kind, visible: item.visible, sortOrder: index };
      if (item.id != null) await tx.update(checklistItemsTable).set(fields).where(and(eq(checklistItemsTable.id, item.id), eq(checklistItemsTable.reunionId, reunionId)));
      else await tx.insert(checklistItemsTable).values({ ...fields, reunionId });
    }
    await tx.update(reunionsTable).set({ checklistEnabled: input.enabled }).where(eq(reunionsTable.id, reunionId));
    return { enabled: input.enabled, items: await tx.select().from(checklistItemsTable)
      .where(eq(checklistItemsTable.reunionId, reunionId)).orderBy(asc(checklistItemsTable.sortOrder), asc(checklistItemsTable.id)) };
  });
  if (!result) { res.status(409).json({ error: "Checklist items changed or their types were modified. Reload before saving; add a new item to change its type." }); return; }
  res.json(result);
});

router.get("/reunions/:reunionId/checklist/mine", requireAuth, async (req, res): Promise<void> => {
  if (!validId(req.params.reunionId)) { res.status(400).json({ error: "Invalid event." }); return; }
  const reunionId = Number(req.params.reunionId);
  const [reunion] = await db.select({ enabled: reunionsTable.checklistEnabled }).from(reunionsTable).where(eq(reunionsTable.id, reunionId));
  if (!reunion) { res.status(404).json({ error: "Event not found." }); return; }
  if (!reunion.enabled) { res.json({ enabled: false, items: [], completedCount: 0, totalCount: 0 }); return; }
  const items = (await itemsFor(reunionId)).filter(i => i.visible);
  const userId = req.userId!;
  const progress = items.length ? await db.select().from(checklistProgressTable)
    .where(and(eq(checklistProgressTable.userId, userId), inArray(checklistProgressTable.itemId, items.map(i => i.id)))) : [];
  const automatic = items.some(i => i.kind !== "manual") ? await checklistAutomaticStatus(db, reunionId, userId) : null;
  const visibleItems = items.map(i => {
    const auto = i.kind === "registration" ? automatic?.registration : i.kind === "payment" ? automatic?.payment : null;
    const completed = auto?.completed ?? progress.some(p => p.itemId === i.id && p.completed);
    return { ...i, completed, statusText: auto?.statusText ?? (completed ? "Complete" : "To do") };
  });
  res.json({ enabled: true, items: visibleItems, completedCount: visibleItems.filter(i => i.completed).length, totalCount: visibleItems.length });
});

router.put("/reunions/:reunionId/checklist/items/:itemId/completion", requireAuth, async (req, res): Promise<void> => {
  const parsed = SetChecklistCompletionBody.safeParse(req.body);
  if (!validId(req.params.reunionId) || !validId(req.params.itemId) || !parsed.success) {
    res.status(400).json({ error: "Invalid checklist completion." }); return;
  }
  const reunionId = Number(req.params.reunionId);
  const result = await db.transaction(async tx => {
    // Same lock as configuration prevents toggling an item after it is hidden or deleted.
    const [reunion] = await tx.select().from(reunionsTable).where(eq(reunionsTable.id, reunionId)).for("update");
    if (!reunion?.checklistEnabled) return "missing";
    const [item] = await tx.select().from(checklistItemsTable).where(and(eq(checklistItemsTable.id, Number(req.params.itemId)), eq(checklistItemsTable.reunionId, reunionId)));
    if (!item?.visible) return "missing";
    if (item.kind !== "manual") return "automatic";
    await tx.insert(checklistProgressTable).values({ itemId: item.id, userId: req.userId!, completed: parsed.data.completed })
      .onConflictDoUpdate({ target: [checklistProgressTable.itemId, checklistProgressTable.userId],
        set: { completed: parsed.data.completed, updatedAt: new Date() } });
    return "saved";
  });
  if (result === "missing") { res.status(404).json({ error: "That checklist item is not available." }); return; }
  if (result === "automatic") { res.status(403).json({ error: "The app verifies this item automatically." }); return; }
  res.json({ completed: parsed.data.completed });
});

export default router;
