import { Link, useLocation } from "wouter";
import { useGetReunion, getGetReunionQueryKey } from "@workspace/api-client-react";
import type { ReunionRole } from "@workspace/api-client-react";
import { Users, LayoutDashboard, Settings, List, FileText, CalendarDays, Bell, Lock } from "lucide-react";
import { Skeleton } from "../../components/ui/skeleton";
import { FULL_ACCESS_VIEWER, viewerHasRole, viewerHasAnyRole } from "../../lib/roles";

export function OrganizerLayout({
  reunionId,
  children,
  requiredRole,
}: {
  reunionId: number;
  children: React.ReactNode;
  /**
   * The role a viewer must hold to see this page's content. Omit for the
   * Overview, which any manager can open (with a "no roles yet" state for
   * co-organizers who haven't been granted anything).
   */
  requiredRole?: ReunionRole;
}) {
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
        <p className="text-muted-foreground mb-6">You are not an organizer of this reunion or it does not exist.</p>
        <Link href="/dashboard" className="text-primary font-bold hover:underline">Return to Dashboard</Link>
      </div>
    );
  }

  const { reunion } = summary;
  const viewer = summary.viewer ?? FULL_ACCESS_VIEWER;
  const baseUrl = `/organize/${reunionId}`;

  // Nav items carry the role gating them. Overview is always shown; Settings is
  // shown to Power Users and to owners/admins (who can also manage organizers).
  const allNavItems: { href: string; label: string; icon: typeof Users; role?: ReunionRole }[] = [
    { href: baseUrl, label: "Overview", icon: LayoutDashboard },
    { href: `${baseUrl}/registrations`, label: "Registrations", icon: Users, role: "registration" },
    { href: `${baseUrl}/reports`, label: "Reports", icon: FileText, role: "reports" },
    { href: `${baseUrl}/announcements`, label: "Announcements", icon: Bell, role: "announcements" },
    { href: `${baseUrl}/schedule`, label: "Schedule", icon: CalendarDays, role: "schedule" },
    { href: `${baseUrl}/branches`, label: "Branches", icon: List, role: "branches" },
    { href: `${baseUrl}/settings`, label: "Settings", icon: Settings, role: "power_user" },
  ];

  const navItems = allNavItems.filter((item) => {
    if (!item.role) return true;
    if (item.href === `${baseUrl}/settings`) {
      return viewerHasRole(viewer, "power_user") || viewer.canManageOrganizers;
    }
    return viewerHasRole(viewer, item.role);
  });

  const denied = requiredRole !== undefined && !viewerHasRole(viewer, requiredRole);
  const noRolesYet = requiredRole === undefined && !viewerHasAnyRole(viewer);

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
        {denied ? (
          <AccessPanel
            title="You don't have access to this area"
            body="Your co-organizer role doesn't include this area. Ask the reunion owner to grant it, or head back to your overview."
            baseUrl={baseUrl}
          />
        ) : noRolesYet ? (
          <AccessPanel
            title="No areas assigned yet"
            body="You're a co-organizer for this reunion, but the owner hasn't given you any areas to manage yet. Once they do, they'll show up in the menu on the left."
            baseUrl={baseUrl}
            hideButton
          />
        ) : (
          children
        )}
      </div>
    </div>
  );
}

function AccessPanel({
  title,
  body,
  baseUrl,
  hideButton,
}: {
  title: string;
  body: string;
  baseUrl: string;
  hideButton?: boolean;
}) {
  return (
    <div className="bg-card border shadow-sm rounded-3xl p-10 text-center flex flex-col items-center gap-4">
      <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center">
        <Lock className="w-6 h-6 text-muted-foreground" />
      </div>
      <h1 className="font-serif text-2xl font-bold">{title}</h1>
      <p className="text-muted-foreground max-w-md">{body}</p>
      {!hideButton && (
        <Link href={baseUrl} className="text-primary font-bold hover:underline">
          Back to Overview
        </Link>
      )}
    </div>
  );
}
