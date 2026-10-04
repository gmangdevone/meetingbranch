import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useGetReunionByCode, getGetReunionByCodeQueryKey, useListMyReunions, useListMyRegistrations, useGetSettings } from "@workspace/api-client-react";
import { CalendarDays, Settings, ArrowRight, Key } from "lucide-react";
import { format } from "date-fns";
import { Greeting } from "../components/Greeting";
import { Skeleton } from "../components/ui/skeleton";
import { eventCodePath } from "../lib/eventCode";
import { getEventCountdownLabel, millisecondsUntilNextDay } from "../lib/eventMomentum";

function RegisteredEventCountdownCard({ code, now }: { code: string; now: Date }) {
  const { data: reunion } = useGetReunionByCode(code, {
    query: {
      enabled: !!code,
      retry: false,
      queryKey: getGetReunionByCodeQueryKey(code),
    },
  });

  if (!reunion) return null;

  return (
    <Link
      href={eventCodePath(reunion.code)}
      className="group flex flex-col gap-4 rounded-3xl border border-primary/20 bg-primary/10 p-6 transition-all hover:border-primary/40 hover:bg-primary/15 hover:shadow-md sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-center gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <CalendarDays className="h-6 w-6" />
        </div>
        <div>
          <p className="text-sm font-medium text-muted-foreground">Event Countdown</p>
          <h3 className="font-serif text-xl font-bold text-foreground">{reunion.name}</h3>
          <p className="text-sm text-muted-foreground">
            {format(new Date(reunion.startDate), "MMM d")} - {format(new Date(reunion.endDate), "MMM d, yyyy")}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3 sm:text-right">
        <span className="text-lg font-bold text-primary">
          {getEventCountdownLabel(new Date(reunion.startDate), new Date(reunion.endDate), now)}
        </span>
        <ArrowRight className="h-5 w-5 text-primary transition-transform group-hover:translate-x-1" />
        <span className="sr-only">Go to Reunion Hub</span>
      </div>
    </Link>
  );
}

export function Dashboard() {
  const { data: reunions, isLoading: loadingReunions } = useListMyReunions();
  const { data: registrations, isLoading: loadingRegistrations } = useListMyRegistrations();
  const { data: settings } = useGetSettings();
  const canCreateReunion = settings?.reunionCreationEnabled ?? false;

  const [countdownNow, setCountdownNow] = useState(() => new Date());
  const registeredEventCodes = Array.from(
    new Set(
      (registrations ?? [])
        .filter((registration) => registration.status === "active")
        .map((registration) => registration.reunionCode)
        .filter((code): code is string => !!code),
    ),
  );

  useEffect(() => {
    const scheduleRefresh = () => {
      const now = new Date();
      setCountdownNow(now);
      return window.setTimeout(scheduleRefresh, millisecondsUntilNextDay(now));
    };

    const timer = window.setTimeout(scheduleRefresh, millisecondsUntilNextDay(new Date()));
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <div className="flex flex-col gap-12 pb-12">
      <div className="flex flex-col gap-2">
        <Greeting className="font-serif text-2xl font-bold text-primary" />
        <h1 className="font-serif text-4xl md:text-5xl font-bold text-foreground">My Reunions</h1>
        <p className="text-lg text-muted-foreground">Manage your upcoming family gatherings.</p>
      </div>

      {!loadingRegistrations && registeredEventCodes.length > 0 && (
        <section>
          <div className="mb-6 flex items-center justify-between">
            <h2 className="font-serif text-2xl font-bold text-foreground">Upcoming Reunions</h2>
          </div>
          <div className="grid grid-cols-1 gap-4">
            {registeredEventCodes.map((eventCode) => (
              <RegisteredEventCountdownCard key={eventCode} code={eventCode} now={countdownNow} />
            ))}
          </div>
        </section>
      )}

      <section>
        <Link
          href="/join"
          className="group flex items-center gap-4 rounded-3xl border border-[#4f8da9] bg-[#66A3BF] p-6 text-slate-950 transition-all hover:bg-[#5b99b6] hover:shadow-md"
        >
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/30 text-slate-950 transition-transform group-hover:scale-110">
            <Key className="h-6 w-6" />
          </div>
          <div>
            <h3 className="text-lg font-bold">Join a Reunion</h3>
            <p className="text-sm text-slate-900/80">Enter an Event Code to RSVP for an event.</p>
          </div>
        </Link>
      </section>

      <section>
        <div className="flex items-center justify-between mb-6">
          <h2 className="font-serif text-2xl font-bold text-foreground">Reunions I Organize</h2>
        </div>
        
        {loadingReunions ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Skeleton className="h-40 rounded-3xl" />
          </div>
        ) : !reunions || reunions.length === 0 ? (
          <div className="bg-card border shadow-sm rounded-3xl p-8 text-center flex flex-col items-center">
            <div className="bg-muted w-16 h-16 rounded-full flex items-center justify-center mb-4">
              <Settings className="w-8 h-8 text-muted-foreground" />
            </div>
            <h3 className="font-bold text-lg mb-2">No organized reunions</h3>
            <p className="text-muted-foreground mb-6 max-w-sm mx-auto">You aren't organizing any reunions yet.</p>
            {canCreateReunion && (
              <Link href="/create" className="text-primary font-bold hover:underline">Create a Reunion</Link>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {reunions.map(({ reunion, registrationCount, attendeeCount }) => (
              <Link key={reunion.id} href={`/organize/${reunion.id}`} className="bg-card border shadow-sm rounded-3xl p-6 group hover:border-primary/50 transition-all flex flex-col">
                <div className="mb-4 flex-1">
                  <div className="flex justify-between items-start mb-2">
                    <h3 className="font-bold text-lg group-hover:text-primary transition-colors">{reunion.name}</h3>
                    <div className="bg-primary/10 text-primary text-xs font-bold px-2 py-1 rounded-md font-mono">
                      {reunion.code}
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {format(new Date(reunion.startDate), 'MMM d')} - {format(new Date(reunion.endDate), 'MMM d, yyyy')}
                  </p>
                </div>
                
                <div className="flex gap-4 text-sm mt-auto pt-4 border-t">
                  <div className="flex flex-col">
                    <span className="text-muted-foreground">Registrants</span>
                    <span className="font-bold">{registrationCount}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-muted-foreground">Attendees</span>
                    <span className="font-bold">{attendeeCount}</span>
                  </div>
                  <div className="ml-auto flex items-center text-primary">
                    <span className="sr-only">Manage</span>
                    <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
