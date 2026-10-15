import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { JoinReunion } from "./JoinReunion";

vi.mock("wouter", () => ({ useLocation: () => ["/join", vi.fn()] }));
vi.mock("@workspace/api-client-react", () => ({
  useGetReunionByCode: () => ({ data: undefined, isLoading: false, isError: true }),
  getGetReunionByCodeQueryKey: (code: string) => ["reunion", code],
}));

it("shows an unreadable-code error with white text on solid red", () => {
  render(<JoinReunion />);
  const alert = screen.getByRole("alert");
  expect(alert).toHaveTextContent("Event not found");
  expect(alert).toHaveClass("bg-red-700", "text-white");
});
