import { useState } from "react";
import { useAuth } from "@clerk/react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, ClipboardList, Info } from "lucide-react";
import { Link } from "wouter";
import {
  getGetReunionByCodeQueryKey,
  getListMemberActivityChoicesQueryKey,
  useGetReunionByCode,
  useListMemberActivityChoices,
  useSetActivityChoiceSelections,
} from "@workspace/api-client-react";
import { Skeleton } from "../components/ui/skeleton";
import { eventCodePath } from "../lib/eventCode";

export function ReunionActivities({ params }: { params: { code: string } }) {
  const code = params.code.toUpperCase();
  const { isSignedIn } = useAuth();
  const queryClient = useQueryClient();
  const [selectionError, setSelectionError] = useState<Record<number, string>>({});
  const { data: reunion, isLoading: loadingReunion, isError } = useGetReunionByCode(code, {
    query: { queryKey: getGetReunionByCodeQueryKey(code) },
  });
  const reunionId = reunion?.id ?? 0;
  const { data, isLoading: loadingGroups } = useListMemberActivityChoices(reunionId, {
    query: {
      enabled: Boolean(reunion?.id && isSignedIn),
      queryKey: getListMemberActivityChoicesQueryKey(reunionId),
      refetchInterval: (query) =>
        query.state.data?.groups.some(({ group }) => group.liveResults) ? 3000 : false,
      refetchIntervalInBackground: false,
    },
  });
  const setSelections = useSetActivityChoiceSelections();

  if (loadingReunion || (isSignedIn && loadingGroups)) {
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

  const toggleSelection = (
    groupId: number,
    selectedIds: number[],
    optionId: number,
    limit: number,
  ) => {
    const next = new Set(selectedIds);
    if (next.has(optionId)) {
      next.delete(optionId);
    } else {
      if (limit === 1) next.clear();
      else if (next.size >= limit) {
        setSelectionError((current) => ({
          ...current,
          [groupId]: `You can pick at most ${limit} options.`,
        }));
        return;
      }
      next.add(optionId);
    }
    setSelectionError((current) => ({ ...current, [groupId]: "" }));
    setSelections.mutate(
      { reunionId: reunion.id, activityChoiceGroupId: groupId, data: { optionIds: [...next] } },
      {
        onSuccess: () =>
          queryClient.invalidateQueries({
            queryKey: getListMemberActivityChoicesQueryKey(reunion.id),
          }),
        onError: (error: any) =>
          setSelectionError((current) => ({
            ...current,
            [groupId]: error?.data?.error || "Could not save your choices.",
          })),
      },
    );
  };

  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-8 py-8 pb-16">
      <div>
        <Link href={eventCodePath(reunion.code)} className="flex items-center text-sm font-medium text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="w-4 h-4 mr-1" /> Back to {reunion.name}
        </Link>
        <h1 className="font-serif text-4xl font-bold flex items-center gap-3">
          <ClipboardList className="w-8 h-8 text-primary" /> Activities &amp; Choices
        </h1>
        <p className="text-muted-foreground mt-2">Choose the activities and options that work best for your household.</p>
      </div>

      {!isSignedIn ? (
        <div className="bg-card border shadow-sm rounded-3xl p-10 text-center">
          <h3 className="font-bold text-lg mb-2">Sign in to view choices</h3>
          <p className="text-muted-foreground mb-4">Sign in to see the available activities and choices.</p>
          <Link href="/sign-in" className="text-primary font-bold hover:underline">Sign In</Link>
        </div>
      ) : (
        <>
          {data && !data.eligible && (
            <div className="flex items-start gap-3 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-900/30 rounded-2xl p-4 text-sm">
              <Info className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <div className="font-bold">Registration required to make choices</div>
                <div className="text-muted-foreground">
                  You can view these options, but you need an active registration for this reunion to select them.
                </div>
              </div>
            </div>
          )}
          {!data?.groups.length ? (
            <div className="bg-card border shadow-sm rounded-3xl p-10 text-center">
              <h3 className="font-bold text-lg mb-2">No activities or choices right now</h3>
              <p className="text-muted-foreground">Organizer choices will appear here when they are available.</p>
            </div>
          ) : (
            data.groups.map(({ group, myOptionIds, canSelect, results }) => {
              const total = results?.reduce((sum, result) => sum + result.selectionCount, 0) ?? 0;
              return (
                <div key={group.id} className="bg-card border shadow-sm rounded-3xl p-6 sm:p-8 flex flex-col gap-4">
                  <div>
                    <h2 className="font-serif text-2xl font-bold">{group.title}</h2>
                    {group.description && <p className="text-muted-foreground mt-2">{group.description}</p>}
                    <p className="text-xs text-muted-foreground mt-2">
                      {group.isOpen
                        ? `Pick up to ${group.maxSelectionsPerRegistrant} option${group.maxSelectionsPerRegistrant === 1 ? "" : "s"}. You can change your choices until selections close.`
                        : "Selections have closed."}
                    </p>
                  </div>
                  <div className="flex flex-col gap-2">
                    {group.options.map((option) => {
                      const selected = myOptionIds.includes(option.id);
                      const result = results?.find((item) => item.optionId === option.id);
                      const percent = result && total
                        ? Math.round((result.selectionCount / total) * 100)
                        : 0;
                      return (
                        <button
                          key={option.id}
                          disabled={!canSelect || setSelections.isPending}
                          onClick={() => toggleSelection(group.id, myOptionIds, option.id, group.maxSelectionsPerRegistrant)}
                          className={`text-left border rounded-xl p-4 transition-all ${selected ? "border-primary bg-primary/5 ring-1 ring-primary/40" : "hover:border-primary/40"} ${canSelect ? "cursor-pointer" : "cursor-default"}`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span className="font-medium flex items-center gap-2">
                              {selected && <CheckCircle2 className="w-4 h-4 text-primary" />}
                              {option.label}
                            </span>
                            {result && <span className="font-bold text-sm">{result.selectionCount} <span className="font-normal text-xs text-muted-foreground">({percent}%)</span></span>}
                          </div>
                          {result && (
                            <div className="h-2 bg-muted rounded-full mt-3 overflow-hidden">
                              <div className="h-full bg-primary rounded-full" style={{ width: `${percent}%` }} />
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  {selectionError[group.id] && (
                    <div className="p-3 bg-destructive/10 text-destructive text-sm font-medium rounded-xl">
                      {selectionError[group.id]}
                    </div>
                  )}
                  {!results && <p className="text-xs text-muted-foreground italic">Results will appear when organizers make them visible.</p>}
                </div>
              );
            })
          )}
        </>
      )}
    </div>
  );
}