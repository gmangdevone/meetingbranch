import { differenceInCalendarDays, endOfDay, isAfter, isBefore, startOfDay } from "date-fns";

export function getEventCountdownLabel(startDate: Date, endDate: Date, now: Date): string {
  const today = startOfDay(now);
  const eventStart = startOfDay(startDate);
  const eventEnd = endOfDay(endDate);
  const daysUntilStart = differenceInCalendarDays(eventStart, today);

  if (daysUntilStart > 1) return `${daysUntilStart} days to go`;
  if (daysUntilStart === 1) return "1 day to go";
  if (daysUntilStart === 0) return "Event starts today";
  if (!isBefore(now, eventStart) && !isAfter(now, eventEnd)) return "Event happening now";
  return "Event has ended";
}

export function getRegistrationMomentumLabel(totalRegistrations: number): string {
  const noun = totalRegistrations === 1 ? "registrant" : "registrants";
  return `${totalRegistrations} ${noun} and counting`;
}

export function millisecondsUntilNextDay(now: Date): number {
  const nextDay = new Date(now);
  nextDay.setHours(24, 0, 1, 0);
  return Math.max(1, nextDay.getTime() - now.getTime());
}