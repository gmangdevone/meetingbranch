import { Router, type IRouter } from "express";
import {
  GetMyPaymentOwnerCapabilityResponse,
  GetReunionPaymentRecipientResponse,
  OwnerListPaymentRecipientsResponse,
  OwnerGetPaymentRecipientResponse,
  OwnerSavePaymentRecipientBody,
  OwnerSavePaymentRecipientResponse,
  OwnerDisablePaymentRecipientBody,
  OwnerDisablePaymentRecipientResponse,
  OwnerListPaymentRecipientHistoryResponse,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requirePaymentOwner } from "../middlewares/requirePaymentOwner";
import {
  isPaymentOwner,
  validateRecipientInput,
  resolveRecipient,
  listOwnerRecipients,
  getOwnerRecipientDetail,
  writeRecipient,
  listRecipientHistory,
  StaleVersionError,
  ReunionNotFoundError,
  withoutCashApp,
  withoutZelle,
} from "../lib/paymentRecipients";
import { db, reunionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

/**
 * Owner-controlled payment recipients. Mounted BEFORE the admin router so the
 * admin router's global requireAdmin never applies here: owner authority must
 * not depend on (or be granted by) the mutable isAdmin flag.
 */
const router: IRouter = Router();

function parseReunionId(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// Capability discovery: only a boolean, never the configured id/email.
router.get("/me/payment-owner", requireAuth, (req, res): void => {
  res.set("Cache-Control", "no-store");
  res.json(GetMyPaymentOwnerCapabilityResponse.parse({ isPaymentOwner: isPaymentOwner((req as any).userId) }));
});

// Public: freshly resolved approved destination for payment handoff.
router.get("/reunions/:reunionId/payment-recipient", async (req, res): Promise<void> => {
  const reunionId = parseReunionId(req.params.reunionId);
  if (!reunionId) {
    res.status(400).json({ error: "Invalid reunion id" });
    return;
  }
  const [reunion] = await db.select({ id: reunionsTable.id }).from(reunionsTable).where(eq(reunionsTable.id, reunionId));
  if (!reunion) {
    res.status(404).json({ error: "Reunion not found" });
    return;
  }
  res.set("Cache-Control", "no-store");
  res.json(GetReunionPaymentRecipientResponse.parse(await resolveRecipient(reunionId)));
});

router.use("/owner/payment-recipients", (_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

router.get("/owner/payment-recipients", requirePaymentOwner, async (_req, res): Promise<void> => {
  res.json(OwnerListPaymentRecipientsResponse.parse(await listOwnerRecipients()));
});

router.get("/owner/payment-recipients/:reunionId", requirePaymentOwner, async (req, res): Promise<void> => {
  const reunionId = parseReunionId(req.params.reunionId);
  if (!reunionId) {
    res.status(400).json({ error: "Invalid reunion id" });
    return;
  }
  const detail = await getOwnerRecipientDetail(reunionId);
  if (!detail) {
    res.status(404).json({ error: "Reunion not found" });
    return;
  }
  res.json(OwnerGetPaymentRecipientResponse.parse(detail));
});

async function handleWrite(
  res: import("express").Response,
  reunionId: number,
  write: () => Promise<void>,
  schema: { parse: (v: unknown) => unknown },
): Promise<void> {
  try {
    await write();
  } catch (err) {
    if (err instanceof StaleVersionError) {
      res.status(409).json({ error: err.message });
      return;
    }
    if (err instanceof ReunionNotFoundError) {
      res.status(404).json({ error: "Reunion not found" });
      return;
    }
    throw err;
  }
  res.json(schema.parse(await getOwnerRecipientDetail(reunionId)));
}

router.put("/owner/payment-recipients/:reunionId", requirePaymentOwner, async (req, res): Promise<void> => {
  const reunionId = parseReunionId(req.params.reunionId);
  const body = OwnerSavePaymentRecipientBody.safeParse(req.body);
  if (!reunionId || !body.success) {
    res.status(400).json({ error: body.success ? "Invalid reunion id" : "Invalid recipient details." });
    return;
  }
  if (body.data.confirm !== true) {
    res.status(400).json({ error: "Confirm the before and after values to save this recipient." });
    return;
  }
  const valid = validateRecipientInput(body.data);
  if (!valid.ok) {
    res.status(400).json({ error: valid.error });
    return;
  }
  const actorUserId = (req as any).userId as string;
  await handleWrite(
    res,
    reunionId,
    async () => {
      await writeRecipient({
        reunionId,
        actorUserId,
        expectedVersion: body.data.expectedVersion,
        next: { status: "approved", ...valid.values },
        note: body.data.note?.trim() || null,
      });
      req.log?.info({ reunionId }, "Payment recipient approved/changed by platform owner");
    },
    OwnerSavePaymentRecipientResponse,
  );
});

router.post("/owner/payment-recipients/:reunionId/disable", requirePaymentOwner, async (req, res): Promise<void> => {
  const reunionId = parseReunionId(req.params.reunionId);
  const body = OwnerDisablePaymentRecipientBody.safeParse(req.body);
  if (!reunionId || !body.success) {
    res.status(400).json({ error: "Invalid request." });
    return;
  }
  if (body.data.confirm !== true) {
    res.status(400).json({ error: "Confirm before disabling payment destinations for this reunion." });
    return;
  }
  const actorUserId = (req as any).userId as string;
  const note = body.data.note?.trim() || null;
  let next: Parameters<typeof writeRecipient>[0]["next"] = {
    status: "disabled",
    cashAppTag: null,
    paymentHandle: null,
    paymentUrl: null,
    zelleRecipientName: null,
    zelleContact: null,
  };
  let action: "disable_cashapp" | "disable_zelle" | undefined;
  if (body.data.scope === "cashapp" || body.data.scope === "zelle") {
    const scope = body.data.scope;
    const detail = await getOwnerRecipientDetail(reunionId);
    if (!detail) {
      res.status(404).json({ error: "Reunion not found" });
      return;
    }
    if (detail.version !== body.data.expectedVersion) {
      res.status(409).json({ error: new StaleVersionError(detail.version).message });
      return;
    }
    const has = scope === "cashapp" ? !!detail.current.cashAppTag : !!detail.current.zelleContact;
    if (detail.status !== "approved" || !has) {
      res.status(400).json({
        error: `${scope === "cashapp" ? "Cash App" : "Zelle"} is not currently approved for this reunion.`,
      });
      return;
    }
    const remaining = scope === "cashapp" ? withoutCashApp(detail.current) : withoutZelle(detail.current);
    // Nothing else approved: turning off this method disables payments entirely.
    if (remaining) next = { status: "approved", ...remaining };
    action = scope === "cashapp" ? "disable_cashapp" : "disable_zelle";
  }
  await handleWrite(
    res,
    reunionId,
    async () => {
      // expectedVersion is re-checked inside the locked transaction, so values
      // computed above can never be applied over a newer owner edit.
      await writeRecipient({ reunionId, actorUserId, expectedVersion: body.data.expectedVersion, next, note, action });
      req.log?.info({ reunionId, scope: body.data.scope }, "Payment recipient disabled by platform owner");
    },
    OwnerDisablePaymentRecipientResponse,
  );
});

router.get("/owner/payment-recipients/:reunionId/history", requirePaymentOwner, async (req, res): Promise<void> => {
  const reunionId = parseReunionId(req.params.reunionId);
  if (!reunionId) {
    res.status(400).json({ error: "Invalid reunion id" });
    return;
  }
  const [reunion] = await db.select({ id: reunionsTable.id }).from(reunionsTable).where(eq(reunionsTable.id, reunionId));
  if (!reunion) {
    res.status(404).json({ error: "Reunion not found" });
    return;
  }
  res.json(OwnerListPaymentRecipientHistoryResponse.parse(await listRecipientHistory(reunionId)));
});

export default router;
