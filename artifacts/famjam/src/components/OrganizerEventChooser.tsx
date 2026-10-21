import { Link } from "wouter";
import { CalendarDays, ChevronRight, LayoutDashboard } from "lucide-react";
import type { EventMembership } from "@workspace/api-client-react";

function parseDate(value: unknown): Date | null {
  if (!value) return null;
  const s = String(value);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T12:00:00`) : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatRange(start: unknown, end: unknown): string {
  const s = parseDate(start);
  const e = parseDate(end);
  if (!s && !e) return "Dates to be announced";
  const full: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" };
  if (!s || !e) return (s ?? e)!.toLocaleDateString(undefined, full);
  if (s.toDateString() === e.toDateString()) return s.toLocaleDateString(undefined, full);
  if (s.getFullYear() === e.getFullYear()) {
    if (s.getMonth() === e.getMonth()) {
      return `${s.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${e.getDate()}, ${e.getFullYear()}`;
    }
    return `${s.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${e.toLocaleDateString(undefined, full)}`;
  }
  return `${s.toLocaleDateString(undefined, full)} – ${e.toLocaleDateString(undefined, full)}`;
}

interface Props {
  events: EventMembership[];
  onSelect: (reunionId: number) => void;
}

export function OrganizerEventChooser({ events, onSelect }: Props) {
  return (
    <section
      className="max-w-xl mx-auto py-12 px-4 flex flex-col gap-6 animate-in fade-in slide-in-from-bottom-2 duration-300"
      aria-labelledby="organizer-chooser-title"
      data-testid="organizer-event-chooser"
    >
      <header className="flex flex-col gap-2">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--fj-berry)]">Organizer sign-in</p>
        <h1 id="organizer-chooser-title" className="font-serif text-3xl font-bold text-[var(--fj-ink)]">
          Which reunion are you managing?
        </h1>
        <p className="text-muted-foreground">
          Pick one for this session. We'll open its Reports so you can get right to work.
        </p>
      </header>

      {events.length === 0 ? (
        <div className="rounded-[var(--fj-r-card)] border border-dashed bg-[var(--fj-surface)] p-6 text-center" data-testid="text-no-events">
          <p className="font-bold">No reunions to manage yet</p>
          <p className="text-muted-foreground text-sm mt-1">Head to your dashboard to see everything you belong to.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3" role="list">
          {events.map((ev, i) => (
            <li
              key={ev.reunionId}
              className="animate-in fade-in slide-in-from-bottom-1 duration-300 fill-mode-both"
              style={{ animationDelay: `${i * 50}ms` }}
            >
              <button
                type="button"
                onClick={() => onSelect(ev.reunionId)}
                aria-label={`Manage ${ev.name}, ${formatRange(ev.startDate, ev.endDate)}`}
                data-testid={`button-choose-event-${ev.reunionId}`}
                className="group w-full min-h-[72px] flex items-center gap-4 text-left rounded-[var(--fj-r-card)] border bg-[var(--fj-surface)] px-5 py-4 shadow-[var(--fj-shadow-card)] transition-[transform,border-color,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-[var(--fj-brand-bright)] hover:shadow-md active:translate-y-0"
              >
                <span className="shrink-0 grid place-items-center size-11 rounded-[var(--fj-r-tile)] bg-muted text-primary">
                  <CalendarDays className="size-5" aria-hidden="true" />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block font-bold text-lg leading-snug text-[var(--fj-ink)] break-words" data-testid={`text-event-name-${ev.reunionId}`}>
                    {ev.name}
                  </span>
                  <span className="block text-sm text-muted-foreground" data-testid={`text-event-dates-${ev.reunionId}`}>
                    {formatRange(ev.startDate, ev.endDate)}
                  </span>
                </span>
                <ChevronRight
                  className="size-5 shrink-0 text-muted-foreground transition-transform duration-200 group-hover:translate-x-1 group-hover:text-primary"
                  aria-hidden="true"
                />
              </button>
            </li>
          ))}
        </ul>
      )}

      <Link
        href="/dashboard"
        data-testid="link-dashboard"
        className="self-center inline-flex items-center gap-2 min-h-11 rounded-full border px-5 font-bold text-[var(--fj-brand)] hover:bg-muted transition-colors"
      >
        <LayoutDashboard className="size-4" aria-hidden="true" />
        Go to my dashboard instead
      </Link>
    </section>
  );
}

export default OrganizerEventChooser;
