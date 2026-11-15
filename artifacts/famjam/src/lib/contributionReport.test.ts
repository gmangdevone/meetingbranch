import { describe, expect, it, vi, afterEach } from "vitest";
import type { SponsorshipContribution } from "@workspace/api-client-react";
import { contributionReportCsv, downloadContributionReport } from "./contributionReport";

const contribution: SponsorshipContribution = {
  id: 16, contributorName: "Jane Doe", amount: 20.25,
  source: "registration", paymentStatus: "pending",
  registrationId: 41, createdAt: "2026-11-15T12:00:00-06:00",
};

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("contribution report", () => {
  it("exports exact amounts, status, source, UTC date and registration", () => {
    expect(contributionReportCsv([contribution])).toContain(
      '"16","Jane Doe","20.25","pending","registration","2026-11-15T18:00:00.000Z","41"',
    );
  });

  it("includes paid, pending and waived contributions", () => {
    const csv = contributionReportCsv(["paid", "pending", "waived"].map(paymentStatus => ({
      ...contribution, paymentStatus: paymentStatus as SponsorshipContribution["paymentStatus"],
    })));
    for (const status of ["paid", "pending", "waived"]) expect(csv).toContain(`"${status}"`);
    expect(csv.split("\r\n")).toHaveLength(5);
  });

  it("escapes names with quotes, commas and line breaks", () => {
    expect(contributionReportCsv([{ ...contribution, contributorName: 'The "Doe",\nFamily' }]))
      .toContain('"The ""Doe"",\nFamily"');
  });

  it.each(["=HYPERLINK(\"bad\")", "+cmd", "-cmd", "@SUM(1)", "  =1+1"])("neutralizes spreadsheet formulas: %s", contributorName => {
    expect(contributionReportCsv([{ ...contribution, contributorName }])).toContain(`"'${contributorName.trim().replace(/"/g, '""')}"`);
  });

  it("labels missing historical names and leaves absent registration IDs empty", () => {
    expect(contributionReportCsv([{ ...contribution, contributorName: null, registrationId: null }]))
      .toContain('"Name not recorded","20.25","pending","registration","2026-11-15T18:00:00.000Z",""');
  });

  it("exports a header-only file when there are no contributions", () => {
    const csv = contributionReportCsv([]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv.split("\r\n")).toHaveLength(2);
  });

  it("starts the CSV download and releases the object URL", () => {
    vi.useFakeTimers();
    const createObjectURL = vi.fn(() => "blob:report");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function () {
      expect(this.download).toMatch(/^contributions-reunion-1-\d{4}-\d{2}-\d{2}\.csv$/);
      expect(this.href).toBe("blob:report");
    });
    downloadContributionReport([contribution], 1);
    expect(click).toHaveBeenCalledOnce();
    expect(createObjectURL.mock.calls[0][0].type).toBe("text/csv;charset=utf-8");
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:report");
    expect(document.querySelector('a[download]')).toBeNull();
  });
});
