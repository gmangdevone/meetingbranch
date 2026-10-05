import type { EventMembership } from "@workspace/api-client-react";

export type Landing =
  | { kind: "welcome" }
  | { kind: "hub"; code: string }
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
 * - no events: keep the existing welcome flow (the dashboard with Join/Create)
 * - one event: that event's public hub
 * - several: the dashboard listing all of them
 */
export function resolveLanding(list: readonly EventMembership[]): Landing {
  const unique = uniqueMemberships(list);
  if (unique.length === 0) return { kind: "welcome" };
  if (unique.length === 1) return { kind: "hub", code: unique[0].code };
  return { kind: "dashboard" };
}
