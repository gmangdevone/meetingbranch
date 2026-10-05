/**
 * Event membership for the signed-in user. Sources (and only these):
 *  - reunions.organizer_id = user          (organizer)
 *  - reunion_organizers.user_id = user     (co-organizer)
 *  - registrations.user_id = user with status 'active' (registrant)
 * Cancelled-only registrations do not count. Admin visibility never counts.
 * Entries are deduplicated by the immutable reunion id.
 */
export interface MembershipReunion {
  id: number;
  code: string;
  name: string;
  startDate: string;
  endDate: string;
}
export interface EventMembership {
  reunionId: number;
  code: string;
  name: string;
  startDate: string;
  endDate: string;
  isOrganizer: boolean;
  isCoOrganizer: boolean;
  activeRegistrationCount: number;
}

export function mergeMemberships(input: {
  owned: MembershipReunion[];
  coOrganized: MembershipReunion[];
  registrations: { status: string; reunion: MembershipReunion }[];
}): EventMembership[] {
  const byId = new Map<number, EventMembership>();
  const entry = (r: MembershipReunion) => {
    let e = byId.get(r.id);
    if (!e) {
      e = { reunionId: r.id, code: r.code, name: r.name, startDate: String(r.startDate), endDate: String(r.endDate), isOrganizer: false, isCoOrganizer: false, activeRegistrationCount: 0 };
      byId.set(r.id, e);
    }
    return e;
  };
  for (const r of input.owned) entry(r).isOrganizer = true;
  for (const r of input.coOrganized) entry(r).isCoOrganizer = true;
  for (const reg of input.registrations) {
    if (reg.status !== "active") continue;
    entry(reg.reunion).activeRegistrationCount += 1;
  }
  return [...byId.values()].sort(
    (a, b) => a.startDate.localeCompare(b.startDate) || a.reunionId - b.reunionId,
  );
}
