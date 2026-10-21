import { useEffect } from "react";
import { useAuth } from "@clerk/react";
import { Link, Redirect, useLocation } from "wouter";
import { useListMyEventMemberships, getListMyEventMembershipsQueryKey } from "@workspace/api-client-react";
import { eventCodePath } from "../lib/eventCode";
import { resolveLanding } from "../lib/landing";
import { Skeleton } from "./ui/skeleton";
import { Button } from "./ui/button";
import { OrganizerEventChooser } from "./OrganizerEventChooser";
import { readOrganizerChoice, saveOrganizerChoice, clearOrganizerChoice } from "../lib/organizerSession";

/**
 * Signed-in "/" resolver. Waits for a fresh, successful membership response
 * before deciding, so partial or cached data from another session never picks
 * the destination. The dashboard itself never redirects, so it stays reachable.
 */
export function PostLoginLanding({ chooseEvent = false }: { chooseEvent?: boolean }) {
  const { userId, sessionId, isLoaded } = useAuth();
  const [, navigate] = useLocation();
  const q = useListMyEventMemberships({
    query: { queryKey: [...getListMyEventMembershipsQueryKey(), userId, sessionId], enabled: !!userId && !!sessionId,
      refetchOnMount: "always", refetchInterval: 60000, retry: 1 },
  });
  const saved = userId && sessionId ? readOrganizerChoice(userId, sessionId) : null;
  useEffect(() => {
    if (q.isSuccess && q.isFetchedAfterMount && !q.isFetching && saved !== null &&
      !q.data.some(m => m.reunionId === saved && m.canViewReports && (m.isOrganizer || m.isCoOrganizer))) {
      clearOrganizerChoice();
    }
  }, [q.isSuccess, q.isFetchedAfterMount, q.isFetching, q.data, saved]);

  if (q.isError && !q.isFetching) {
    return (
      <div className="max-w-md mx-auto py-16 px-4 text-center flex flex-col items-center gap-4" role="alert">
        <h1 className="font-serif text-3xl font-bold">We couldn't load your reunions</h1>
        <p className="text-muted-foreground">Check your connection and try again, or open your dashboard.</p>
        <div className="flex gap-3">
          <Button className="rounded-full font-bold" onClick={() => q.refetch()}>Try again</Button>
          <Link href="/dashboard" className="inline-flex items-center rounded-full border px-4 font-bold hover:bg-muted transition-colors">
            My dashboard
          </Link>
        </div>
      </div>
    );
  }

  if (!isLoaded || !userId || !sessionId || !q.isSuccess || !q.isFetchedAfterMount || q.isFetching) {
    return (
      <div className="max-w-xl mx-auto py-16 px-4 flex flex-col gap-4" aria-busy="true" aria-label="Finding your reunions">
        <Skeleton className="h-8 w-48 rounded-full" />
        <Skeleton className="h-28 rounded-3xl" />
        <Skeleton className="h-28 rounded-3xl" />
      </div>
    );
  }

  const landing = resolveLanding(q.data, chooseEvent ? null : saved);
  if (landing.kind === "reports") return <Redirect to={`/organize/${landing.reunionId}/reports`} replace />;
  if (landing.kind === "choose") return <OrganizerEventChooser events={landing.events} onSelect={id => {
    if (!landing.events.some(m => m.reunionId === id)) return;
    saveOrganizerChoice(userId, sessionId, id);
    navigate(`/organize/${id}/reports`);
  }} />;
  if (landing.kind === "hub") return <Redirect to={eventCodePath(landing.code)} replace />;
  return <Redirect to="/dashboard" replace />;
}
