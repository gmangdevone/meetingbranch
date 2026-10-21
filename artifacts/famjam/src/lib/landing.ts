import type { EventMembership } from "@workspace/api-client-react";

export type Landing =
  | { kind: "welcome" }
  | { kind: "hub"; code: string }
  | { kind: "reports"; reunionId: number }
  | { kind: "choose"; events: EventMembership[] }
  | { kind: "dashboard" };

/** Deduplicate by immutable reunion id (the server already does; this guards the client too). */
export function uniqueMemberships(list: readonly EventMembership[]): EventMembership[] {
  const byId = new Map<number, EventMembership>();
  for (const m of list) if (!byId.has(m.reunionId)) byId.set(m.reunionId, m);
  return [...byId.values()];
}

/**
 * Default signed-in destination for "/". Only call with a complete, successful
 * membership response; loading or failed requests must not be treated as zero.
 * - managed events with Reports: go directly or choose one for the session
 * - otherwise no events: keep the existing welcome flow (dashboard with Join/Create)
 * - one event: that event's public hub
 * - several: the dashboard listing all of them
 */
export function resolveLanding(list: readonly EventMembership[], selectedId?: number | null): Landing {
  const unique = uniqueMemberships(list);
  const eligible = unique.filter(m => (m.isOrganizer || m.isCoOrganizer) && m.canViewReports);
  if (eligible.length === 1) return { kind: "reports", reunionId: eligible[0].reunionId };
  if (eligible.length > 1) {
    if (eligible.some(m => m.reunionId === selectedId)) return { kind: "reports", reunionId: selectedId! };
    return { kind: "choose", events: eligible };
  }
  if (unique.length === 0) return { kind: "welcome" };
  if (unique.length === 1) return { kind: "hub", code: unique[0].code };
  return { kind: "dashboard" };
}
