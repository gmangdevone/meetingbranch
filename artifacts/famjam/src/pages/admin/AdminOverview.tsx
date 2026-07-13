import { useAdminGetReports } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Users, Ticket, CheckCircle2, Clock, Ban, ArrowRight, Shield } from "lucide-react";

export function AdminOverview() {
  const { data: reports, isLoading } = useAdminGetReports();

  if (isLoading) {
    return (
      <div className="flex flex-col gap-6 animate-pulse">
        <div className="h-12 w-64 bg-muted rounded-xl" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => <div key={i} className="h-32 bg-muted rounded-3xl" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 pb-12">
      <div className="flex items-center gap-4">
        <div className="bg-primary/10 text-primary p-3 rounded-2xl">
          <Shield className="w-8 h-8" />
        </div>
        <h1 className="font-serif text-4xl font-bold text-secondary">Overview</h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-card border shadow-sm rounded-3xl p-6 flex flex-col justify-between">
          <div className="flex items-center gap-3 text-secondary">
            <Ticket className="w-5 h-5" />
            <h3 className="font-semibold text-sm uppercase tracking-wider">Total Registrations</h3>
          </div>
          <p className="text-4xl font-serif font-bold mt-4">{reports?.totalRegistrations || 0}</p>
        </div>

        <div className="bg-card border shadow-sm rounded-3xl p-6 flex flex-col justify-between">
          <div className="flex items-center gap-3 text-primary">
            <Users className="w-5 h-5" />
            <h3 className="font-semibold text-sm uppercase tracking-wider">Total Attendees</h3>
          </div>
          <p className="text-4xl font-serif font-bold mt-4">{reports?.totalAttendees || 0}</p>
        </div>

        <div className="bg-card border shadow-sm rounded-3xl p-6 flex flex-col justify-between">
          <div className="flex items-center gap-3 text-emerald-600">
            <CheckCircle2 className="w-5 h-5" />
            <h3 className="font-semibold text-sm uppercase tracking-wider">Paid / Waived</h3>
          </div>
          <div className="mt-4 flex items-end gap-2">
            <p className="text-4xl font-serif font-bold text-emerald-600">
              {reports?.paidCount || 0}
            </p>
            <span className="text-muted-foreground font-medium mb-1">/ {reports?.waivedCount || 0}</span>
          </div>
        </div>

        <div className="bg-card border shadow-sm rounded-3xl p-6 flex flex-col justify-between">
          <div className="flex items-center gap-3 text-amber-500">
            <Clock className="w-5 h-5" />
            <h3 className="font-semibold text-sm uppercase tracking-wider">Pending</h3>
          </div>
          <p className="text-4xl font-serif font-bold mt-4 text-amber-600">{reports?.pendingCount || 0}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-4">
        <Link href="/admin/registrations" className="bg-card border shadow-sm rounded-3xl p-6 hover-elevate transition-all group flex items-center justify-between">
          <div>
            <h3 className="font-bold text-lg mb-1">Manage Registrations</h3>
            <p className="text-sm text-muted-foreground">View, filter, and export the attendee list</p>
          </div>
          <div className="bg-primary/10 text-primary w-10 h-10 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
            <ArrowRight className="w-5 h-5" />
          </div>
        </Link>
        <Link href="/admin/announcements" className="bg-card border shadow-sm rounded-3xl p-6 hover-elevate transition-all group flex items-center justify-between">
          <div>
            <h3 className="font-bold text-lg mb-1">Send Announcements</h3>
            <p className="text-sm text-muted-foreground">Post news and updates to the family</p>
          </div>
          <div className="bg-primary/10 text-primary w-10 h-10 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
            <ArrowRight className="w-5 h-5" />
          </div>
        </Link>
        <Link href="/admin/reports" className="bg-card border shadow-sm rounded-3xl p-6 hover-elevate transition-all group flex items-center justify-between">
          <div>
            <h3 className="font-bold text-lg mb-1">View Analytics</h3>
            <p className="text-sm text-muted-foreground">See shirt sizes, dietary needs, and timelines</p>
          </div>
          <div className="bg-primary/10 text-primary w-10 h-10 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
            <ArrowRight className="w-5 h-5" />
          </div>
        </Link>
      </div>
    </div>
  );
}
