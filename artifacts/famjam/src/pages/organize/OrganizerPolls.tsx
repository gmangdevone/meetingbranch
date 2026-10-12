import { useState } from "react";
import {
  useListManagePolls,
  getListManagePollsQueryKey,
  getListMemberPollsQueryKey,
  useCreatePoll,
  useUpdatePoll,
  useDeletePoll,
  useAddPollOption,
  useUpdatePollOption,
  useDeletePollOption,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Eye, EyeOff, Lock, LockOpen, Users, X, Radio, Pencil } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "../../components/ui/dialog";
import { OrganizerLayout } from "./OrganizerLayout";
import { PollOptionFields, PollOptionDetails } from "../../components/polls/PollOptionFields";
import {
  type PollOptionDraft,
  type OptionDraftErrors,
  emptyOptionDraft,
  draftFromOption,
  draftToInput,
  validateOptionDraft,
  hasErrors,
} from "../../lib/pollOptions";

export function OrganizerPolls({ params }: { params: { reunionId: string } }) {
  const reunionId = parseInt(params.reunionId, 10);
  const queryClient = useQueryClient();

  const { data: polls, isLoading } = useListManagePolls(reunionId, {
    query: {
      enabled: !isNaN(reunionId),
      queryKey: getListManagePollsQueryKey(reunionId),
      // Live results: refetch every 3s while the page is mounted, but pause
      // when the tab is in the background to avoid wasted requests.
      refetchInterval: 3000,
      refetchIntervalInBackground: false,
    },
  });

  const createPoll = useCreatePoll();
  const updatePoll = useUpdatePoll();
  const deletePoll = useDeletePoll();
  const addOption = useAddPollOption();
  const updateOption = useUpdatePollOption();
  const deleteOption = useDeletePollOption();

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: getListManagePollsQueryKey(reunionId) }),
      queryClient.invalidateQueries({ queryKey: getListMemberPollsQueryKey(reunionId) }),
    ]);

  // Create dialog state
  const [createOpen, setCreateOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [maxVotes, setMaxVotes] = useState(1);
  const [options, setOptions] = useState<PollOptionDraft[]>([emptyOptionDraft(), emptyOptionDraft()]);
  const [optionErrors, setOptionErrors] = useState<OptionDraftErrors[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  // Per-poll "add option" inputs
  const [newOptionByPoll, setNewOptionByPoll] = useState<Record<number, PollOptionDraft>>({});
  const [newOptionErrors, setNewOptionErrors] = useState<Record<number, OptionDraftErrors>>({});
  const [newOptionServerError, setNewOptionServerError] = useState<Record<number, string>>({});
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; question: string } | null>(null);
  const [editTarget, setEditTarget] = useState<{
    id: number;
    question: string;
    maxVotesPerMember: number;
    options: ({ id: number } & PollOptionDraft)[];
  } | null>(null);
  const [editOptionErrors, setEditOptionErrors] = useState<OptionDraftErrors[]>([]);
  const [editError, setEditError] = useState<string | null>(null);

  const resetForm = () => {
    setQuestion("");
    setMaxVotes(1);
    setOptions([emptyOptionDraft(), emptyOptionDraft()]);
    setOptionErrors([]);
    setFormError(null);
  };

  const handleCreate = () => {
    // Blank rows (no label, nothing typed in details) are dropped like before.
    const kept = options.filter((o) => o.label.trim() || (o.detailsEnabled && (o.description.trim() || o.linkUrl.trim())));
    if (!question.trim()) return setFormError("Please enter a question.");
    const errs = options.map((o) => (kept.includes(o) ? validateOptionDraft(o) : {}));
    setOptionErrors(errs);
    if (errs.some(hasErrors)) return setFormError("Fix the highlighted options.");
    if (kept.length < 2) return setFormError("Add at least two options.");
    const cleanOptions = kept.map(draftToInput);
    setFormError(null);
    createPoll.mutate(
      { reunionId, data: { question: question.trim(), maxVotesPerMember: maxVotes, options: cleanOptions } },
      {
        onSuccess: () => {
          invalidate();
          setCreateOpen(false);
          resetForm();
        },
        onError: (e: any) => setFormError(e?.data?.error || "Could not create the poll."),
      },
    );
  };

  const setFlag = (pollId: number, data: { isOpen?: boolean; resultsRevealed?: boolean; liveResults?: boolean }) => {
    updatePoll.mutate({ reunionId, pollId, data }, { onSuccess: invalidate });
  };

  const handleAddOption = (pollId: number) => {
    const draft = newOptionByPoll[pollId] || emptyOptionDraft();
    const errs = validateOptionDraft(draft);
    setNewOptionErrors((s) => ({ ...s, [pollId]: errs }));
    setNewOptionServerError((s) => ({ ...s, [pollId]: "" }));
    if (hasErrors(errs)) return;
    addOption.mutate(
      { reunionId, pollId, data: draftToInput(draft) },
      {
        onSuccess: () => {
          invalidate();
          setNewOptionByPoll((s) => ({ ...s, [pollId]: emptyOptionDraft() }));
        },
        onError: (e: any) => setNewOptionServerError((s) => ({ ...s, [pollId]: e?.data?.error || "Could not add the option." })),
      },
    );
  };

  const handleEdit = async () => {
    if (!editTarget) return;
    const cleanQuestion = editTarget.question.trim();
    if (!cleanQuestion) return setEditError("Please enter a question.");
    const errs = editTarget.options.map(validateOptionDraft);
    setEditOptionErrors(errs);
    if (errs.some(hasErrors)) return setEditError("Fix the highlighted options.");
    const cleanOptions = editTarget.options.map((option) => ({ id: option.id, input: draftToInput(option) }));
    setEditError(null);
    try {
      await updatePoll.mutateAsync({
        reunionId,
        pollId: editTarget.id,
        data: {
          question: cleanQuestion,
          maxVotesPerMember: editTarget.maxVotesPerMember,
        },
      });
      await Promise.all(
        cleanOptions.map((option) =>
          updateOption.mutateAsync({
            reunionId,
            pollId: editTarget.id,
            optionId: option.id,
            data: option.input,
          }),
        ),
      );
      await invalidate();
      setEditTarget(null);
    } catch (error: any) {
      setEditError(error?.data?.error || "Could not update the poll.");
    }
  };

  return (
    <OrganizerLayout reunionId={reunionId}>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="font-serif text-3xl font-bold">Polls</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Put decisions to the family. Only checked-in members can vote.
            </p>
          </div>
          <Button onClick={() => setCreateOpen(true)} className="rounded-full shadow-lg hover:-translate-y-0.5 transition-transform">
            <Plus className="w-4 h-4 mr-2" /> New Poll
          </Button>
        </div>

        {isLoading ? (
          <div className="bg-card border shadow-sm rounded-3xl p-10 text-center text-muted-foreground">Loading polls…</div>
        ) : !polls?.length ? (
          <div className="bg-card border shadow-sm rounded-3xl p-10 text-center">
            <h3 className="font-bold text-lg mb-2">No polls yet</h3>
            <p className="text-muted-foreground">Create your first poll to let the family weigh in on a decision.</p>
          </div>
        ) : (
          polls.map(({ poll, totalVoters, results }) => {
            const totalVotes = results.reduce((sum, r) => sum + r.voteCount, 0);
            return (
              <div key={poll.id} className="bg-card border shadow-sm rounded-3xl p-6 flex flex-col gap-4">
                <div className="flex flex-col sm:flex-row justify-between gap-3">
                  <div>
                    <h2 className="font-serif text-xl font-bold">{poll.question}</h2>
                    <div className="flex flex-wrap items-center gap-2 mt-2 text-xs">
                      <span className={`px-2 py-1 rounded-md font-bold uppercase tracking-wider ${poll.isOpen ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300"}`}>
                        {poll.isOpen ? "Voting open" : "Voting closed"}
                      </span>
                      <span className={`px-2 py-1 rounded-md font-bold uppercase tracking-wider ${poll.resultsRevealed ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                        {poll.resultsRevealed ? "Results visible to family" : "Results hidden"}
                      </span>
                      {poll.liveResults && (
                        <span className="px-2 py-1 rounded-md font-bold uppercase tracking-wider bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400 flex items-center gap-1">
                          <Radio className="w-3 h-3" /> Live
                        </span>
                      )}
                      <span className="text-muted-foreground flex items-center gap-1">
                        <Users className="w-3 h-3" /> {totalVoters} voted · up to {poll.maxVotesPerMember} pick{poll.maxVotesPerMember === 1 ? "" : "s"} each
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-lg text-xs"
                      onClick={() => {
                        setEditError(null);
                        setEditOptionErrors([]);
                        setEditTarget({
                          id: poll.id,
                          question: poll.question,
                          maxVotesPerMember: poll.maxVotesPerMember,
                          options: poll.options.map((option) => ({ id: option.id, ...draftFromOption(option) })),
                        });
                      }}
                    >
                      <Pencil className="w-3 h-3 mr-1" /> Edit
                    </Button>
                    <Button variant="outline" size="sm" className="rounded-lg text-xs" onClick={() => setFlag(poll.id, { isOpen: !poll.isOpen })}>
                      {poll.isOpen ? <Lock className="w-3 h-3 mr-1" /> : <LockOpen className="w-3 h-3 mr-1" />}
                      {poll.isOpen ? "Close voting" : "Reopen voting"}
                    </Button>
                    <Button variant="outline" size="sm" className="rounded-lg text-xs" onClick={() => setFlag(poll.id, { resultsRevealed: !poll.resultsRevealed })}>
                      {poll.resultsRevealed ? <EyeOff className="w-3 h-3 mr-1" /> : <Eye className="w-3 h-3 mr-1" />}
                      {poll.resultsRevealed ? "Hide results" : "Reveal results"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className={`rounded-lg text-xs ${poll.liveResults ? "border-red-300 text-red-600 hover:text-red-700 dark:border-red-800 dark:text-red-400" : ""}`}
                      onClick={() => setFlag(poll.id, { liveResults: !poll.liveResults })}
                    >
                      <Radio className="w-3 h-3 mr-1" />
                      {poll.liveResults ? "Stop live results" : "Go live to family"}
                    </Button>
                    <Button variant="outline" size="sm" className="rounded-lg text-xs text-destructive border-transparent hover:border-destructive/30 hover:bg-destructive/10 hover:text-destructive" onClick={() => setDeleteTarget({ id: poll.id, question: poll.question })}>
                      <Trash2 className="w-3 h-3 mr-1" /> Delete
                    </Button>
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  {results.map((r) => {
                    const optionInfo = poll.options.find((o) => o.id === r.optionId);
                    const pct = totalVotes ? Math.round((r.voteCount / totalVotes) * 100) : 0;
                    return (
                      <div key={r.optionId} className="border rounded-xl p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="font-medium min-w-0 break-words">{r.label}</div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-sm font-bold">{r.voteCount}</span>
                            <span className="text-xs text-muted-foreground w-10 text-right">{pct}%</span>
                            {poll.options.length > 2 && (
                              <button
                                title="Remove option"
                                aria-label={`Remove option ${r.label}`}
                                className="text-muted-foreground hover:text-destructive transition-colors"
                                onClick={() =>
                                  deleteOption.mutate({ reunionId, pollId: poll.id, optionId: r.optionId }, { onSuccess: invalidate })
                                }
                              >
                                <X className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>
                        {optionInfo && <PollOptionDetails option={optionInfo} className="mt-1" />}
                        <div className="h-2 bg-muted rounded-full mt-2 overflow-hidden">
                          <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${pct}%` }} />
                        </div>
                        {(r.voters?.length ?? 0) > 0 && (
                          <div className="text-xs text-muted-foreground mt-2 truncate" title={r.voters!.join(", ")}>
                            {r.voters!.join(", ")}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="flex flex-col gap-2">
                  <PollOptionFields
                    labelText="Add another option"
                    placeholder="Add another option…"
                    value={newOptionByPoll[poll.id] || emptyOptionDraft()}
                    errors={newOptionErrors[poll.id]}
                    onChange={(next) => setNewOptionByPoll((s) => ({ ...s, [poll.id]: next }))}
                    onLabelEnter={() => handleAddOption(poll.id)}
                    trailing={
                      <Button variant="outline" className="rounded-xl shrink-0" onClick={() => handleAddOption(poll.id)} disabled={addOption.isPending || !(newOptionByPoll[poll.id]?.label || "").trim()}>
                        <Plus className="w-4 h-4 mr-1" /> Add
                      </Button>
                    }
                  />
                  {newOptionServerError[poll.id] && <div className="p-3 bg-destructive/10 text-destructive text-sm font-medium rounded-xl">{newOptionServerError[poll.id]}</div>}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Create poll dialog */}
      <Dialog open={createOpen} onOpenChange={(open) => { setCreateOpen(open); if (!open) resetForm(); }}>
        <DialogContent className="rounded-3xl p-6 sm:p-8 max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl">New Poll</DialogTitle>
            <DialogDescription>
              Ask the family a question. Voting opens immediately; results stay hidden until you reveal them.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 mt-2">
            <div>
              <Label className="mb-2 block">Question</Label>
              <Input className="rounded-xl" placeholder="e.g. Where should we host next year's reunion?" value={question} onChange={(e) => setQuestion(e.target.value)} />
            </div>
            <div>
              <Label className="mb-2 block">Votes allowed per member</Label>
              <Input type="number" min={1} max={20} className="rounded-xl w-28" value={maxVotes} onChange={(e) => setMaxVotes(Math.max(1, Math.min(20, parseInt(e.target.value, 10) || 1)))} />
            </div>
            <div>
              <Label className="mb-2 block">Options</Label>
              <div className="flex flex-col gap-2">
                {options.map((opt, i) => (
                  <PollOptionFields
                    key={i}
                    labelText={`Option ${i + 1}`}
                    value={opt}
                    errors={optionErrors[i]}
                    onChange={(next) => setOptions((s) => s.map((o, j) => (j === i ? next : o)))}
                    trailing={options.length > 2 ? (
                      <Button variant="ghost" size="icon" aria-label={`Remove option ${i + 1}`} className="shrink-0 text-muted-foreground hover:text-destructive" onClick={() => { setOptions((s) => s.filter((_, j) => j !== i)); setOptionErrors((s) => s.filter((_, j) => j !== i)); }}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    ) : undefined}
                  />
                ))}
                <Button variant="outline" className="rounded-xl border-dashed" onClick={() => setOptions((s) => [...s, emptyOptionDraft()])}>
                  <Plus className="w-4 h-4 mr-1" /> Add Option
                </Button>
              </div>
            </div>
            {formError && <div className="p-3 bg-destructive/10 text-destructive text-sm font-medium rounded-xl">{formError}</div>}
            <div className="flex justify-end gap-3 pt-2 border-t">
              <Button variant="ghost" className="rounded-xl" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button className="rounded-xl" onClick={handleCreate} disabled={createPoll.isPending}>
                {createPoll.isPending ? "Creating…" : "Create Poll"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editTarget} onOpenChange={(open) => !open && setEditTarget(null)}>
        <DialogContent className="rounded-3xl p-6 sm:p-8 max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl">Edit Poll</DialogTitle>
            <DialogDescription>Update the question, vote limit, option names, descriptions, or links. Existing votes remain attached to their options.</DialogDescription>
          </DialogHeader>
          {editTarget && (
            <div className="flex flex-col gap-4 mt-2">
              <div>
                <Label className="mb-2 block">Question</Label>
                <Input className="rounded-xl" value={editTarget.question} onChange={(event) => setEditTarget({ ...editTarget, question: event.target.value })} />
              </div>
              <div>
                <Label className="mb-2 block">Votes allowed per member</Label>
                <Input type="number" min={1} max={20} className="rounded-xl w-28" value={editTarget.maxVotesPerMember} onChange={(event) => setEditTarget({ ...editTarget, maxVotesPerMember: Math.max(1, Math.min(20, parseInt(event.target.value, 10) || 1)) })} />
              </div>
              <div>
                <Label className="mb-2 block">Options</Label>
                <div className="flex flex-col gap-2">
                  {editTarget.options.map((option, index) => (
                    <PollOptionFields
                      key={option.id}
                      labelText={`Option ${index + 1}`}
                      value={option}
                      errors={editOptionErrors[index]}
                      onChange={(next) => setEditTarget({
                        ...editTarget,
                        options: editTarget.options.map((item, itemIndex) => itemIndex === index ? { ...item, ...next } : item),
                      })}
                    />
                  ))}
                </div>
              </div>
              {editError && <div className="p-3 bg-destructive/10 text-destructive text-sm font-medium rounded-xl">{editError}</div>}
              <div className="flex justify-end gap-3 pt-2 border-t">
                <Button variant="ghost" className="rounded-xl" onClick={() => setEditTarget(null)}>Cancel</Button>
                <Button className="rounded-xl" onClick={handleEdit} disabled={updatePoll.isPending || updateOption.isPending}>
                  {updatePoll.isPending || updateOption.isPending ? "Saving…" : "Save Changes"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete poll dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="rounded-3xl p-6 sm:p-8 max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl text-destructive">Delete this poll?</DialogTitle>
            <DialogDescription>
              "{deleteTarget?.question}" and all of its votes will be permanently removed.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-3 pt-4">
            <Button variant="ghost" className="rounded-xl" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button
              variant="destructive"
              className="rounded-xl"
              disabled={deletePoll.isPending}
              onClick={() =>
                deleteTarget &&
                deletePoll.mutate({ reunionId, pollId: deleteTarget.id }, { onSuccess: () => { invalidate(); setDeleteTarget(null); } })
              }
            >
              {deletePoll.isPending ? "Deleting…" : "Delete Poll"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </OrganizerLayout>
  );
}
