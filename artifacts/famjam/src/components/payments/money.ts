import type { QueryClient } from "@tanstack/react-query";
import {
  getGetRegistrationLedgerQueryKey,
  getGetRegistrationQueryKey,
  getListMyRegistrationsQueryKey,
  getListReunionRegistrationsQueryKey,
  getListPaymentSubmissionsQueryKey,
  getGetReunionReportsQueryKey,
  getGetReunionSummaryQueryKey,
  getGetSponsorshipFundQueryKey,
} from "@workspace/api-client-react";

/** Exact cents to "$1,234.50". */
export function money(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  return `${sign}$${Math.floor(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
}

/** "30", "30.5", "$1,030.05" -> cents; null when invalid, zero or over 2 decimals. */
export function parseCents(input: string): number | null {
  const m = /^\$?(\d{1,7})(?:\.(\d{1,2}))?$/.exec(input.trim().replace(/,/g, ""));
  if (!m) return null;
  const c = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return c > 0 ? c : null;
}

export const centsToInput = (c: number) => (c > 0 ? (c / 100).toFixed(2) : "");

/** Refresh every view that shows balances after money moves. */
export function invalidateMoney(qc: QueryClient, reunionId: number, registrationIds: number[]) {
  for (const id of new Set(registrationIds)) {
    qc.invalidateQueries({ queryKey: getGetRegistrationLedgerQueryKey(id) });
    qc.invalidateQueries({ queryKey: getGetRegistrationQueryKey(id) });
  }
  qc.invalidateQueries({ queryKey: getListMyRegistrationsQueryKey() });
  qc.invalidateQueries({ queryKey: getListReunionRegistrationsQueryKey(reunionId) });
  qc.invalidateQueries({ queryKey: getListPaymentSubmissionsQueryKey(reunionId) });
  qc.invalidateQueries({ queryKey: getGetReunionReportsQueryKey(reunionId) });
  qc.invalidateQueries({ queryKey: getGetReunionSummaryQueryKey(reunionId) });
  qc.invalidateQueries({ queryKey: getGetSponsorshipFundQueryKey(reunionId) });
}
