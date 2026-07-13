import { Link, useLocation } from "wouter";
import { Home, CalendarDays, Bell, User, Edit3, LogOut, FileText, Shield } from "lucide-react";
import { useAuth, useClerk } from "@clerk/react";
import { useAdminGetReports, getAdminGetReportsQueryKey } from "@workspace/api-client-react";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

export function Nav() {
  const [location] = useLocation();
  const { isSignedIn } = useAuth();
  const { signOut } = useClerk();
  
  const { data: adminReports, isError } = useAdminGetReports({
    query: {
      queryKey: getAdminGetReportsQueryKey(),
      enabled: !!isSignedIn,
      retry: false,
      staleTime: 1000 * 60 * 5, // 5 minutes
    }
  });
  
  const isAdmin = !isError && !!adminReports;

  const links = [
    { href: "/", label: "Home", icon: Home },
    { href: "/schedule", label: "Schedule", icon: CalendarDays },
    { href: "/announcements", label: "News", icon: Bell },
    ...(isSignedIn
      ? [{ href: "/dashboard", label: "Dashboard", icon: User }]
      : [{ href: "/register", label: "Register", icon: Edit3 }]),
    ...(isAdmin
      ? [{ href: "/admin", label: "Admin", icon: Shield }]
      : []),
  ];

  const isActive = (href: string) => location === href;

  return (
    <>
      {/* Desktop Top Nav */}
      <div className="hidden md:flex items-center justify-between px-8 py-4 bg-background border-b sticky top-0 z-50">
        <Link href="/" className="flex items-center gap-2 text-primary font-serif font-bold text-2xl">
          FamJam '27
        </Link>
        <div className="flex items-center gap-6">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`font-medium transition-colors hover:text-primary ${
                isActive(link.href) ? "text-primary" : "text-foreground/70"
              }`}
            >
              {link.label}
            </Link>
          ))}
          <Link href="/faq" className={`font-medium transition-colors hover:text-primary ${isActive('/faq') ? "text-primary" : "text-foreground/70"}`}>
            FAQ
          </Link>

          {isSignedIn ? (
            <button
              onClick={() => signOut({ redirectUrl: basePath || "/" })}
              className="ml-4 flex items-center gap-2 text-sm font-medium text-foreground/70 hover:text-destructive transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
          ) : (
            <Link
              href="/sign-in"
              className="ml-4 px-4 py-2 bg-primary text-primary-foreground rounded-full font-medium hover:bg-primary/90 transition-colors"
            >
              Sign In
            </Link>
          )}
        </div>
      </div>

      {/* Mobile Bottom Nav */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-background border-t pb-safe z-50">
        <div className="flex items-center justify-around p-2">
          {links.map((link) => {
            const Icon = link.icon;
            const active = isActive(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`flex flex-col items-center p-2 rounded-xl transition-all ${
                  active ? "text-primary scale-110" : "text-foreground/50 hover:text-foreground/80"
                }`}
              >
                <Icon className={`w-6 h-6 ${active ? "fill-primary/20" : ""}`} />
                <span className="text-[10px] font-medium mt-1">{link.label}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </>
  );
}
