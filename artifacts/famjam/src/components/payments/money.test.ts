import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { getGetRegistrationLedgerQueryKey, getGetSponsorshipFundQueryKey, getListReunionRegistrationsQueryKey } from "@workspace/api-client-react";
import { invalidateMoney, transferMoneyIds } from "./money";

const keysFor = (ids: number[]) => {
  const qc = new QueryClient();
  const seen: string[] = [];
  qc.invalidateQueries = ((f: { queryKey: unknown }) => { seen.push(JSON.stringify(f.queryKey)); return Promise.resolve(); }) as never;
  invalidateMoney(qc, 5, ids);
  return seen;
};

describe("organizer money refresh", () => {
  it("payment transfers refresh both registrations' ledgers; registration transfers only the source", () => {
    expect(transferMoneyIds(3, "payment", 8)).toEqual([3, 8]);
    expect(transferMoneyIds(3, "registration", NaN)).toEqual([3]);
    const keys = keysFor(transferMoneyIds(3, "payment", 8));
    for (const k of [getGetRegistrationLedgerQueryKey(3), getGetRegistrationLedgerQueryKey(8), getListReunionRegistrationsQueryKey(5), getGetSponsorshipFundQueryKey(5)])
      expect(keys).toContain(JSON.stringify(k));
  });
  it("a waiver refreshes the open ledger panel for that registration", () => {
    expect(keysFor([4])).toContain(JSON.stringify(getGetRegistrationLedgerQueryKey(4)));
  });
});
