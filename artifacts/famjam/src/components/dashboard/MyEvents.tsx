import { Link } from "wouter";
import { useListMyEventMemberships, getListMyEventMembershipsQueryKey, type EventMembership } from "@workspace/api-client-react";
import { ArrowRight, CalendarDays, Settings } from "lucide-react";
import { format } from "date-fns";
import { Skeleton } from "../ui/skeleton";
import { Button } from "../ui/button";
import { eventCodePath } from "../../lib/eventCode";
import { uniqueMemberships } from "../../lib/landing";
import { getEventCountdownLabel } from "../../lib/eventMomentum";

function roleLabels(m: EventMembership): string[] {
  const out: string[] = [];
  if (m.isOrganizer) out.push("Organizer");
  else if (m.isCoOrganizer) out.push("Co-organizer");
  if (m.activeRegistrationCount === 1) out.push("Registered");
  if (m.activeRegistrationCount > 1) out.push(`${m.activeRegistrationCount} registrations`);
  // Fee-only payers have no registration but still need their way back to the hub.
  if (m.activeBranchFeeElectionCount > 0) out.push("Paying branch fee");
  return out;
}

// Dates are stored as YYYY-MM-DD; parse as local dates so the day never shifts.
const day = (s: string) => new Date(`${s.slice(0, 10)}T00:00:00`);

function EventCard({ m, now }: { m: EventMembership; now: Date }) {
  const canOrganize = m.isOrganizer || m.isCoOrganizer;
  return (
    <div className="flex flex-col gap-4 rounded-3xl border border-primary/20 bg-primary/10 p-6 sm:flex-row sm:items-center sm:justify-between" data-testid="my-event">
      <div className="flex items-center gap-4 min-w-0">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <CalendarDays className="h-6 w-6" />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap gap-1.5 mb-1">
            {roleLabels(m).map((r) => (
              <span key={r} className="bg-background/70 text-foreground text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md">{r}</span>
            ))}
          </div>
          <h3 className="font-serif text-xl font-bold text-foreground break-words">{m.name}</h3>
          <p className="text-sm text-muted-foreground">
            {format(day(m.startDate), "MMM d")} - {format(day(m.endDate), "MMM d, yyyy")}
            <span className="font-mono ml-2">{m.code}</span>
          </p>
          <p className="text-sm font-bold text-primary mt-1">{getEventCountdownLabel(day(m.startDate), day(m.endDate), now)}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 shrink-0">
        <Link href={eventCodePath(m.code)} className="group inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:opacity-90 transition-opacity">
          Go to Hub <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
        </Link>
        {canOrganize && (
          <Link href={`/organize/${m.reunionId}`} className="inline-flex items-center gap-1.5 rounded-full border bg-background px-4 py-2 text-sm font-bold hover:bg-muted transition-colors">
            <Settings className="h-4 w-4" /> Organize
          </Link>
        )}
      </div>
    </div>
  );
}

/** Every event the signed-in user is associated with, one card per reunion. */
export function MyEvents({ now }: { now: Date }) {
  const q = useListMyEventMemberships({ query: { queryKey: getListMyEventMembershipsQueryKey() } });

  let body: React.ReactNode;
  if (q.isPending) {
    body = (
      <div className="grid gap-4" aria-busy="true">
        <Skeleton className="h-28 rounded-3xl" />
        <Skeleton className="h-28 rounded-3xl" />
      </div>
    );
  } else if (q.isError) {
    body = (
      <div className="bg-card border shadow-sm rounded-3xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3" role="alert">
        <p className="text-muted-foreground">We couldn't load your reunions. Your events are not lost.</p>
        <Button variant="outline" className="rounded-full font-bold" onClick={() => q.refetch()} disabled={q.isFetching}>
          {q.isFetching ? "Retrying..." : "Try again"}
        </Button>
      </div>
    );
  } else {
    const list = uniqueMemberships(q.data);
    body =
      list.length === 0 ? (
        <div className="bg-card border shadow-sm rounded-3xl p-8 text-center">
          <h3 className="font-bold text-lg mb-2">No reunions yet</h3>
          <p className="text-muted-foreground max-w-sm mx-auto">Join with an Event Code below. Reunions you register for or organize will show up here.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {list.map((m) => <EventCard key={m.reunionId} m={m} now={now} />)}
        </div>
      );
  }

  const count = q.isSuccess ? uniqueMemberships(q.data).length : null;
  return (
    <section aria-labelledby="my-events-heading">
      <div className="mb-6 flex items-baseline justify-between gap-3">
        <h2 id="my-events-heading" className="font-serif text-2xl font-bold text-foreground">My Events</h2>
        {count !== null && count > 0 && <span className="text-sm text-muted-foreground">{count} {count === 1 ? "event" : "events"}</span>}
      </div>
      {body}
    </section>
  );
}
