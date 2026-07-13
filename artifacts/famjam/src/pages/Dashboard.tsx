import { useGetRegistrationSummary, useListMyRegistrations } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Users, Ticket, ArrowRight, Activity } from "lucide-react";
import { format } from "date-fns";

export function Dashboard() {
  const { data: summary, isLoading: isLoadingSummary } = useGetRegistrationSummary();
  const { data: myRegistrations, isLoading: isLoadingRegistrations } = useListMyRegistrations();

  const isLoading = isLoadingSummary || isLoadingRegistrations;

  if (isLoading) {
    return (
      <div className="flex flex-col gap-6 animate-pulse">
        <div className="h-12 w-64 bg-muted rounded-xl" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => <div key={i} className="h-32 bg-muted rounded-3xl" />)}
        </div>
        <div className="h-[400px] bg-muted rounded-3xl" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 pb-12">
      <div className="flex items-center justify-between">
        <h1 className="font-serif text-4xl md:text-5xl font-bold text-secondary">Dashboard</h1>
        <Link 
          href="/register" 
          className="bg-primary text-primary-foreground px-5 py-2.5 rounded-full font-bold text-sm md:text-base shadow-sm hover:bg-primary/90 flex items-center gap-2 transition-transform active:scale-95"
        >
          <Ticket className="w-4 h-4" />
          <span className="hidden md:inline">New Registration</span>
          <span className="md:hidden">Register</span>
        </Link>
      </div>

      {/* Summary Widgets */}
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <div className="bg-card border shadow-sm rounded-3xl p-6 flex flex-col justify-between">
          <div className="flex items-center gap-4 text-primary">
            <div className="p-3 bg-primary/10 rounded-2xl">
              <Users className="w-6 h-6" />
            </div>
            <h3 className="font-semibold text-lg">Total Family Coming</h3>
          </div>
          <p className="text-5xl font-serif font-bold mt-6">{summary?.totalAttendees || 0}</p>
        </div>

        <div className="bg-card border shadow-sm rounded-3xl p-6 flex flex-col justify-between">
          <div className="flex items-center gap-4 text-secondary">
            <div className="p-3 bg-secondary/10 rounded-2xl">
              <Ticket className="w-6 h-6" />
            </div>
            <h3 className="font-semibold text-lg">Total Registrations</h3>
          </div>
          <p className="text-5xl font-serif font-bold mt-6">{summary?.totalRegistrations || 0}</p>
        </div>

        <div className="bg-card border shadow-sm rounded-3xl p-6 flex flex-col lg:col-span-1 md:col-span-2">
          <div className="flex items-center gap-4 text-accent-foreground">
            <div className="p-3 bg-accent/20 rounded-2xl">
              <Activity className="w-6 h-6" />
            </div>
            <h3 className="font-semibold text-lg">Largest Branches</h3>
          </div>
          <div className="mt-6 flex flex-col gap-3">
            {summary?.byGroup?.sort((a, b) => b.attendeeCount - a.attendeeCount).slice(0, 3).map((group) => (
              <div key={group.siblingName} className="flex items-center justify-between">
                <span className="font-medium text-foreground/80">{group.siblingName}'s Branch</span>
                <span className="font-bold text-foreground bg-accent/20 px-3 py-1 rounded-full text-sm">
                  {group.attendeeCount} people
                </span>
              </div>
            ))}
            {(!summary?.byGroup || summary.byGroup.length === 0) && (
              <p className="text-sm text-muted-foreground">No registrations yet.</p>
            )}
          </div>
        </div>
      </section>

      {/* My Registrations */}
      <section>
        <h2 className="font-serif text-3xl font-bold text-foreground mb-6">My Registrations</h2>
        
        {!myRegistrations?.length ? (
          <div className="bg-card border shadow-sm rounded-3xl p-12 flex flex-col items-center text-center">
            <div className="w-20 h-20 bg-muted rounded-full flex items-center justify-center mb-4">
              <Ticket className="w-8 h-8 text-muted-foreground" />
            </div>
            <h3 className="text-xl font-bold mb-2">No registrations found</h3>
            <p className="text-muted-foreground mb-6 max-w-sm">
              You haven't registered anyone for the reunion yet. Let's get your family on the list!
            </p>
            <Link 
              href="/register" 
              className="bg-primary text-primary-foreground px-6 py-3 rounded-full font-bold shadow-md hover:bg-primary/90 transition-all"
            >
              Start Registration
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {myRegistrations.map((reg, idx) => (
              <Link key={reg.id} href={`/registrations/${reg.id}`}>
                <div 
                  className="bg-card border shadow-sm rounded-3xl p-6 hover-elevate transition-all cursor-pointer group"
                  style={{ animationDelay: `${idx * 100}ms` }}
                >
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1 block">
                        {reg.siblingName} Branch
                      </span>
                      <h3 className="font-serif text-2xl font-bold">
                        {reg.attendees?.[0]?.name || 'Family'} & Guests
                      </h3>
                    </div>
                    <div className="bg-primary/10 text-primary w-10 h-10 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
                      <ArrowRight className="w-5 h-5" />
                    </div>
                  </div>
                  
                  <div className="flex gap-4 text-sm mt-6 pt-4 border-t">
                    <div className="flex flex-col">
                      <span className="text-muted-foreground">Attendees</span>
                      <span className="font-bold">{reg.attendeeCount}</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-muted-foreground">Registered On</span>
                      <span className="font-bold">{format(new Date(reg.createdAt), "MMM d, yyyy")}</span>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
