import { Router, type IRouter } from "express";
import { eq, and, asc, desc, inArray } from "drizzle-orm";
import {
  db,
  pollsTable,
  pollOptionsTable,
  pollVotesTable,
  registrationsTable,
  attendeesTable,
  usersTable,
} from "@workspace/db";
import {
  SetAttendeeCheckInBody,
  CreatePollBody,
  UpdatePollBody,
  AddPollOptionBody,
  CastPollVotesBody,
  ListMemberPollsResponse,
  ListManagePollsResponse,
  CreatePollResponse,
  UpdatePollResponse,
  AddPollOptionResponse,
  SetAttendeeCheckInResponse,
  CastPollVotesResponse,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { attachAuth } from "../middlewares/requireAdmin";
import {
  requireReunionManager,
  requireReunionPermission,
} from "../middlewares/requireReunionManager";

const router: IRouter = Router();
const manage = [attachAuth, requireReunionManager] as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Membership + voting eligibility in one lookup.
 * - isMember: caller has an active registration in the reunion (may view polls).
 * - checkedIn: that registration has at least one checked-in attendee (may vote).
 */
async function getMembership(
  dbOrTx: Pick<typeof db, "select">,
  reunionId: number,
  userId: string,
): Promise<{ isMember: boolean; checkedIn: boolean }> {
  const rows = await dbOrTx
    .select({ checkedInAt: attendeesTable.checkedInAt })
    .from(registrationsTable)
    .innerJoin(attendeesTable, eq(attendeesTable.registrationId, registrationsTable.id))
    .where(
      and(
        eq(registrationsTable.reunionId, reunionId),
        eq(registrationsTable.userId, userId),
        eq(registrationsTable.status, "active"),
      ),
    );
  return {
    isMember: rows.length > 0,
    checkedIn: rows.some((r) => r.checkedInAt !== null),
  };
}

async function getPollWithOptions(reunionId: number, pollId: number) {
  const [poll] = await db
    .select()
    .from(pollsTable)
    .where(and(eq(pollsTable.id, pollId), eq(pollsTable.reunionId, reunionId)));
  if (!poll) return null;
  const options = await db
    .select()
    .from(pollOptionsTable)
    .where(eq(pollOptionsTable.pollId, poll.id))
    .orderBy(asc(pollOptionsTable.position), asc(pollOptionsTable.id));
  return { ...poll, options };
}

// ── Check-in (organizer, registration area) ───────────────────────────────────
router.patch(
  "/reunions/:reunionId/attendees/:attendeeId/check-in",
  ...manage,
  requireReunionPermission("registration"),
  async (req, res): Promise<void> => {
    const body = SetAttendeeCheckInBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }
    const reunionId = req.managedReunion!.id;
    const attendeeId = Number(req.params.attendeeId);

    // The attendee must belong to a registration of THIS reunion.
    const [row] = await db
      .select({ id: attendeesTable.id })
      .from(attendeesTable)
      .innerJoin(registrationsTable, eq(attendeesTable.registrationId, registrationsTable.id))
      .where(and(eq(attendeesTable.id, attendeeId), eq(registrationsTable.reunionId, reunionId)));
    if (!row) {
      res.status(404).json({ error: "Attendee not found" });
      return;
    }

    const [updated] = await db
      .update(attendeesTable)
      .set({ checkedInAt: body.data.checkedIn ? new Date() : null })
      .where(eq(attendeesTable.id, attendeeId))
      .returning();
    res.json(SetAttendeeCheckInResponse.parse(updated));
  },
);

// ── Organizer poll management (any organizer of the reunion) ─────────────────
router.post("/reunions/:reunionId/polls", ...manage, async (req, res): Promise<void> => {
  const body = CreatePollBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const reunionId = req.managedReunion!.id;
  const { question, maxVotesPerMember, options } = body.data;

  const poll = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(pollsTable)
      .values({ reunionId, question: question.trim(), maxVotesPerMember })
      .returning();
    await tx.insert(pollOptionsTable).values(
      options.map((label, i) => ({ pollId: created.id, label: label.trim(), position: i })),
    );
    return created;
  });

  const full = await getPollWithOptions(reunionId, poll.id);
  res.status(201).json(CreatePollResponse.parse(full));
});

router.get("/reunions/:reunionId/polls/manage", ...manage, async (req, res): Promise<void> => {
  const reunionId = req.managedReunion!.id;
  const polls = await db
    .select()
    .from(pollsTable)
    .where(eq(pollsTable.reunionId, reunionId))
    .orderBy(desc(pollsTable.createdAt), desc(pollsTable.id));
  const pollIds = polls.map((p) => p.id);

  const options = pollIds.length
    ? await db
        .select()
        .from(pollOptionsTable)
        .where(inArray(pollOptionsTable.pollId, pollIds))
        .orderBy(asc(pollOptionsTable.position), asc(pollOptionsTable.id))
    : [];
  const votes = pollIds.length
    ? await db
        .select({
          pollId: pollVotesTable.pollId,
          optionId: pollVotesTable.optionId,
          userId: pollVotesTable.userId,
          firstName: usersTable.firstName,
          lastName: usersTable.lastName,
          email: usersTable.email,
        })
        .from(pollVotesTable)
        .leftJoin(usersTable, eq(pollVotesTable.userId, usersTable.id))
        .where(inArray(pollVotesTable.pollId, pollIds))
    : [];

  const displayName = (v: { firstName: string | null; lastName: string | null; email: string | null }) =>
    [v.firstName, v.lastName].filter(Boolean).join(" ") || v.email || "Unknown member";

  const payload = polls.map((poll) => {
    const pollOptions = options.filter((o) => o.pollId === poll.id);
    const pollVotes = votes.filter((v) => v.pollId === poll.id);
    return {
      poll: { ...poll, options: pollOptions },
      totalVoters: new Set(pollVotes.map((v) => v.userId)).size,
      results: pollOptions.map((o) => {
        const forOption = pollVotes.filter((v) => v.optionId === o.id);
        return {
          optionId: o.id,
          label: o.label,
          voteCount: forOption.length,
          voters: forOption.map(displayName),
        };
      }),
    };
  });
  res.json(ListManagePollsResponse.parse(payload));
});

router.patch("/reunions/:reunionId/polls/:pollId", ...manage, async (req, res): Promise<void> => {
  const body = UpdatePollBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const reunionId = req.managedReunion!.id;
  const pollId = Number(req.params.pollId);
  const existing = await getPollWithOptions(reunionId, pollId);
  if (!existing) {
    res.status(404).json({ error: "Poll not found" });
    return;
  }
  const { question, maxVotesPerMember, isOpen, resultsRevealed, liveResults } = body.data;
  await db
    .update(pollsTable)
    .set({
      ...(question === undefined ? {} : { question: question.trim() }),
      ...(maxVotesPerMember === undefined ? {} : { maxVotesPerMember }),
      ...(isOpen === undefined ? {} : { isOpen }),
      ...(resultsRevealed === undefined ? {} : { resultsRevealed }),
      ...(liveResults === undefined ? {} : { liveResults }),
    })
    .where(eq(pollsTable.id, pollId));
  const full = await getPollWithOptions(reunionId, pollId);
  res.json(UpdatePollResponse.parse(full));
});

router.delete("/reunions/:reunionId/polls/:pollId", ...manage, async (req, res): Promise<void> => {
  const reunionId = req.managedReunion!.id;
  const pollId = Number(req.params.pollId);
  const existing = await getPollWithOptions(reunionId, pollId);
  if (!existing) {
    res.status(404).json({ error: "Poll not found" });
    return;
  }
  await db.delete(pollsTable).where(eq(pollsTable.id, pollId));
  res.status(204).end();
});

router.post("/reunions/:reunionId/polls/:pollId/options", ...manage, async (req, res): Promise<void> => {
  const body = AddPollOptionBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const reunionId = req.managedReunion!.id;
  const pollId = Number(req.params.pollId);
  const existing = await getPollWithOptions(reunionId, pollId);
  if (!existing) {
    res.status(404).json({ error: "Poll not found" });
    return;
  }
  const nextPosition = existing.options.length
    ? Math.max(...existing.options.map((o) => o.position)) + 1
    : 0;
  const [created] = await db
    .insert(pollOptionsTable)
    .values({ pollId, label: body.data.label.trim(), position: nextPosition })
    .returning();
  res.status(201).json(AddPollOptionResponse.parse(created));
});

router.delete(
  "/reunions/:reunionId/polls/:pollId/options/:optionId",
  ...manage,
  async (req, res): Promise<void> => {
    const reunionId = req.managedReunion!.id;
    const pollId = Number(req.params.pollId);
    const optionId = Number(req.params.optionId);
    const existing = await getPollWithOptions(reunionId, pollId);
    if (!existing || !existing.options.some((o) => o.id === optionId)) {
      res.status(404).json({ error: "Option not found" });
      return;
    }
    if (existing.options.length <= 2) {
      res.status(400).json({ error: "A poll needs at least two options" });
      return;
    }
    // Votes for the option are removed by FK cascade.
    await db.delete(pollOptionsTable).where(eq(pollOptionsTable.id, optionId));
    res.status(204).end();
  },
);

// ── Member view + voting ──────────────────────────────────────────────────────

function memberResults(
  poll: { resultsRevealed: boolean; liveResults: boolean },
  options: { id: number; label: string }[],
  votes: { optionId: number }[],
) {
  // Members see counts when results are revealed, or streamed live if enabled.
  if (!poll.resultsRevealed && !poll.liveResults) return undefined;
  return options.map((o) => ({
    optionId: o.id,
    label: o.label,
    voteCount: votes.filter((v) => v.optionId === o.id).length,
  }));
}

router.get("/reunions/:reunionId/polls", requireAuth, async (req, res): Promise<void> => {
  const reunionId = Number(req.params.reunionId);
  if (!Number.isInteger(reunionId)) {
    res.status(400).json({ error: "Invalid reunion id" });
    return;
  }
  const userId = (req as any).userId as string;
  const { isMember, checkedIn } = await getMembership(db, reunionId, userId);
  if (!isMember) {
    res.status(403).json({ error: "You are not a member of this reunion" });
    return;
  }
  const eligible = checkedIn;

  // Members see polls that are open OR have revealed results.
  const polls = await db
    .select()
    .from(pollsTable)
    .where(eq(pollsTable.reunionId, reunionId))
    .orderBy(desc(pollsTable.createdAt), desc(pollsTable.id));
  const visible = polls.filter((p) => p.isOpen || p.resultsRevealed);
  const pollIds = visible.map((p) => p.id);

  const options = pollIds.length
    ? await db
        .select()
        .from(pollOptionsTable)
        .where(inArray(pollOptionsTable.pollId, pollIds))
        .orderBy(asc(pollOptionsTable.position), asc(pollOptionsTable.id))
    : [];
  const votes = pollIds.length
    ? await db
        .select({
          pollId: pollVotesTable.pollId,
          optionId: pollVotesTable.optionId,
          userId: pollVotesTable.userId,
        })
        .from(pollVotesTable)
        .where(inArray(pollVotesTable.pollId, pollIds))
    : [];

  const payload = {
    eligible,
    polls: visible.map((poll) => {
      const pollOptions = options.filter((o) => o.pollId === poll.id);
      const pollVotes = votes.filter((v) => v.pollId === poll.id);
      return {
        poll: { ...poll, options: pollOptions },
        myOptionIds: pollVotes.filter((v) => v.userId === userId).map((v) => v.optionId),
        canVote: eligible && poll.isOpen,
        results: memberResults(poll, pollOptions, pollVotes),
      };
    }),
  };
  res.json(ListMemberPollsResponse.parse(payload));
});

router.put(
  "/reunions/:reunionId/polls/:pollId/votes",
  requireAuth,
  async (req, res): Promise<void> => {
    const body = CastPollVotesBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }
    const reunionId = Number(req.params.reunionId);
    const pollId = Number(req.params.pollId);
    if (!Number.isInteger(reunionId) || !Number.isInteger(pollId)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const userId = (req as any).userId as string;

    const optionIds = [...new Set(body.data.optionIds)];

    // All checks + the ballot replacement happen inside one transaction with the
    // poll row locked, so concurrent ballots from the same member — or an
    // organizer closing voting mid-request — cannot race past the validations.
    let failure: { status: number; error: string } | null = null;
    await db.transaction(async (tx) => {
      const [lockedPoll] = await tx
        .select()
        .from(pollsTable)
        .where(and(eq(pollsTable.id, pollId), eq(pollsTable.reunionId, reunionId)))
        .for("update");
      if (!lockedPoll) {
        failure = { status: 404, error: "Poll not found" };
        return;
      }
      if (!lockedPoll.isOpen) {
        failure = { status: 400, error: "Voting is closed for this poll" };
        return;
      }
      const membership = await getMembership(tx, reunionId, userId);
      if (!membership.isMember) {
        failure = { status: 403, error: "You are not a member of this reunion" };
        return;
      }
      if (!membership.checkedIn) {
        failure = { status: 403, error: "Only checked-in family members can vote" };
        return;
      }
      if (optionIds.length > lockedPoll.maxVotesPerMember) {
        failure = {
          status: 400,
          error: `You can vote for at most ${lockedPoll.maxVotesPerMember} option${lockedPoll.maxVotesPerMember === 1 ? "" : "s"}`,
        };
        return;
      }
      const options = await tx
        .select({ id: pollOptionsTable.id })
        .from(pollOptionsTable)
        .where(eq(pollOptionsTable.pollId, pollId));
      const validIds = new Set(options.map((o) => o.id));
      if (!optionIds.every((id) => validIds.has(id))) {
        failure = { status: 400, error: "Unknown poll option" };
        return;
      }

      // Replace the member's ballot (supports changing votes).
      await tx
        .delete(pollVotesTable)
        .where(and(eq(pollVotesTable.pollId, pollId), eq(pollVotesTable.userId, userId)));
      if (optionIds.length) {
        await tx
          .insert(pollVotesTable)
          .values(optionIds.map((optionId) => ({ pollId, optionId, userId })));
      }
    });
    if (failure) {
      const f = failure as { status: number; error: string };
      res.status(f.status).json({ error: f.error });
      return;
    }

    const poll = await getPollWithOptions(reunionId, pollId);
    if (!poll) {
      res.status(404).json({ error: "Poll not found" });
      return;
    }

    const votes = await db
      .select({ optionId: pollVotesTable.optionId, userId: pollVotesTable.userId })
      .from(pollVotesTable)
      .where(eq(pollVotesTable.pollId, pollId));
    const payload = {
      poll,
      myOptionIds: votes.filter((v) => v.userId === userId).map((v) => v.optionId),
      canVote: true,
      results: memberResults(poll, poll.options, votes),
    };
    res.json(CastPollVotesResponse.parse(payload));
  },
);

export default router;
