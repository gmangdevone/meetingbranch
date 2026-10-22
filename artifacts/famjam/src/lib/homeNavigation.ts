import { eventCodePath } from "./eventCode";

/** Explicit Home is separate from the automatic post-sign-in destination. */
export function homeDestination(location: string, signedIn: boolean): string {
  if (!signedIn) return "/";
  const member = /^\/r\/([^/]+)(?:\/|$)/.exec(location);
  if (member) {
    try { return eventCodePath(decodeURIComponent(member[1])); } catch { return "/home"; }
  }
  const organizer = /^\/organize\/([1-9]\d*)(?:\/|$)/.exec(location);
  if (organizer) return `/home/event/${organizer[1]}`;
  return "/home";
}
