import { useGetReunionReports, getGetReunionReportsQueryKey } from "@workspace/api-client-react";
import { OrganizerLayout } from "./OrganizerLayout";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { Users, Package, Utensils, CreditCard } from "lucide-react";
import { money } from "../../components/payments/money";
import { BranchFeeReport } from "../../components/payments/BranchFeeReport";
import { Button } from "../../components/ui/button";
import { Link } from "wouter";

const COLORS = ['hsl(15 80% 55%)', 'hsl(190 40% 30%)', 'hsl(45 90% 60%)', 'hsl(0 84% 60%)', '#8b5cf6', '#10b981', '#f97316'];

export function OrganizerReports({ params }: { params: { reunionId: string } }) {
  const reunionId = parseInt(params.reunionId, 10);
  const { data: reports, isLoading, isError, error, errorUpdatedAt, isFetching, refetch } = useGetReunionReports(reunionId, {
    query: { enabled: !isNaN(reunionId), retry: false, queryKey: getGetReunionReportsQueryKey(reunionId) }
  });

  // A permission failure must take precedence over any cached report data.
  const accessDenied = isError && (error?.status === 401 || error?.status === 403);
  if (accessDenied) {
    return (
      <OrganizerLayout reunionId={reunionId} requiredRole="reports">
        <div role="alert" className="bg-card border rounded-3xl p-8">
          <h1 className="font-serif text-2xl font-bold">You don't have access to these reports</h1>
          <p className="text-muted-foreground my-4">Your session may have expired or your organizer permissions have changed. Sign in again or ask the reunion owner for access.</p>
          <Link href="/dashboard" className="text-primary font-bold hover:underline">Return to Dashboard</Link>
        </div>
      </OrganizerLayout>
    );
  }

  const failure = (
    <div role="alert" className="bg-card border rounded-3xl p-6">
      <p className="font-medium text-destructive">{reports ? "Couldn't refresh reports." : "Couldn't load reports."}</p>
      <p className="text-sm text-muted-foreground mt-2">
        {reports ? "Showing previously loaded reports. These numbers may be out of date." : "Check your connection and try again."}
      </p>
      <Button variant="outline" className="mt-4" disabled={isFetching || isNaN(reunionId)} onClick={() => void refetch()}>
        {isFetching ? "Retrying..." : "Try again"}
      </Button>
    </div>
  );

  if (!reports) {
    return (
      <OrganizerLayout reunionId={reunionId} requiredRole="reports">
        {isLoading && !errorUpdatedAt ? <div role="status" className="p-8">Loading reports...</div> : failure}
      </OrganizerLayout>
    );
  }

  const paymentData = [
    { name: 'Paid', value: reports.paidCount },
    { name: 'Partially paid', value: reports.partialCount ?? 0 },
    { name: 'Unpaid', value: reports.unpaidCount ?? reports.pendingCount },
    { name: 'Waived', value: reports.waivedCount },
  ].filter(d => d.value > 0);

  // Server-provided add-on rollup (pending codegen): one row per item + variation.
  const addOnSummary = ((reports as { addOnSummary?: AddOnSummaryRow[] }).addOnSummary ?? [])
    .slice()
    .sort((a, b) => a.label.localeCompare(b.label) || a.variation.localeCompare(b.variation));
  const addOnUnits = addOnSummary.reduce((acc, r) => acc + r.quantity, 0);
  const addOnCents = addOnSummary.reduce((acc, r) => acc + r.totalCents, 0);

  const branchData = reports.byGroup.map(g => ({
    name: g.branchName,
    attendees: g.attendeeCount
  }));

  return (
    <OrganizerLayout reunionId={reunionId} requiredRole="reports">
      <div className="flex flex-col gap-8">
        <h1 className="font-serif text-3xl font-bold">Reports & Analytics</h1>
        {isError && failure}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-card border shadow-sm rounded-2xl p-5 flex flex-col">
            <div className="text-muted-foreground text-sm font-bold uppercase tracking-widest mb-2 flex items-center"><Users className="w-4 h-4 mr-2"/> People</div>
            <div className="text-4xl font-bold font-serif">{reports.totalAttendees}</div>
          </div>
          <div className="bg-card border shadow-sm rounded-2xl p-5 flex flex-col">
            <div className="text-muted-foreground text-sm font-bold uppercase tracking-widest mb-2 flex items-center"><CreditCard className="w-4 h-4 mr-2"/> Paid</div>
            <div className="text-4xl font-bold font-serif text-green-600 dark:text-green-500">{reports.paidCount}</div>
            <div className="text-xs text-muted-foreground mt-1">/ {reports.totalRegistrations} households</div>
          </div>
          <div className="bg-card border shadow-sm rounded-2xl p-5 flex flex-col">
            <div className="text-muted-foreground text-sm font-bold uppercase tracking-widest mb-2 flex items-center"><Package className="w-4 h-4 mr-2"/> Add-ons</div>
            <div className="text-4xl font-bold font-serif" data-testid="text-addon-units">{addOnUnits}</div>
            <div className="text-xs text-muted-foreground mt-1">{money(addOnCents)} ordered</div>
          </div>
          <div className="bg-card border shadow-sm rounded-2xl p-5 flex flex-col">
            <div className="text-muted-foreground text-sm font-bold uppercase tracking-widest mb-2 flex items-center"><Utensils className="w-4 h-4 mr-2"/> Dietary</div>
            <div className="text-4xl font-bold font-serif text-amber-600 dark:text-amber-500">{reports.dietaryCount}</div>
            <div className="text-xs text-muted-foreground mt-1">notes recorded</div>
            {(reports.dinnerOptOutCount ?? 0) > 0 && (
              <div className="text-xs text-muted-foreground mt-1" data-testid="dinner-opt-outs">{reports.dinnerOptOutCount} skipping dinner</div>
            )}
          </div>
        </div>

        {reports.finance && (
          <section className="bg-card border shadow-sm rounded-3xl p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
              <h3 className="font-bold text-lg">Money (active registrations)</h3>
              <span className="text-xs text-muted-foreground">Confirmed receipts only. Reported payments are shown separately.</span>
            </div>
            <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-4 text-sm">
              {[
                ["Charges", reports.finance.chargesCents, ""],
                ["Confirmed received", reports.finance.confirmedCents, "text-green-700 dark:text-green-400"],
                ["Opening credits", reports.finance.legacyCreditCents, ""],
                ["Sponsored", reports.finance.sponsoredCents, ""],
                ["Waived", reports.finance.waivedCents, ""],
                ["Outstanding", reports.finance.outstandingCents, "text-red-600 dark:text-red-400"],
                ["Reported, unconfirmed", reports.finance.pendingReportedCents, "text-amber-700 dark:text-amber-400"],
                ["Credits to review", reports.finance.creditCents, "text-sky-700 dark:text-sky-300"],
              ].map(([label, cents, tone]) => (
                <div key={label as string}>
                  <dt className="text-muted-foreground text-xs font-bold uppercase tracking-widest">{label}</dt>
                  <dd className={`font-serif text-2xl font-bold tabular-nums ${tone}`}>{money(cents as number)}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-card border shadow-sm rounded-3xl p-6">
            <h3 className="font-bold text-lg mb-6 text-center">Attendees by Branch</h3>
            {branchData.length > 0 ? (
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={branchData}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                      outerRadius={100}
                      fill="#8884d8"
                      dataKey="attendees"
                    >
                      {branchData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-[300px] flex items-center justify-center text-muted-foreground">No data yet</div>
            )}
          </div>

          <div className="bg-card border shadow-sm rounded-3xl p-6" data-testid="report-addons">
            <h3 className="font-bold text-lg mb-1 text-center">Add-on Orders</h3>
            <p className="text-xs text-muted-foreground text-center mb-5">Counted per variation from saved purchases</p>
            {addOnSummary.length > 0 ? (
              <div className="max-h-[300px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-widest text-muted-foreground border-b">
                      <th className="py-2 font-bold">Item</th>
                      <th className="py-2 font-bold">Variation</th>
                      <th className="py-2 font-bold text-right">Qty</th>
                      <th className="py-2 font-bold text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {addOnSummary.map((r, i) => (
                      <tr key={`${r.label}-${r.variation}-${i}`} data-testid={`row-addon-${i}`}>
                        <td className="py-2 font-medium">{r.label}{r.chargeType === "flat" && <span className="ml-1 text-[10px] uppercase text-muted-foreground">household</span>}</td>
                        <td className="py-2 text-muted-foreground">{r.variation || "Standard"}</td>
                        <td className="py-2 text-right tabular-nums font-bold">{r.quantity}</td>
                        <td className="py-2 text-right tabular-nums">{money(r.totalCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="h-[300px] flex items-center justify-center text-muted-foreground">No add-on orders yet</div>
            )}
          </div>
        </div>
        <BranchFeeReport reunionId={reunionId} />
      </div>
    </OrganizerLayout>
  );
}

type AddOnSummaryRow = { label: string; variation: string; quantity: number; totalCents: number; chargeType?: string };
