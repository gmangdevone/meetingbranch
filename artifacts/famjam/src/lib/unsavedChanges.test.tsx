import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { Link, Route, Router, Switch, useLocation } from "wouter";
import { useUnsavedChanges } from "../hooks/use-unsaved-changes";
import { installUnsavedChangesProtection } from "./unsavedChanges";

function Editor() {
  const [draft, setDraft] = useState("");
  const [saved, setSaved] = useState("");
  useUnsavedChanges(draft !== saved);
  // Multiple mounted editors must produce just one confirmation.
  useUnsavedChanges(draft !== saved);
  const [, navigate] = useLocation();
  return <>
    <input aria-label="Draft" value={draft} onChange={e => setDraft(e.target.value)} />
    <button onClick={() => setSaved(draft)}>Save</button>
    <button onClick={() => navigate("/event/2")}>Switch event</button>
    <Link href="/other">Leave</Link>
    <Link href="/editor">Same page</Link>
  </>;
}

let dispose: () => void;
beforeEach(() => {
  history.replaceState(null, "", "/start");
  dispose = installUnsavedChangesProtection();
  history.pushState(null, "", "/editor");
  vi.spyOn(window, "confirm").mockReturnValue(false);
});
afterEach(() => { cleanup(); dispose(); vi.restoreAllMocks(); });

function mount() {
  render(<Router><Switch>
    <Route path="/editor"><Editor /></Route>
    <Route><div>Destination</div></Route>
  </Switch></Router>);
}
function edit() { fireEvent.change(screen.getByLabelText("Draft"), { target: { value: "Keep this draft" } }); }

describe("unsaved route protection", () => {
  it("restores cancelled Back without unmounting the editor, then allows Back", async () => {
    mount(); edit();
    act(() => history.back());
    await waitFor(() => expect(window.confirm).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(location.pathname).toBe("/editor"));
    expect(screen.getByLabelText("Draft")).toHaveValue("Keep this draft");
    vi.mocked(window.confirm).mockReturnValue(true);
    act(() => history.back());
    await screen.findByText("Destination");
    expect(location.pathname).toBe("/start");
  });

  it("restores cancelled Forward and multi-entry history navigation", async () => {
    history.pushState(null, "", "/other");
    history.back();
    await waitFor(() => expect(location.pathname).toBe("/editor"));
    mount(); edit();
    act(() => history.forward());
    await waitFor(() => expect(window.confirm).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(location.pathname).toBe("/editor"));
    expect(screen.getByLabelText("Draft")).toHaveValue("Keep this draft");
    vi.mocked(window.confirm).mockReturnValue(true);
    act(() => history.forward());
    await screen.findByText("Destination");
  });

  it("blocks links and event switching without discarding the draft", () => {
    mount(); edit();
    fireEvent.click(screen.getByText("Leave"));
    expect(location.pathname).toBe("/editor");
    fireEvent.click(screen.getByText("Switch event"));
    expect(location.pathname).toBe("/editor");
    expect(screen.getByLabelText("Draft")).toHaveValue("Keep this draft");
    expect(window.confirm).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByText("Same page"));
    expect(window.confirm).toHaveBeenCalledTimes(2);
  });

  it("confirms accepted links only once with multiple dirty editors", () => {
    mount(); edit();
    vi.mocked(window.confirm).mockReturnValue(true);
    fireEvent.click(screen.getByText("Leave"));
    expect(screen.getByText("Destination")).toBeInTheDocument();
    expect(window.confirm).toHaveBeenCalledTimes(1);
  });

  it("allows clean and saved forms, and releases guards on unmount", () => {
    mount();
    const clean = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
    edit();
    const dirty = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
    fireEvent.click(screen.getByText("Save"));
    fireEvent.click(screen.getByText("Switch event"));
    expect(location.pathname).toBe("/event/2");
    expect(window.confirm).not.toHaveBeenCalled();
    const unmounted = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unmounted);
    expect(unmounted.defaultPrevented).toBe(false);
  });

  it("blocks replace navigation and restores a multi-step Back position", async () => {
    history.pushState(null, "", "/middle");
    history.pushState({ existing: "preserved" }, "", "/editor");
    mount(); edit();
    act(() => history.replaceState(null, "", "/event/2"));
    expect(location.pathname).toBe("/editor");
    expect(history.state.existing).toBe("preserved");
    act(() => history.go(-2));
    await waitFor(() => expect(window.confirm).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(location.pathname).toBe("/editor"));
    expect(screen.getByLabelText("Draft")).toHaveValue("Keep this draft");
  });
});
