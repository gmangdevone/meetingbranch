import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, reunionsTable, paymentSubmissionsTable } from "@workspace/db";
import {
  ElectBranchFeeBody,
  CreateBranchFeePaymentSubmissionBody,
  CreateBranchFeePaymentSubmissionResponse,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { lockReunionRow, rows, isValidIsoDate, fmtCents } from "../lib/ledger";
import { loadBranchFeeOptions, loadMyElections, loadBranchFeeLedgers, lockElection } from "../lib/branchFees";
import { canManageRegistrations } from "./registrations";
import { findDestinationKeys, unavailableMethodError } from "../lib/paymentRecipients";

/**
 * Member side of the branch special fee: elect (claim) a branch's fee to pay
 * it IN FULL, report the payment on its own, see status/history, release.
 * Elections never create attendee registrations.
 */
const router: IRouter = Router();

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function reunionExists(id: number) {
  const [r] = await db.select({ id: reunionsTable.id, open: reunionsTable.registrationsOpen }).from(reunionsTable).where(eq(reunionsTable.id, id));
  return r ?? null;
}

router.get("/reunions/:reunionId/branch-fee-options", requireAuth, async (req, res): Promise<void> => {
  const reunionId = Number(req.params.reunionId);
  if (!Number.isInteger(reunionId) || !(await reunionExists(reunionId))) {
    res.status(404).json({ error: "Reunion not found" });
    return;
  }
  res.json({ options: await loadBranchFeeOptions(db, reunionId, (req as any).userId as string) });
});

router.get("/reunions/:reunionId/branch-fee-elections/mine", requireAuth, async (req, res): Promise<void> => {
  const reunionId = Number(req.params.reunionId);
  if (!Number.isInteger(reunionId) || !(await reunionExists(reunionId))) {
    res.status(404).json({ error: "Reunion not found" });
    return;
  }
  res.json({ elections: await loadMyElections(db, reunionId, (req as any).userId as string) });
});

router.post("/reunions/:reunionId/branch-fee-elections", requireAuth, async (req, res): Promise<void> => {
  const reunionId = Number(req.params.reunionId);
  const body = ElectBranchFeeBody.safeParse(req.body);
  if (!Number.isInteger(reunionId) || !body.success) {
    res.status(400).json({ error: "Choose a branch." });
    return;
  }
  const reunion = await reunionExists(reunionId);
  if (!reunion) {
    res.status(404).json({ error: "Reunion not found" });
    return;
  }
  const userId = (req as any).userId as string;
  try {
    const electionId = await db.transaction(async (tx) => {
      // Reunion lock serializes elections: the fee can be claimed once.
      await lockReunionRow(tx, reunionId);
      const [b] = await rows<{ id: number; special_fee_enabled: boolean; special_fee_cents: number; archived_at: Date | null }>(tx, sql`
        SELECT id, special_fee_enabled, special_fee_cents, archived_at FROM reunion_branches WHERE id = ${body.data.branchId} AND reunion_id = ${reunionId}`);
      if (!b || b.archived_at) throw new HttpError(404, "That branch isn't available.");
      const [existing] = await rows<{ id: number; user_id: string }>(tx, sql`
        SELECT id, user_id FROM branch_fee_elections WHERE branch_id = ${b.id} AND status = 'active'`);
      if (existing) {
        if (existing.user_id === userId) return existing.id; // idempotent: no duplicate charge
        const [l] = await loadBranchFeeLedgers(tx, reunionId, { branchIds: [b.id], includePayers: false });
        throw new HttpError(409, l?.state === "paid" ? "This branch fee is already paid. Nothing more is owed." : "Someone else in this branch already chose to pay this fee.");
      }
      const [cur] = await loadBranchFeeLedgers(tx, reunionId, { branchIds: [b.id], includePayers: false });
      if (cur?.state === "paid") throw new HttpError(409, "This branch fee is already paid. Nothing more is owed.");
      if (cur?.state === "legacy_review") throw new HttpError(409, "Earlier payments toward this branch fee are awaiting organizer review. Check back after they're sorted out.");
      if (!reunion.open) throw new HttpError(403, "Registration is currently closed for this reunion.");
      if (!b.special_fee_enabled || b.special_fee_cents <= 0) throw new HttpError(409, "This branch doesn't have a special fee right now.");
      if (b.special_fee_cents !== body.data.expectedAmountCents) {
        throw new HttpError(409, `The fee is now ${fmtCents(b.special_fee_cents)}. Review the new amount and choose again.`);
      }
      const [created] = await rows<{ id: number }>(tx, sql`
        INSERT INTO branch_fee_elections (reunion_id, branch_id, user_id, amount_cents) VALUES (${reunionId}, ${b.id}, ${userId}, ${b.special_fee_cents}) RETURNING id`);
      return created.id;
    });
    const [mine] = await loadMyElections(db, reunionId, userId, electionId);
    res.json(mine);
  } catch (err) {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    if ((err as { code?: string })?.code === "23505") {
      res.status(409).json({ error: "Someone else in this branch already chose to pay this fee." });
      return;
    }
    throw err;
  }
});

router.delete("/branch-fee-elections/:electionId", requireAuth, async (req, res): Promise<void> => {
  const electionId = Number(req.params.electionId);
  if (!Number.isInteger(electionId)) {
    res.status(400).json({ error: "Invalid election" });
    return;
  }
  const userId = (req as any).userId as string;
  const [head] = await rows<{ reunion_id: number }>(db, sql`SELECT reunion_id FROM branch_fee_elections WHERE id = ${electionId}`);
  if (!head) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const manager = await canManageRegistrations(userId, head.reunion_id);
  try {
    await db.transaction(async (tx) => {
      await lockReunionRow(tx, head.reunion_id);
      const e = await lockElection(tx, electionId);
      if (!e) throw new HttpError(404, "Not found");
      if (e.user_id !== userId && !manager) throw new HttpError(403, "Forbidden");
      if (e.status === "paid") throw new HttpError(409, "This fee is already paid. Reverse the receipt first if it was a mistake.");
      if (e.status === "reported" && !manager) throw new HttpError(409, "Your payment report is awaiting confirmation. Ask an organizer to review it before releasing.");
      // Idempotent: releasing an already-released election is a no-op.
      await tx.execute(sql`UPDATE branch_fee_elections SET status = 'released', released_at = now(), released_by = ${userId} WHERE id = ${electionId} AND status = 'active'`);
    });
    res.status(204).send();
  } catch (err) {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    throw err;
  }
});

router.post("/branch-fee-elections/:electionId/payment-submissions", requireAuth, async (req, res): Promise<void> => {
  const electionId = Number(req.params.electionId);
  const body = CreateBranchFeePaymentSubmissionBody.safeParse(req.body);
  if (!Number.isInteger(electionId) || !body.success) {
    res.status(400).json({ error: body.success ? "Invalid election" : body.error.message });
    return;
  }
  if (findDestinationKeys(req.body).length > 0) {
    res.status(400).json({ error: "Payment submissions cannot set a receiving destination." });
    return;
  }
  const userId = (req as any).userId as string;
  const { method, reference, givenDate, note } = body.data;
  if ((method === "cashapp" || method === "zelle" || method === "cash") && !reference?.trim()) {
    const label = method === "cashapp" ? "your $cashtag" : method === "zelle" ? "your Zelle ID" : "who received the cash";
    res.status(400).json({ error: `Please include ${label}.` });
    return;
  }
  if (method === "cash" && !isValidIsoDate(givenDate ?? "")) {
    res.status(400).json({ error: "Please include the date the cash was given (YYYY-MM-DD)." });
    return;
  }
  const [head] = await rows<{ reunion_id: number }>(db, sql`SELECT reunion_id FROM branch_fee_elections WHERE id = ${electionId}`);
  if (!head) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const unavailable = await unavailableMethodError(method, head.reunion_id);
  if (unavailable) {
    res.status(409).json({ error: unavailable });
    return;
  }
  try {
    const out = await db.transaction(async (tx) => {
      await lockReunionRow(tx, head.reunion_id);
      const e = await lockElection(tx, electionId);
      if (!e) throw new HttpError(404, "Not found");
      if (e.user_id !== userId) throw new HttpError(403, "Forbidden");
      if (e.status_db !== "active") throw new HttpError(409, "You released this branch fee. Choose it again to pay.");
      if (e.status === "paid") throw new HttpError(409, "This branch fee is already paid. Nothing more is owed.");
      if (e.status === "reported") throw new HttpError(409, "You already reported this payment. An organizer will confirm it.");
      if (!e.enabled) throw new HttpError(409, "This branch isn't collecting its fee right now.");
      const [created] = await tx.insert(paymentSubmissionsTable).values({
        reunionId: e.reunionId,
        registrationId: null,
        registrationIds: [],
        contributionIds: [],
        submittedBy: userId,
        method,
        amount: Math.floor(e.amount_cents / 100),
        amountCents: e.amount_cents,
        branchFeeBranchId: e.branch_id,
        branchFeeCents: e.amount_cents,
        branchFeeElectionId: e.id,
        reference: reference?.trim() || null,
        givenDate: givenDate || null,
        note: note?.trim() || null,
      }).returning();
      return { created, e };
    });
    const { branchFeeBranchId: _b, branchFeeCents: _c, branchFeeElectionId: _e, ...rest } = out.created;
    void _b; void _c; void _e;
    res.status(201).json(CreateBranchFeePaymentSubmissionResponse.parse({
      ...rest,
      amount: out.e.amount_cents / 100,
      amountCents: out.e.amount_cents,
      confirmedReceiptId: null,
      contributions: [],
      branchFee: { branchId: out.e.branch_id, electionId: out.e.id, branchName: out.e.branchName, label: out.e.label, amountCents: out.e.amount_cents },
    }));
  } catch (err) {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    throw err;
  }
});

export default router;
