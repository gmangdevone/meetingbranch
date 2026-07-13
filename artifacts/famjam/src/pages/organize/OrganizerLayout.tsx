import { Link, useLocation } from "wouter";
import { useGetReunion, getGetReunionQueryKey } from "@workspace/api-client-react";
import { Users, LayoutDashboard, Settings, List, FileText, CalendarDays, Bell } from "lucide-react";
import { Skeleton } from "../../components/ui/skeleton";

export function OrganizerLayout({ reunionId, children }: { reunionId: number, children: React.ReactNode }) {
  const [location] = useLocation();

  const { data: summary, isLoading, isError } = useGetReunion(reunionId, {
    query: { enabled: !!reunionId, retry: false, queryKey: getGetReunionQueryKey(reunionId) }
  });

  if (isLoading) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-32 rounded-3xl" />
        <Skeleton className="h-96 rounded-3xl" />
      </div>
    );
  }

  if (isError || !summary) {
    return (
      <div className="text-center py-20">
        <h1 className="text-2xl font-bold mb-4 text-destructive">Access Denied</h1>
        <p className="text-muted-foreground mb-6">You are not the organizer of this reunion or it does not exist.</p>
        <Link href="/dashboard" className="text-primary font-bold hover:underline">Return to Dashboard</Link>
      </div>
    );
  }

  const { reunion } = summary;
  const baseUrl = `/organize/${reunionId}`;

  const navItems = [
    { href: baseUrl, label: "Overview", icon: LayoutDashboard },
    { href: `${baseUrl}/registrations`, label: "Registrations", icon: Users },
    { href: `${baseUrl}/reports`, label: "Reports", icon: FileText },
    { href: `${baseUrl}/announcements`, label: "Announcements", icon: Bell },
    { href: `${baseUrl}/schedule`, label: "Schedule", icon: CalendarDays },
    { href: `${baseUrl}/branches`, label: "Branches", icon: List },
    { href: `${baseUrl}/settings`, label: "Settings", icon: Settings },
  ];

  return (
    <div className="flex flex-col md:flex-row gap-8 pb-12">
      <aside className="md:w-64 shrink-0">
        <div className="sticky top-24 bg-card border shadow-sm rounded-3xl p-4 flex flex-col gap-2">
          <div className="mb-4 px-4 pt-2 pb-4 border-b">
            <h2 className="font-bold text-lg truncate" title={reunion.name}>{reunion.name}</h2>
            <div className="text-xs text-muted-foreground font-mono mt-1">Code: {reunion.code}</div>
          </div>
          
          <nav className="flex flex-col gap-1">
            {navItems.map((item) => {
              const isActive = location === item.href;
              const Icon = item.icon;
              return (
                <Link 
                  key={item.href} 
                  href={item.href}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-colors ${
                    isActive 
                      ? "bg-primary/10 text-primary" 
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </aside>

      <div className="flex-1 min-w-0">
        {children}
      </div>
    </div>
  );
}
