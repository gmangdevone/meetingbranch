import { useAdminGetReports } from "@workspace/api-client-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, Legend,
} from "recharts";
import { BarChart2, Users, Activity, AlertTriangle, DollarSign } from "lucide-react";

const COLORS = [
  "hsl(15 80% 55%)",
  "hsl(190 40% 30%)",
  "hsl(45 90% 60%)",
  "hsl(120 60% 40%)",
  "hsl(280 60% 50%)",
  "hsl(0 0% 60%)",
  "hsl(200 80% 50%)",
];

export function AdminReports() {
  const { data: reports, isLoading } = useAdminGetReports();

  if (isLoading || !reports) {
    return (
      <div className="flex flex-col gap-6 animate-pulse">
        <div className="h-12 w-64 bg-muted rounded-xl" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => <div key={i} className="h-24 bg-muted rounded-3xl" />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-4">
          <div className="h-[300px] bg-muted rounded-3xl" />
          <div className="h-[300px] bg-muted rounded-3xl" />
          <div className="h-[300px] bg-muted rounded-3xl" />
          <div className="h-[300px] bg-muted rounded-3xl" />
        </div>
      </div>
    );
  }

  // Map to recharts-friendly shapes
  const byGroupData = reports.byGroup.map((g) => ({
    name: g.siblingName,
    attendees: g.attendeeCount,
    registrations: g.registrationCount,
  }));

  const byShirtSizeData = reports.byShirtSize.map((s) => ({
    name: s.shirtSize,
    count: s.count,
  }));

  const registrationsOverTimeData = reports.registrationsOverTime.map((d) => ({
    name: d.date,
    count: d.count,
  }));

  const paymentData = [
    { name: "Paid", count: reports.paidCount, color: "hsl(120 60% 40%)" },
    { name: "Pending", count: reports.pendingCount, color: "hsl(45 90% 60%)" },
    { name: "Waived", count: reports.waivedCount, color: "hsl(0 0% 60%)" },
  ];

  const expectedRevenue = reports.totalAttendees * 50;
  const collectedRevenue = reports.totalAttendees * 50 * (reports.paidCount / Math.max(reports.totalRegistrations, 1));

  return (
    <div className="flex flex-col gap-8 pb-12">
      <div className="flex items-center gap-4">
        <div className="bg-primary/10 text-primary p-3 rounded-2xl">
          <BarChart2 className="w-8 h-8" />
        </div>
        <h1 className="font-serif text-3xl md:text-4xl font-bold text-secondary">Analytics Reports</h1>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-card border shadow-sm rounded-2xl p-5">
          <p className="text-muted-foreground text-xs font-bold uppercase tracking-wider mb-2">Total Attendees</p>
          <p className="text-3xl font-serif font-bold">{reports.totalAttendees}</p>
        </div>
        <div className="bg-card border shadow-sm rounded-2xl p-5">
          <p className="text-muted-foreground text-xs font-bold uppercase tracking-wider mb-2">Registrations</p>
          <p className="text-3xl font-serif font-bold">{reports.totalRegistrations}</p>
        </div>
        <div className="bg-card border shadow-sm rounded-2xl p-5">
          <div className="flex items-center gap-1 mb-2">
            <DollarSign className="w-3 h-3 text-emerald-600" />
            <p className="text-muted-foreground text-xs font-bold uppercase tracking-wider">Revenue Expected</p>
          </div>
          <p className="text-3xl font-serif font-bold text-emerald-700">${expectedRevenue.toLocaleString()}</p>
        </div>
        <div className="bg-card border shadow-sm rounded-2xl p-5">
          <div className="flex items-center gap-1 mb-2">
            <AlertTriangle className="w-3 h-3 text-amber-500" />
            <p className="text-muted-foreground text-xs font-bold uppercase tracking-wider">Dietary Needs</p>
          </div>
          <p className="text-3xl font-serif font-bold text-amber-600">{reports.dietaryCount}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Registrations Over Time */}
        <div className="bg-card border shadow-sm rounded-3xl p-6 flex flex-col lg:col-span-2">
          <h2 className="font-bold text-lg mb-6 flex items-center gap-2">
            <Activity className="w-5 h-5 text-primary" />
            Registrations Over Time
          </h2>
          {registrationsOverTimeData.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-12">No registration history yet.</p>
          ) : (
            <div className="h-[220px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={registrationsOverTimeData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <RechartsTooltip contentStyle={{ borderRadius: "12px", border: "1px solid hsl(var(--border))" }} />
                  <Line type="monotone" dataKey="count" stroke="hsl(15 80% 55%)" strokeWidth={2} dot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Attendees by Branch */}
        <div className="bg-card border shadow-sm rounded-3xl p-6 flex flex-col">
          <h2 className="font-bold text-lg mb-6 flex items-center gap-2">
            <Users className="w-5 h-5 text-secondary" />
            Attendees by Sibling Branch
          </h2>
          {byGroupData.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-12">No data yet.</p>
          ) : (
            <div className="h-[260px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byGroupData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                  <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={80} />
                  <RechartsTooltip contentStyle={{ borderRadius: "12px", border: "1px solid hsl(var(--border))" }} />
                  <Bar dataKey="attendees" fill="hsl(190 40% 30%)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Shirt Size Distribution */}
        <div className="bg-card border shadow-sm rounded-3xl p-6 flex flex-col">
          <h2 className="font-bold text-lg mb-6">T-Shirt Size Distribution</h2>
          {byShirtSizeData.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-12">No data yet.</p>
          ) : (
            <>
              <div className="h-[220px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={byShirtSizeData}
                      cx="50%"
                      cy="50%"
                      outerRadius={90}
                      paddingAngle={3}
                      dataKey="count"
                      nameKey="name"
                    >
                      {byShirtSizeData.map((_entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <RechartsTooltip contentStyle={{ borderRadius: "12px", border: "1px solid hsl(var(--border))" }} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </div>

        {/* Payment Status Breakdown */}
        <div className="bg-card border shadow-sm rounded-3xl p-6 flex flex-col">
          <h2 className="font-bold text-lg mb-6">Payment Status</h2>
          <div className="flex-1 flex flex-col justify-center gap-4">
            {paymentData.map((item) => (
              <div key={item.name} className="flex items-center gap-4">
                <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: item.color }} />
                <div className="flex-1">
                  <div className="flex justify-between items-center mb-1">
                    <span className="font-medium text-sm">{item.name}</span>
                    <span className="font-bold text-sm">{item.count}</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: reports.totalRegistrations > 0
                          ? `${(item.count / reports.totalRegistrations) * 100}%`
                          : "0%",
                        backgroundColor: item.color,
                      }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Dietary Restrictions Summary */}
        <div className="bg-card border shadow-sm rounded-3xl p-6">
          <h2 className="font-bold text-lg mb-4 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            Dietary Restrictions
          </h2>
          <div className="flex items-center gap-6 mt-4">
            <div className="text-center">
              <p className="text-4xl font-serif font-bold text-amber-600">{reports.dietaryCount}</p>
              <p className="text-sm text-muted-foreground mt-1">attendees with dietary needs</p>
            </div>
            <div className="text-sm text-muted-foreground leading-relaxed">
              Review individual registrations for specific dietary details. Use the Registrations page to view each attendee's restrictions.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
