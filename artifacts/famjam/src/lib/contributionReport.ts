import type { SponsorshipContribution } from "@workspace/api-client-react";

function csvCell(value: string | number): string {
  const text = String(value);
  // Quoting alone does not stop spreadsheet formulas in user-entered names.
  const safe = /^[\s]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function contributionReportCsv(contributions: SponsorshipContribution[]): string {
  const rows: (string | number)[][] = [
    ["Contribution ID", "Contributor Name", "Amount (USD)", "Payment Status", "Source", "Created At (UTC)", "Registration ID"],
    ...contributions.map(c => [
      c.id,
      c.contributorName?.trim() || "Name not recorded",
      c.amount.toFixed(2),
      c.paymentStatus,
      c.source,
      new Date(c.createdAt).toISOString(),
      c.registrationId ?? "",
    ]),
  ];
  return "\uFEFF" + rows.map(row => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function downloadContributionReport(contributions: SponsorshipContribution[], reunionId: number): void {
  const blob = new Blob([contributionReportCsv(contributions)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `contributions-reunion-${reunionId}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Allow the browser to start consuming the file before releasing its URL.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
