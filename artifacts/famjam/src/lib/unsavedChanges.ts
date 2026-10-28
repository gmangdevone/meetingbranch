// Import before installing our wrapper so Wouter only publishes accepted writes.
import "wouter/use-browser-location";

const INDEX = "__meetingBranchHistoryIndex";
const guards = new Set<() => boolean>();
export const UNSAVED_MESSAGE = "You have unsaved changes. Leave without saving?";

export function registerUnsavedChanges(guard: () => boolean) {
  guards.add(guard);
  return () => { guards.delete(guard); };
}

export function confirmDiscardChanges() {
  return ![...guards].some((guard) => guard()) || window.confirm(UNSAVED_MESSAGE);
}

// Installed once at startup, not when a form becomes dirty: all SPA entries need
// an index so cancelled Back/Forward can restore the actual history position.
export function installUnsavedChangesProtection() {
  let index = Number(history.state?.[INDEX] ?? 0);
  let restoring = false;
  let approvedClick = false;
  const push = history.pushState;
  const replace = history.replaceState;
  replace.call(history, { ...history.state, [INDEX]: index }, "");

  for (const method of ["pushState", "replaceState"] as const) {
    history[method] = function (state, unused, url) {
      const destination = new URL(url == null ? location.href : String(url), location.href);
      if (restoring) return;
      if (destination.href !== location.href && !approvedClick && !confirmDiscardChanges()) return;
      const next = method === "pushState" ? index + 1 : index;
      (method === "pushState" ? push : replace).call(this, { ...state, [INDEX]: next }, unused, url);
      index = next;
    };
  }

  const onPop = (event: PopStateEvent) => {
    const next = event.state?.[INDEX];
    if (restoring) {
      event.stopImmediatePropagation();
      restoring = false;
      return;
    }
    // Entries outside this app's lifetime are handled by beforeunload.
    if (typeof next !== "number") return;
    if (next !== index && !confirmDiscardChanges()) {
      event.stopImmediatePropagation();
      restoring = true;
      history.go(index - next);
      return;
    }
    index = next;
  };
  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (!anchor || anchor.hasAttribute("download") || (anchor.target && anchor.target !== "_self")) return;
    const destination = new URL(anchor.href, location.href);
    // External document navigation uses beforeunload instead.
    if (destination.origin !== location.origin || destination.href === location.href) return;
    if (restoring || !confirmDiscardChanges()) {
      event.preventDefault();
      event.stopImmediatePropagation();
    } else {
      // Wouter's pushState occurs synchronously later in the same click.
      approvedClick = true;
      queueMicrotask(() => { approvedClick = false; });
    }
  };
  const onBefore = (event: BeforeUnloadEvent) => {
    if (![...guards].some((guard) => guard())) return;
    event.preventDefault();
    event.returnValue = "";
  };
  window.addEventListener("popstate", onPop, true);
  document.addEventListener("click", onClick, true);
  window.addEventListener("beforeunload", onBefore);
  return () => {
    history.pushState = push;
    history.replaceState = replace;
    window.removeEventListener("popstate", onPop, true);
    document.removeEventListener("click", onClick, true);
    window.removeEventListener("beforeunload", onBefore);
  };
}
