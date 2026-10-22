import { useAuth } from "@clerk/react";
import { Link, Redirect, useLocation } from "wouter";
import { useGetReunion, getGetReunionQueryKey, useListMyEventMemberships, getListMyEventMembershipsQueryKey, useGetReunionByCode, getGetReunionByCodeQueryKey } from "@workspace/api-client-react";
import { eventCodePath } from "../lib/eventCode";
import { uniqueMemberships } from "../lib/landing";
import { OrganizerEventChooser } from "./OrganizerEventChooser";
import { Button } from "./ui/button";
import { useLastReunionCode } from "../lib/lastReunion";

function LoadingHome() {
  return <p role="status" className="px-4 py-12 text-center">Finding your event home…</p>;
}

function HomeError({ retry }: { retry: () => void }) {
  return (
    <section role="alert" className="max-w-xl mx-auto px-4 py-12 text-center space-y-4">
      <h1 className="font-serif text-3xl font-bold">We couldn't open your event home</h1>
      <p>The event may be unavailable, or your connection may have been interrupted.</p>
      <Button onClick={retry}>Try again</Button>
      <div><Link href="/home" className="font-bold underline">Choose an event</Link> · <Link href="/dashboard" className="font-bold underline">My dashboard</Link></div>
    </section>
  );
}

/** Resolve the current organizer event using the API, never browser history. */
export function CurrentEventHome({ params }: { params: { reunionId: string } }) {
  const { userId, sessionId } = useAuth();
  const id = Number(params.reunionId);
  const valid = Number.isSafeInteger(id) && id > 0;
  const q = useGetReunion(id, { query: {
    queryKey: [...getGetReunionQueryKey(id), userId, sessionId],
    enabled: valid && !!userId, retry: false, refetchOnMount: "always",
  } });
  if (!valid || q.isError) return <HomeError retry={() => { if (valid) void q.refetch(); }} />;
  if (!q.isSuccess || !q.isFetchedAfterMount || q.isFetching) return <LoadingHome />;
  if (!q.data.reunion.code) return <HomeError retry={() => void q.refetch()} />;
  return <Redirect to={eventCodePath(q.data.reunion.code)} replace />;
}

/** Manual Home selection must never use the Reports sign-in resolver. */
export function EventHomeLanding() {
  const { userId, sessionId } = useAuth();
  const [, navigate] = useLocation();
  const lastCode = useLastReunionCode();
  const recent = useGetReunionByCode(lastCode ?? "", { query: {
    queryKey: [...getGetReunionByCodeQueryKey(lastCode ?? ""), userId, sessionId],
    enabled: !!lastCode && !!userId && !!sessionId, retry: false, refetchOnMount: "always",
  } });
  const q = useListMyEventMemberships({ query: {
    queryKey: [...getListMyEventMembershipsQueryKey(), userId, sessionId],
    enabled: !!userId && !!sessionId, retry: false, refetchOnMount: "always",
  } });
  if (q.isError) return <HomeError retry={() => void q.refetch()} />;
  if (!q.isSuccess || !q.isFetchedAfterMount || q.isFetching) return <LoadingHome />;
  if (lastCode && !recent.isError && (!recent.isSuccess || !recent.isFetchedAfterMount || recent.isFetching)) return <LoadingHome />;
  const events = uniqueMemberships(q.data);
  // Invited visitors may not have registered yet, so membership alone is insufficient.
  // Revalidate the remembered code, and offer it alongside memberships rather than
  // choosing it over an ambiguous account event.
  if (lastCode && recent.isSuccess && !recent.isError && recent.data &&
      !events.some(e => e.reunionId === recent.data.id)) {
    events.push({
      reunionId: recent.data.id, code: recent.data.code, name: recent.data.name,
      startDate: recent.data.startDate, endDate: recent.data.endDate,
      isOrganizer: false, isCoOrganizer: false, canViewReports: false,
      activeRegistrationCount: 0, activeBranchFeeElectionCount: 0,
    });
  }
  const recentFailed = !!lastCode && recent.isError;
  if (events.length === 1 && !recentFailed) return <Redirect to={eventCodePath(events[0].code)} replace />;
  const notice = recentFailed ? (
    <div role="status" className="max-w-xl mx-auto px-4 pt-6">
      <p>Your recently visited event couldn't be loaded. You can retry or choose another event below.</p>
      <Button variant="outline" onClick={() => void recent.refetch()}>Retry visited event</Button>
    </div>
  ) : null;
  if (!events.length) return <>{notice}
    {(
    <section className="max-w-xl mx-auto px-4 py-12 text-center space-y-4">
      <h1 className="font-serif text-3xl font-bold">Find your event home</h1>
      <p>You aren't associated with an event yet. Enter its event code to join.</p>
      <div className="flex flex-wrap justify-center gap-4">
        <Link href="/join" className="font-bold underline">Join an event</Link>
        <Link href="/dashboard" className="font-bold underline">My dashboard</Link>
      </div>
    </section>
  )}</>;
  return <>{notice}<OrganizerEventChooser purpose="home" events={events} onSelect={id => {
    const event = events.find(e => e.reunionId === id);
    if (event) navigate(eventCodePath(event.code));
  }} /></>;
}
