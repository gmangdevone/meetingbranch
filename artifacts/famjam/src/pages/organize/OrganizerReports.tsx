import { useGetReunionReports, getGetReunionReportsQueryKey } from "@workspace/api-client-react";
import { OrganizerLayout } from "./OrganizerLayout";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { Users, Shirt, Utensils, CreditCard } from "lucide-react";

const COLORS = ['hsl(15 80% 55%)', 'hsl(190 40% 30%)', 'hsl(45 90% 60%)', 'hsl(0 84% 60%)', '#8b5cf6', '#10b981', '#f97316'];

export function OrganizerReports({ params }: { params: { reunionId: string } }) {
  const reunionId = parseInt(params.reunionId, 10);
  const { data: reports, isLoading } = useGetReunionReports(reunionId, {
    query: { enabled: !isNaN(reunionId), queryKey: getGetReunionReportsQueryKey(reunionId) }
  });

  if (isLoading || !reports) return <OrganizerLayout reunionId={reunionId}><div className="p-8">Loading reports...</div></OrganizerLayout>;

  const paymentData = [
    { name: 'Paid', value: reports.paidCount },
    { name: 'Pending', value: reports.pendingCount },
    { name: 'Waived', value: reports.waivedCount },
  ].filter(d => d.value > 0);

  const shirtData = reports.byShirtSize.map(s => ({
    name: s.shirtSize,
    count: s.count
  }));

  const branchData = reports.byGroup.map(g => ({
    name: g.branchName,
    attendees: g.attendeeCount
  }));

  return (
    <OrganizerLayout reunionId={reunionId}>
      <div className="flex flex-col gap-8">
        <h1 className="font-serif text-3xl font-bold">Reports & Analytics</h1>

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
            <div className="text-muted-foreground text-sm font-bold uppercase tracking-widest mb-2 flex items-center"><Shirt className="w-4 h-4 mr-2"/> Shirts</div>
            <div className="text-4xl font-bold font-serif">{reports.byShirtSize.reduce((acc, s) => acc + s.count, 0)}</div>
          </div>
          <div className="bg-card border shadow-sm rounded-2xl p-5 flex flex-col">
            <div className="text-muted-foreground text-sm font-bold uppercase tracking-widest mb-2 flex items-center"><Utensils className="w-4 h-4 mr-2"/> Dietary</div>
            <div className="text-4xl font-bold font-serif text-amber-600 dark:text-amber-500">{reports.dietaryCount}</div>
            <div className="text-xs text-muted-foreground mt-1">notes recorded</div>
          </div>
        </div>

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

          <div className="bg-card border shadow-sm rounded-3xl p-6">
            <h3 className="font-bold text-lg mb-6 text-center">T-Shirt Sizes</h3>
            {shirtData.length > 0 ? (
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={shirtData} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} />
                    <YAxis allowDecimals={false} axisLine={false} tickLine={false} />
                    <Tooltip cursor={{ fill: 'hsl(var(--muted))' }} contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                    <Bar dataKey="count" fill="hsl(190 40% 30%)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-[300px] flex items-center justify-center text-muted-foreground">No data yet</div>
            )}
          </div>
        </div>
      </div>
    </OrganizerLayout>
  );
}
