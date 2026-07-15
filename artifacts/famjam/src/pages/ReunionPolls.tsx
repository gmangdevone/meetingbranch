import { Link } from "wouter";
import {
  useGetReunionByCode,
  getGetReunionByCodeQueryKey,
  useListMemberPolls,
  getListMemberPollsQueryKey,
  useCastPollVotes,
} from "@workspace/api-client-react";
import { useAuth } from "@clerk/react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Vote, ArrowLeft, CheckCircle2, Info } from "lucide-react";
import { Skeleton } from "../components/ui/skeleton";
import { Button } from "../components/ui/button";

export function ReunionPolls({ params }: { params: { code: string } }) {
  const code = params.code.toUpperCase();
  const { isSignedIn } = useAuth();
  const queryClient = useQueryClient();

  const { data: reunion, isLoading: loadingReunion, isError } = useGetReunionByCode(code, {
    query: { queryKey: getGetReunionByCodeQueryKey(code) },
  });

  const reunionId = reunion?.id;
  const { data, isLoading: loadingPolls } = useListMemberPolls(reunionId ?? 0, {
    query: {
      enabled: !!reunionId && !!isSignedIn,
      queryKey: getListMemberPollsQueryKey(reunionId ?? 0),
    },
  });

  const castVotes = useCastPollVotes();
  const [voteError, setVoteError] = useState<Record<number, string>>({});

  if (loadingReunion || (isSignedIn && loadingPolls)) {
    return (
      <div className="max-w-3xl mx-auto flex flex-col gap-6 py-8">
        <Skeleton className="h-24 rounded-3xl" />
        <Skeleton className="h-64 rounded-3xl" />
      </div>
    );
  }

  if (isError || !reunion) {
    return (
      <div className="text-center py-20">
        <h1 className="text-2xl font-bold mb-4">Reunion not found</h1>
        <Link href="/join" className="text-primary font-bold hover:underline">Try another code</Link>
      </div>
    );
  }

  const toggleVote = (pollId: number, myOptionIds: number[], optionId: number, maxVotes: number) => {
    const selected = new Set(myOptionIds);
    if (selected.has(optionId)) {
      selected.delete(optionId);
    } else {
      if (maxVotes === 1) selected.clear();
      else if (selected.size >= maxVotes) {
        setVoteError((s) => ({ ...s, [pollId]: `You can pick at most ${maxVotes} option${maxVotes === 1 ? "" : "s"}.` }));
        return;
      }
      selected.add(optionId);
    }
    setVoteError((s) => ({ ...s, [pollId]: "" }));
    castVotes.mutate(
      { reunionId: reunion.id, pollId, data: { optionIds: [...selected] } },
      {
        onSuccess: () => queryClient.invalidateQueries({ queryKey: getListMemberPollsQueryKey(reunion.id) }),
        onError: (e: any) => setVoteError((s) => ({ ...s, [pollId]: e?.data?.error || "Could not save your vote." })),
      },
    );
  };

  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-8 py-8 pb-16">
      <div>
        <Link href={`/r/${reunion.code}`} className="flex items-center text-sm font-medium text-muted-foreground hover:text-foreground transition-colors mb-4">
          <ArrowLeft className="w-4 h-4 mr-1" /> Back to {reunion.name}
        </Link>
        <h1 className="font-serif text-4xl font-bold flex items-center gap-3">
          <Vote className="w-8 h-8 text-primary" /> Family Vote
        </h1>
        <p className="text-muted-foreground mt-2">Help the family decide — every checked-in member gets a say.</p>
      </div>

      {!isSignedIn ? (
        <div className="bg-card border shadow-sm rounded-3xl p-10 text-center">
          <h3 className="font-bold text-lg mb-2">Sign in to vote</h3>
          <p className="text-muted-foreground mb-4">You need to be signed in to see and vote on family polls.</p>
          <Link href="/sign-in" className="text-primary font-bold hover:underline">Sign In</Link>
        </div>
      ) : (
        <>
          {data && !data.eligible && (
            <div className="flex items-start gap-3 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-900/30 rounded-2xl p-4 text-sm">
              <Info className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <div className="font-bold">Voting opens once you're checked in</div>
                <div className="text-muted-foreground">
                  An organizer checks your household in at the reunion. Until then you can view polls but not vote.
                </div>
              </div>
            </div>
          )}

          {!data?.polls.length ? (
            <div className="bg-card border shadow-sm rounded-3xl p-10 text-center">
              <h3 className="font-bold text-lg mb-2">No polls right now</h3>
              <p className="text-muted-foreground">When organizers put a question to the family, it will show up here.</p>
            </div>
          ) : (
            data.polls.map(({ poll, myOptionIds, canVote, results }) => {
              const totalVotes = results?.reduce((sum, r) => sum + r.voteCount, 0) ?? 0;
              return (
                <div key={poll.id} className="bg-card border shadow-sm rounded-3xl p-6 sm:p-8 flex flex-col gap-4">
                  <div>
                    <h2 className="font-serif text-2xl font-bold">{poll.question}</h2>
                    <div className="text-xs text-muted-foreground mt-1">
                      {poll.isOpen
                        ? `Pick up to ${poll.maxVotesPerMember} option${poll.maxVotesPerMember === 1 ? "" : "s"}. You can change your mind until voting closes.`
                        : "Voting has closed."}
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    {poll.options.map((opt) => {
                      const isMine = myOptionIds.includes(opt.id);
                      const result = results?.find((r) => r.optionId === opt.id);
                      const pct = result && totalVotes ? Math.round((result.voteCount / totalVotes) * 100) : 0;
                      return (
                        <button
                          key={opt.id}
                          disabled={!canVote || castVotes.isPending}
                          onClick={() => toggleVote(poll.id, myOptionIds, opt.id, poll.maxVotesPerMember)}
                          className={`text-left border rounded-xl p-4 transition-all ${
                            isMine ? "border-primary bg-primary/5 ring-1 ring-primary/40" : "hover:border-primary/40"
                          } ${!canVote ? "cursor-default" : "cursor-pointer"}`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="font-medium flex items-center gap-2">
                              {isMine && <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />}
                              {opt.label}
                            </div>
                            {result && (
                              <div className="text-sm shrink-0">
                                <span className="font-bold">{result.voteCount}</span>
                                <span className="text-muted-foreground text-xs ml-1">({pct}%)</span>
                              </div>
                            )}
                          </div>
                          {result && (
                            <div className="h-2 bg-muted rounded-full mt-3 overflow-hidden">
                              <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${pct}%` }} />
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {voteError[poll.id] && (
                    <div className="p-3 bg-destructive/10 text-destructive text-sm font-medium rounded-xl">{voteError[poll.id]}</div>
                  )}
                  {myOptionIds.length > 0 && poll.isOpen && (
                    <div className="text-xs text-muted-foreground">
                      Your vote is in — tap a selected option to remove it, or pick another.
                    </div>
                  )}
                  {!results && (
                    <div className="text-xs text-muted-foreground italic">Results will appear here once the organizers reveal them.</div>
                  )}
                </div>
              );
            })
          )}
        </>
      )}
    </div>
  );
}
