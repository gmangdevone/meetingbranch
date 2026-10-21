const KEY = "meeting-branch:organizer-session";
type Choice = { userId: string; sessionId: string; reunionId: number };
let memoryChoice: Choice | null = null;

/** Navigation preference only. Always validate against a fresh membership response. */
export function readOrganizerChoice(userId: string, sessionId: string): number | null {
  let choice = memoryChoice;
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw) choice = JSON.parse(raw);
  } catch { /* Storage may be disabled; the in-memory preference is session-scoped too. */ }
  return choice?.userId === userId && choice?.sessionId === sessionId &&
    Number.isSafeInteger(choice.reunionId) && choice.reunionId > 0 ? choice.reunionId : null;
}

export function saveOrganizerChoice(userId: string, sessionId: string, reunionId: number) {
  memoryChoice = { userId, sessionId, reunionId };
  try { sessionStorage.setItem(KEY, JSON.stringify(memoryChoice)); } catch { /* See above. */ }
}

export function clearOrganizerChoice() {
  memoryChoice = null;
  try { sessionStorage.removeItem(KEY); } catch { /* See above. */ }
}
