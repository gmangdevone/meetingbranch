import { Link, useLocation } from "wouter";
import { useEffect, useState } from "react";
import { Menu, X, ArrowLeftRight } from "lucide-react";
import { Sheet, SheetPortal, SheetOverlay, SheetTitle, SheetDescription, SheetClose } from "../../components/ui/sheet";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useGetReunion, getGetReunionQueryKey, useAdminListReunions, getAdminListReunionsQueryKey } from "@workspace/api-client-react";
import type { ReunionRole } from "@workspace/api-client-react";
import { Users, LayoutDashboard, Settings, List, FileText, CalendarDays, Bell, Lock, Heart, Vote, Briefcase, ClipboardList, Coins, Home, GraduationCap } from "lucide-react";
import { Skeleton } from "../../components/ui/skeleton";
import { FULL_ACCESS_VIEWER, viewerHasRole, viewerHasAnyRole } from "../../lib/roles";
import { eventCodePath } from "../../lib/eventCode";

export function OrganizerLayout({
  reunionId,
  children,
  requiredRole,
  allowWithoutRoles,
}: {
  reunionId: number;
  children: React.ReactNode;
  /**
   * The role a viewer must hold to see this page's content. Omit for the
   * Overview, which any manager can open (with a "no roles yet" state for
   * co-organizers who haven't been granted anything).
   */
  requiredRole?: ReunionRole;
  /**
   * Lets organizers with no assigned areas reach a page whose own API decides
   * access (e.g. Graduate Dollars review for the selected recipient).
   */
  allowWithoutRoles?: boolean;
}) {
  const [location] = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  // Close the mobile drawer if the viewport grows to desktop so a hidden modal never locks scrolling.
  useEffect(() => {
    if (!menuOpen) return;
    const mq = window.matchMedia("(min-width: 768px)");
    const onChange = () => { if (mq.matches) setMenuOpen(false); };
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [menuOpen]);
  const { data: adminReunions } = useAdminListReunions({ query: { queryKey: getAdminListReunionsQueryKey(), retry: false } });

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
  const allNavItems: { href: string; label: string; icon: any; role?: ReunionRole }[] = [
    { href: eventCodePath(reunion.code), label: "View event home", icon: Home },
    { href: baseUrl, label: "Overview", icon: LayoutDashboard },
    { href: `${baseUrl}/registrations`, label: "Registrations", icon: Users, role: "registration" },
    { href: `${baseUrl}/reports`, label: "Reports", icon: FileText, role: "reports" },
    { href: `${baseUrl}/announcements`, label: "Announcements", icon: Bell, role: "announcements" },
    { href: `${baseUrl}/schedule`, label: "Schedule", icon: CalendarDays, role: "schedule" },
    { href: `${baseUrl}/branches`, label: "Branches", icon: List, role: "branches" },
    { href: `${baseUrl}/branch-fees`, label: "Branch Fees", icon: Coins, role: "power_user" },
    { href: `${baseUrl}/polls`, label: "Polls", icon: Vote },
    { href: `${baseUrl}/activities`, label: "Activities", icon: ClipboardList },
    { href: `${baseUrl}/sponsorship`, label: "Sponsorship", icon: Heart, role: "power_user" },
    { href: `${baseUrl}/graduate-dollars`, label: "Graduate Dollars", icon: GraduationCap },
    { href: `${baseUrl}/vendors`, label: "Vendors", icon: Briefcase, role: "scout" },
    ...(adminReunions ? [{ href: `${baseUrl}/home-page`, label: "Edit event home", icon: Home }] : []),
    { href: `${baseUrl}/settings`, label: "Settings", icon: Settings, role: "power_user" },
  ];

  const navItems = allNavItems.filter((item) => {
    if (!item.role) return true;
    if (item.href === `${baseUrl}/settings`) {
      return viewerHasRole(viewer, "power_user") || viewer.canManageOrganizers;
    }
    if (item.href === `${baseUrl}/branch-fees`) {
      // Power users configure; registration managers confirm money.
      return viewerHasRole(viewer, "power_user") || viewerHasRole(viewer, "registration");
    }
    return viewerHasRole(viewer, item.role);
  });

  const denied = requiredRole !== undefined && !viewerHasRole(viewer, requiredRole);
  const noRolesYet = requiredRole === undefined && !allowWithoutRoles && !viewerHasAnyRole(viewer);

  const activeItem = navItems.find((i) => i.href === location);
  const currentLabel = location === "/organize/select-event" ? "Switch event" : activeItem?.label ?? "Event management";

  // Runs after document-capture unsaved-edit guards; a cancelled click never reaches here.
  const onMobileSelect = (href: string) => (e: React.MouseEvent) => {
    if (e.defaultPrevented) return;
    setMenuOpen(false);
    if (href !== location) window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  };

  const renderNav = (mobile: boolean) => (
    <nav className="flex flex-col gap-1" aria-label="Event management sections">
      {navItems.map((item) => {
        const isActive = location === item.href;
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            onClick={mobile ? onMobileSelect(item.href) : undefined}
            className={`flex items-center gap-3 px-4 ${mobile ? "py-3.5 text-base" : "py-3 text-sm"} rounded-xl font-medium transition-colors ${
              isActive
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <Icon className="w-4 h-4 shrink-0" />
            <span className="truncate">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="flex flex-col md:flex-row gap-4 md:gap-8 pb-12">
      {/* Mobile compact header */}
      <div className="md:hidden sticky top-0 z-40 -mx-0 px-3 pt-[calc(env(safe-area-inset-top,0px)+8px)] pb-2" style={{ background: "var(--fj-bg)" }}>
        <div className="flex items-center gap-3 bg-card border shadow-sm rounded-2xl pl-4 pr-2 py-2">
          <div className="min-w-0 flex-1">
            <div className="text-xs text-muted-foreground font-semibold truncate" title={reunion.name}>{reunion.name}</div>
            <div className="font-bold text-base truncate">{currentLabel}</div>
          </div>
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={menuOpen}
            aria-controls="organizer-mobile-menu"
            className="shrink-0 inline-flex items-center gap-2 min-h-[44px] px-4 rounded-xl bg-primary text-primary-foreground font-bold text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <Menu className="w-4 h-4" aria-hidden="true" />
            Menu
          </button>
        </div>
      </div>

      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetPortal>
          <SheetOverlay className="z-[60] bg-black/50 md:hidden" />
          <DialogPrimitive.Content
            id="organizer-mobile-menu"
            onCloseAutoFocus={(e) => {
              // Restore focus to the trigger without scrolling; after navigation the trigger may be gone.
              e.preventDefault();
              document.querySelector<HTMLElement>('[aria-controls="organizer-mobile-menu"]')?.focus({ preventScroll: true });
            }}
            className="md:hidden fixed z-[70] inset-y-0 left-0 w-[86vw] max-w-sm bg-card border-r shadow-xl flex flex-col outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left duration-300"
          >
            <div className="flex items-start gap-3 px-5 pt-[calc(env(safe-area-inset-top,0px)+16px)] pb-4 border-b">
              <div className="min-w-0 flex-1">
                <SheetTitle className="font-bold text-lg truncate">{reunion.name}</SheetTitle>
                <SheetDescription className="text-xs font-mono mt-1">Event Code: {reunion.code}</SheetDescription>
                <Link
                  href="/organize/select-event"
                  onClick={onMobileSelect("/organize/select-event")}
                  className="inline-flex items-center gap-1.5 py-2 text-sm font-bold text-primary hover:underline"
                >
                  <ArrowLeftRight className="w-3.5 h-3.5" aria-hidden="true" />
                  Switch event
                </Link>
              </div>
              <SheetClose className="shrink-0 inline-flex items-center justify-center w-11 h-11 rounded-xl border text-foreground hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <X className="w-5 h-5" aria-hidden="true" />
                <span className="sr-only">Close menu</span>
              </SheetClose>
            </div>
            <div className="flex-1 overflow-y-auto overscroll-contain p-3 pb-[calc(env(safe-area-inset-bottom,0px)+16px)]">
              {renderNav(true)}
            </div>
          </DialogPrimitive.Content>
        </SheetPortal>
      </Sheet>

      <aside className="hidden md:block md:w-64 shrink-0">
        <div className="sticky top-24 bg-card border shadow-sm rounded-3xl p-4 flex flex-col gap-2">
          <div className="mb-4 px-4 pt-2 pb-4 border-b">
            <h2 className="font-bold text-lg truncate" title={reunion.name}>{reunion.name}</h2>
            <div className="text-xs text-muted-foreground font-mono mt-1">Event Code: {reunion.code}</div>
            <Link href="/organize/select-event" className="inline-flex py-3 text-sm font-bold text-primary hover:underline">
              Switch event
            </Link>
          </div>

          {renderNav(false)}
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
            body="You're a co-organizer for this reunion, but the owner hasn't given you any areas to manage yet. Once they do, they'll show up in the menu."
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
