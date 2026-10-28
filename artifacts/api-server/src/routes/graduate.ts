import { Router, type IRouter } from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, graduateConfigsTable, graduateSubmissionsTable, reunionsTable, reunionOrganizersTable, usersTable } from "@workspace/db";
import { SaveGraduateContentBody, SaveGraduateControlsBody, SubmitGraduateApplicationBody } from "@workspace/api-zod";
import { attachAuth, requireAdmin } from "../middlewares/requireAdmin";
import { requireReunionManager, requireReunionPermission, hasReunionPermission } from "../middlewares/requireReunionManager";
import { lockReunionRow } from "../lib/ledger";
import { defaultGraduateContent, graduateApplicationError, graduateContentError, publicGraduateSubmission } from "../lib/graduate";
import { sendGraduateEmail } from "../lib/graduateEmail";

const router: IRouter = Router();
const base = "/reunions/:reunionId/graduate-dollars";
const manage = [attachAuth, requireReunionManager] as const;
type Exec = Pick<typeof db, "select" | "insert" | "update">;
router.use(base, (_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });

async function configFor(id: number, exec: Exec = db) {
  const [row] = await exec.select().from(graduateConfigsTable).where(eq(graduateConfigsTable.reunionId, id));
  return {
    controls: { visible: row?.visible ?? false, open: row?.open ?? false, recipientId: row?.recipientId ?? null },
    content: row ? SaveGraduateContentBody.parse({ ...row.content, revision: row.revision }) : defaultGraduateContent,
  };
}
async function organizersFor(id: number, exec: Exec = db) {
  const [event] = await exec.select().from(reunionsTable).where(eq(reunionsTable.id, id));
  if (!event) return [];
  const co = await exec.select().from(reunionOrganizersTable).where(eq(reunionOrganizersTable.reunionId, id));
  const users = await exec.select().from(usersTable).where(inArray(usersTable.id, [event.organizerId, ...co.map(c => c.userId)]));
  return users.map(u => ({
    id: u.id, name: [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email,
    email: u.email,
    eligible: !u.isManaged && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u.email) && !u.email.endsWith(".invalid"),
  }));
}
async function reviewer(req: Express.Request) {
  const cfg = await configFor(req.managedReunion!.id);
  // requireReunionManager ensures a removed organizer cannot retain access.
  return !!(req.isAdmin || req.reunionAccess?.isOwner || cfg.controls.recipientId === req.userId);
}
async function ensureConfig(id: number, exec: Exec) {
  await exec.insert(graduateConfigsTable).values({ reunionId: id, content: defaultGraduateContent }).onConflictDoNothing();
}

// Only the published document is returned; hidden content and recipient data never leak.
router.get(base, async (req, res): Promise<void> => {
  const id = Number(req.params.reunionId);
  if (!Number.isSafeInteger(id) || id < 1) { res.status(400).json({ error: "Invalid event." }); return; }
  const [event] = await db.select({ id: reunionsTable.id }).from(reunionsTable).where(eq(reunionsTable.id, id));
  if (!event) { res.status(404).json({ error: "Event not found." }); return; }
  const cfg = await configFor(id);
  if (!cfg.controls.visible) { res.json({ visible: false, open: false }); return; }
  const valid = (await organizersFor(id)).some(o => o.id === cfg.controls.recipientId && o.eligible);
  res.json({ visible: true, open: cfg.controls.open && valid, content: cfg.content });
});
router.get(`${base}/config`, ...manage, async (req, res) => {
  const cfg = await configFor(req.managedReunion!.id);
  const organizers = await organizersFor(req.managedReunion!.id);
  const canEdit = hasReunionPermission(req.reunionAccess!, "power_user");
  const canReview = await reviewer(req);
  if (!canEdit && !canReview) { res.status(403).json({ error: "You do not have access to Graduate Dollars." }); return; }
  res.json({ ...cfg, canEdit, canReview, canAdmin: !!req.isAdmin,
    recipientValid: organizers.some(o => o.id === cfg.controls.recipientId && o.eligible),
    organizers: req.isAdmin ? organizers : [] });
});
router.put(`${base}/config`, ...manage, requireReunionPermission("power_user"), async (req, res): Promise<void> => {
  const parsed = SaveGraduateContentBody.strict().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Check the content fields, colors, typography, and limits." }); return; }
  const error = graduateContentError(parsed.data);
  if (error) { res.status(400).json({ error }); return; }
  const id = req.managedReunion!.id;
  const saved = await db.transaction(async tx => {
    await lockReunionRow(tx, id);
    await ensureConfig(id, tx);
    const cfg = await configFor(id, tx);
    if (cfg.content.revision !== parsed.data.revision) return null;
    const content = { ...parsed.data, revision: cfg.content.revision + 1 };
    await tx.update(graduateConfigsTable).set({ content, revision: content.revision }).where(eq(graduateConfigsTable.reunionId, id));
    return content;
  });
  if (!saved) { res.status(409).json({ error: "Another organizer changed this page. Reload before saving." }); return; }
  res.json(saved);
});
router.put(`${base}/controls`, ...manage, requireAdmin, async (req, res): Promise<void> => {
  const parsed = SaveGraduateControlsBody.strict().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid controls." }); return; }
  const id = req.managedReunion!.id;
  const error = await db.transaction(async tx => {
    await lockReunionRow(tx, id);
    const valid = (await organizersFor(id, tx)).some(o => o.id === parsed.data.recipientId && o.eligible);
    if ((parsed.data.open || parsed.data.recipientId) && !valid) return "Choose a current organizer with a valid email before opening applications.";
    await ensureConfig(id, tx);
    await tx.update(graduateConfigsTable).set(parsed.data).where(eq(graduateConfigsTable.reunionId, id));
    return null;
  });
  if (error) { res.status(400).json({ error }); return; }
  res.json(parsed.data);
});

// Claim delivery atomically. No automatic repeat send after an uncertain network
// outcome: staff see the warning and must explicitly retry (max five attempts).
async function deliver(id: number, submissionId: number): Promise<{ error: string; status: number } | null> {
  const claimed = await db.transaction(async tx => {
    await lockReunionRow(tx, id);
    const [s] = await tx.select().from(graduateSubmissionsTable).where(and(eq(graduateSubmissionsTable.id, submissionId), eq(graduateSubmissionsTable.reunionId, id)));
    if (!s) return { error: "Application not found.", status: 404 } as const;
    if (s.emailAttempts >= 5) return { error: "Five email attempts reached. Review this application in the app.", status: 429 } as const;
    if (s.emailAttemptAt && Date.now() - s.emailAttemptAt.getTime() < 60000) return { error: "Please wait one minute before sending again.", status: 429 } as const;
    const cfg = await configFor(id, tx);
    const recipient = (await organizersFor(id, tx)).find(o => o.id === cfg.controls.recipientId && o.eligible);
    if (!recipient) {
      await tx.update(graduateSubmissionsTable).set({ emailStatus: "failed", emailError: "The selected organizer is unavailable. An admin must choose a current recipient." }).where(eq(graduateSubmissionsTable.id, s.id));
      return { error: "The selected organizer is unavailable. An admin must choose a current recipient.", status: 409 } as const;
    }
    const [event] = await tx.select().from(reunionsTable).where(eq(reunionsTable.id, id));
    await tx.update(graduateSubmissionsTable).set({ emailStatus: "sending", emailAttempts: s.emailAttempts + 1,
      emailAttemptAt: new Date(), emailRecipientId: recipient.id, emailRecipient: recipient.email, emailError: null,
    }).where(eq(graduateSubmissionsTable.id, s.id));
    return { s, recipient, event };
  });
  if (claimed.status !== undefined) return claimed;
  try {
    const messageId = await sendGraduateEmail(claimed.recipient.email, claimed.event.name, claimed.s);
    await db.update(graduateSubmissionsTable).set({ emailStatus: "accepted", providerMessageId: messageId, emailError: null })
      .where(and(eq(graduateSubmissionsTable.id, submissionId), eq(graduateSubmissionsTable.emailAttempts, claimed.s.emailAttempts + 1)));
  } catch {
    // Never store provider bodies, credentials, or applicant PII in errors/logs.
    await db.update(graduateSubmissionsTable).set({ emailStatus: "failed",
      emailError: "Email could not be confirmed. The application is saved; retry may send a duplicate if the provider already accepted it.",
    }).where(and(eq(graduateSubmissionsTable.id, submissionId), eq(graduateSubmissionsTable.emailAttempts, claimed.s.emailAttempts + 1)));
  }
  return null;
}
router.post(`${base}/applications`, attachAuth, async (req, res): Promise<void> => {
  const id = Number(req.params.reunionId);
  if (!Number.isSafeInteger(id) || id < 1 || !req.userId) { res.status(400).json({ error: "Invalid event or account." }); return; }
  const parsed = SubmitGraduateApplicationBody.strict().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Check your name, email, answers, links, and field lengths." }); return; }
  const input = parsed.data;
  const result = await db.transaction(async tx => {
    const [event] = await tx.select().from(reunionsTable).where(eq(reunionsTable.id, id)).for("update");
    if (!event) return { error: "Event not found.", status: 404 } as const;
    const [previous] = await tx.select().from(graduateSubmissionsTable).where(and(
      eq(graduateSubmissionsTable.reunionId, id), eq(graduateSubmissionsTable.userId, req.userId!), eq(graduateSubmissionsTable.requestId, input.requestId)));
    if (previous) return { submission: previous, fresh: false };
    const cfg = await configFor(id, tx);
    if (!cfg.controls.visible || !cfg.controls.open) return { error: "Scholarship applications are closed.", status: 403 } as const;
    if (!(await organizersFor(id, tx)).some(o => o.id === cfg.controls.recipientId && o.eligible)) return { error: "Applications are temporarily unavailable while an admin updates the recipient.", status: 503 } as const;
    if (input.revision !== cfg.content.revision) return { error: "The application requirements changed. Review the latest questions before submitting.", status: 409 } as const;
    const error = graduateApplicationError(input, cfg.content);
    if (error) return { error, status: 400 } as const;
    const [submission] = await tx.insert(graduateSubmissionsTable).values({
      reunionId: id, userId: req.userId!, requestId: input.requestId, revision: cfg.content.revision,
      name: input.name.trim(), email: input.email.trim(), zelle: input.zelle.trim(), cashApp: input.cashApp.trim(),
      answers: cfg.content.questions.map(q => ({ questionId: q.id, label: q.label, value: input.answers.find(a => a.questionId === q.id)?.value.trim() ?? "" })),
      links: input.links.map(l => ({ label: l.label.trim(), url: l.url.trim() })),
    }).returning();
    return { submission, fresh: true };
  });
  if (result.status !== undefined) { res.status(result.status).json({ error: result.error }); return; }
  if (result.fresh) {
    try { await deliver(id, result.submission.id); }
    catch { req.log.error({ submissionId: result.submission.id }, "Scholarship email attempt interrupted; application retained"); }
  }
  const [saved] = await db.select().from(graduateSubmissionsTable).where(eq(graduateSubmissionsTable.id, result.submission.id));
  res.status(201).json(publicGraduateSubmission(saved));
});
router.get(`${base}/mine`, async (req, res) => {
  const id = Number(req.params.reunionId);
  if (!Number.isSafeInteger(id) || id < 1) { res.status(400).json({ error: "Invalid event." }); return; }
  const rows = await db.select().from(graduateSubmissionsTable).where(and(eq(graduateSubmissionsTable.reunionId, id),
    eq(graduateSubmissionsTable.userId, req.userId!))).orderBy(desc(graduateSubmissionsTable.createdAt));
  res.json(rows.map(publicGraduateSubmission));
});
router.get(`${base}/applications`, ...manage, async (req, res) => {
  if (!await reviewer(req)) { res.status(403).json({ error: "Scholarship applications are private." }); return; }
  const rows = await db.select().from(graduateSubmissionsTable).where(eq(graduateSubmissionsTable.reunionId, req.managedReunion!.id)).orderBy(desc(graduateSubmissionsTable.createdAt));
  res.json(rows.map(publicGraduateSubmission));
});
router.post(`${base}/applications/:submissionId/resend`, ...manage, async (req, res) => {
  if (!await reviewer(req)) { res.status(403).json({ error: "Scholarship applications are private." }); return; }
  const sid = Number(req.params.submissionId);
  if (!Number.isSafeInteger(sid) || sid < 1) { res.status(400).json({ error: "Invalid application." }); return; }
  const error = await deliver(req.managedReunion!.id, sid);
  if (error) { res.status(error.status).json({ error: error.error }); return; }
  const [saved] = await db.select().from(graduateSubmissionsTable).where(eq(graduateSubmissionsTable.id, sid));
  res.json(publicGraduateSubmission(saved));
});
export default router;
