import { Router, type IRouter } from "express";
import { eq, and, desc, inArray } from "drizzle-orm";
import { db, vendorsTable, vendorContractsTable } from "@workspace/db";
import {
  CreateVendorBody,
  UpdateVendorBody,
  CreateVendorContractBody,
  CreateVendorResponse,
  UpdateVendorResponse,
  CreateVendorContractResponse,
  ListVendorsResponse,
} from "@workspace/api-zod";
import { attachAuth } from "../middlewares/requireAdmin";
import {
  requireReunionManager,
  requireReunionPermission,
} from "../middlewares/requireReunionManager";

/**
 * Vendors area: organizers with the power_user role evaluate venues, parks,
 * caterers, suppliers, etc., compare quoted costs, attach uploaded contracts,
 * and approve the vendor of choice. Approving a vendor stamps approvedAt;
 * moving it back to prospect/rejected clears it.
 */
const router: IRouter = Router();

const manage = [attachAuth, requireReunionManager, requireReunionPermission("power_user")] as const;

async function loadVendor(reunionId: number, vendorId: number) {
  if (!Number.isInteger(vendorId)) return null;
  const [vendor] = await db
    .select()
    .from(vendorsTable)
    .where(and(eq(vendorsTable.id, vendorId), eq(vendorsTable.reunionId, reunionId)));
  return vendor ?? null;
}

async function vendorWithContracts(vendor: typeof vendorsTable.$inferSelect) {
  const contracts = await db
    .select()
    .from(vendorContractsTable)
    .where(eq(vendorContractsTable.vendorId, vendor.id))
    .orderBy(desc(vendorContractsTable.createdAt), desc(vendorContractsTable.id));
  return { ...vendor, contracts };
}

router.get("/reunions/:reunionId/vendors", ...manage, async (req, res): Promise<void> => {
  const reunionId = req.managedReunion!.id;
  const vendors = await db
    .select()
    .from(vendorsTable)
    .where(eq(vendorsTable.reunionId, reunionId))
    .orderBy(desc(vendorsTable.createdAt), desc(vendorsTable.id));
  const contracts = vendors.length
    ? await db
        .select()
        .from(vendorContractsTable)
        .where(inArray(vendorContractsTable.vendorId, vendors.map((v) => v.id)))
        .orderBy(desc(vendorContractsTable.createdAt), desc(vendorContractsTable.id))
    : [];
  const byVendor = new Map<number, typeof contracts>();
  for (const c of contracts) {
    const list = byVendor.get(c.vendorId) ?? [];
    list.push(c);
    byVendor.set(c.vendorId, list);
  }
  res.json(
    ListVendorsResponse.parse({
      vendors: vendors.map((v) => ({ ...v, contracts: byVendor.get(v.id) ?? [] })),
    }),
  );
});

/** quotedCost is whole dollars; the generated zod allows any number, so enforce integer here. */
function hasValidQuotedCost(data: { quotedCost?: number | null }): boolean {
  return data.quotedCost == null || Number.isInteger(data.quotedCost);
}

/** Service window: an end date requires a start date and must not be before it (YYYY-MM-DD strings compare lexically). */
function hasValidServiceDates(data: { serviceDate?: string | null; serviceEndDate?: string | null }): boolean {
  if (data.serviceEndDate == null) return true;
  return data.serviceDate != null && data.serviceEndDate >= data.serviceDate;
}

router.post("/reunions/:reunionId/vendors", ...manage, async (req, res): Promise<void> => {
  const body = CreateVendorBody.safeParse(req.body);
  if (!body.success || !hasValidQuotedCost(body.data) || !hasValidServiceDates(body.data)) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const [created] = await db
    .insert(vendorsTable)
    .values({ ...body.data, reunionId: req.managedReunion!.id })
    .returning();
  res.status(201).json(CreateVendorResponse.parse({ ...created, contracts: [] }));
});

router.put("/reunions/:reunionId/vendors/:vendorId", ...manage, async (req, res): Promise<void> => {
  const body = UpdateVendorBody.safeParse(req.body);
  if (!body.success || !hasValidQuotedCost(body.data)) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const vendor = await loadVendor(req.managedReunion!.id, Number(req.params.vendorId));
  if (!vendor) {
    res.status(404).json({ error: "Vendor not found" });
    return;
  }
  // Validate the service window against the merged result of the update.
  const merged = { ...vendor, ...body.data };
  if (!hasValidServiceDates(merged)) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const updates: Record<string, unknown> = { ...body.data };
  if (body.data.status && body.data.status !== vendor.status) {
    updates.approvedAt = body.data.status === "approved" ? new Date() : null;
  }
  const [updated] = await db
    .update(vendorsTable)
    .set(updates)
    .where(eq(vendorsTable.id, vendor.id))
    .returning();
  res.json(UpdateVendorResponse.parse(await vendorWithContracts(updated)));
});

router.delete("/reunions/:reunionId/vendors/:vendorId", ...manage, async (req, res): Promise<void> => {
  const vendor = await loadVendor(req.managedReunion!.id, Number(req.params.vendorId));
  if (!vendor) {
    res.status(404).json({ error: "Vendor not found" });
    return;
  }
  await db.delete(vendorsTable).where(eq(vendorsTable.id, vendor.id));
  res.status(204).end();
});

router.post(
  "/reunions/:reunionId/vendors/:vendorId/contracts",
  ...manage,
  async (req, res): Promise<void> => {
    const body = CreateVendorContractBody.safeParse(req.body);
    if (!body.success || !body.data.objectPath.startsWith("/objects/")) {
      res.status(400).json({ error: "Invalid input" });
      return;
    }
    const vendor = await loadVendor(req.managedReunion!.id, Number(req.params.vendorId));
    if (!vendor) {
      res.status(404).json({ error: "Vendor not found" });
      return;
    }
    const [created] = await db
      .insert(vendorContractsTable)
      .values({
        vendorId: vendor.id,
        reunionId: vendor.reunionId,
        fileName: body.data.fileName,
        objectPath: body.data.objectPath,
        uploadedBy: req.userId!,
      })
      .returning();
    res.status(201).json(CreateVendorContractResponse.parse(created));
  },
);

router.delete(
  "/reunions/:reunionId/vendors/:vendorId/contracts/:contractId",
  ...manage,
  async (req, res): Promise<void> => {
    const contractId = Number(req.params.contractId);
    const vendor = await loadVendor(req.managedReunion!.id, Number(req.params.vendorId));
    if (!vendor || !Number.isInteger(contractId)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const [deleted] = await db
      .delete(vendorContractsTable)
      .where(
        and(
          eq(vendorContractsTable.id, contractId),
          eq(vendorContractsTable.vendorId, vendor.id),
        ),
      )
      .returning();
    if (!deleted) {
      res.status(404).json({ error: "Contract not found" });
      return;
    }
    res.status(204).end();
  },
);

export default router;
