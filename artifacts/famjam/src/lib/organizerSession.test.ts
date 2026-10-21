import { beforeEach, expect, it, vi } from "vitest";
import { clearOrganizerChoice, readOrganizerChoice, saveOrganizerChoice } from "./organizerSession";

beforeEach(() => { vi.restoreAllMocks(); clearOrganizerChoice(); });

it("scopes choices to both the user and authentication session", () => {
  saveOrganizerChoice("a", "first", 42);
  expect(readOrganizerChoice("a", "first")).toBe(42);
  expect(readOrganizerChoice("a", "second")).toBeNull();
  expect(readOrganizerChoice("b", "first")).toBeNull();
  clearOrganizerChoice();
  expect(readOrganizerChoice("a", "first")).toBeNull();
});

it("ignores invalid stored values", () => {
  for (const value of ["broken json", "null", '{"userId":"a","sessionId":"first","reunionId":-1}']) {
    sessionStorage.setItem("meeting-branch:organizer-session", value);
    expect(readOrganizerChoice("a", "first")).toBeNull();
  }
});

it("supports choosing an event when browser storage is disabled", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Storage disabled"); });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage disabled"); });
  saveOrganizerChoice("a", "first", 42);
  expect(readOrganizerChoice("a", "first")).toBe(42);
  expect(readOrganizerChoice("a", "second")).toBeNull();
});
