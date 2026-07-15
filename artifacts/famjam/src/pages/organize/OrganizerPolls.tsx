import { useState } from "react";
import {
  useListManagePolls,
  getListManagePollsQueryKey,
  useCreatePoll,
  useUpdatePoll,
  useDeletePoll,
  useAddPollOption,
  useDeletePollOption,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Eye, EyeOff, Lock, LockOpen, Users, X } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "../../components/ui/dialog";
import { OrganizerLayout } from "./OrganizerLayout";

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
  const deleteOption = useDeletePollOption();

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListManagePollsQueryKey(reunionId) });

  // Create dialog state
  const [createOpen, setCreateOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [maxVotes, setMaxVotes] = useState(1);
  const [options, setOptions] = useState<string[]>(["", ""]);
  const [formError, setFormError] = useState<string | null>(null);

  // Per-poll "add option" inputs
  const [newOptionByPoll, setNewOptionByPoll] = useState<Record<number, string>>({});
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; question: string } | null>(null);

  const resetForm = () => {
    setQuestion("");
    setMaxVotes(1);
    setOptions(["", ""]);
    setFormError(null);
  };

  const handleCreate = () => {
    const cleanOptions = options.map((o) => o.trim()).filter(Boolean);
    if (!question.trim()) return setFormError("Please enter a question.");
    if (cleanOptions.length < 2) return setFormError("Add at least two options.");
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

  const setFlag = (pollId: number, data: { isOpen?: boolean; resultsRevealed?: boolean }) => {
    updatePoll.mutate({ reunionId, pollId, data }, { onSuccess: invalidate });
  };

  const handleAddOption = (pollId: number) => {
    const label = (newOptionByPoll[pollId] || "").trim();
    if (!label) return;
    addOption.mutate(
      { reunionId, pollId, data: { label } },
      {
        onSuccess: () => {
          invalidate();
          setNewOptionByPoll((s) => ({ ...s, [pollId]: "" }));
        },
      },
    );
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
                      <span className="text-muted-foreground flex items-center gap-1">
                        <Users className="w-3 h-3" /> {totalVoters} voted · up to {poll.maxVotesPerMember} pick{poll.maxVotesPerMember === 1 ? "" : "s"} each
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 shrink-0">
                    <Button variant="outline" size="sm" className="rounded-lg text-xs" onClick={() => setFlag(poll.id, { isOpen: !poll.isOpen })}>
                      {poll.isOpen ? <Lock className="w-3 h-3 mr-1" /> : <LockOpen className="w-3 h-3 mr-1" />}
                      {poll.isOpen ? "Close voting" : "Reopen voting"}
                    </Button>
                    <Button variant="outline" size="sm" className="rounded-lg text-xs" onClick={() => setFlag(poll.id, { resultsRevealed: !poll.resultsRevealed })}>
                      {poll.resultsRevealed ? <EyeOff className="w-3 h-3 mr-1" /> : <Eye className="w-3 h-3 mr-1" />}
                      {poll.resultsRevealed ? "Hide results" : "Reveal results"}
                    </Button>
                    <Button variant="outline" size="sm" className="rounded-lg text-xs text-destructive border-transparent hover:border-destructive/30 hover:bg-destructive/10 hover:text-destructive" onClick={() => setDeleteTarget({ id: poll.id, question: poll.question })}>
                      <Trash2 className="w-3 h-3 mr-1" /> Delete
                    </Button>
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  {results.map((r) => {
                    const pct = totalVotes ? Math.round((r.voteCount / totalVotes) * 100) : 0;
                    return (
                      <div key={r.optionId} className="border rounded-xl p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="font-medium">{r.label}</div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-sm font-bold">{r.voteCount}</span>
                            <span className="text-xs text-muted-foreground w-10 text-right">{pct}%</span>
                            {poll.options.length > 2 && (
                              <button
                                title="Remove option"
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

                <div className="flex gap-2">
                  <Input
                    placeholder="Add another option…"
                    className="rounded-xl"
                    value={newOptionByPoll[poll.id] || ""}
                    onChange={(e) => setNewOptionByPoll((s) => ({ ...s, [poll.id]: e.target.value }))}
                    onKeyDown={(e) => e.key === "Enter" && handleAddOption(poll.id)}
                  />
                  <Button variant="outline" className="rounded-xl shrink-0" onClick={() => handleAddOption(poll.id)} disabled={addOption.isPending || !(newOptionByPoll[poll.id] || "").trim()}>
                    <Plus className="w-4 h-4 mr-1" /> Add
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Create poll dialog */}
      <Dialog open={createOpen} onOpenChange={(open) => { setCreateOpen(open); if (!open) resetForm(); }}>
        <DialogContent className="rounded-3xl p-6 sm:p-8 max-w-lg max-h-[90vh] overflow-y-auto">
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
                  <div key={i} className="flex gap-2">
                    <Input className="rounded-xl" placeholder={`Option ${i + 1}`} value={opt} onChange={(e) => setOptions((s) => s.map((o, j) => (j === i ? e.target.value : o)))} />
                    {options.length > 2 && (
                      <Button variant="ghost" size="icon" className="shrink-0 text-muted-foreground hover:text-destructive" onClick={() => setOptions((s) => s.filter((_, j) => j !== i))}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                ))}
                <Button variant="outline" className="rounded-xl border-dashed" onClick={() => setOptions((s) => [...s, ""])}>
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
