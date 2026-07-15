import { Link, useLocation } from "wouter";
import { Home, User, LogOut, Shield, Plus, Key, ChevronDown } from "lucide-react";
import { useAuth, useUser, useClerk } from "@clerk/react";
import { useAdminListReunions, getAdminListReunionsQueryKey, useGetSettings } from "@workspace/api-client-react";
import { useEffect, useRef, useState } from "react";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

export function Nav() {
  const [location] = useLocation();
  const { isSignedIn } = useAuth();
  const { user } = useUser();
  const { signOut } = useClerk();
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const mobileMenuRef = useRef<HTMLDivElement>(null);

  const displayName =
    user?.fullName ||
    [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
    user?.primaryEmailAddress?.emailAddress ||
    "Account";

  useEffect(() => {
    if (!menuOpen && !mobileMenuOpen) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(e.target as Node)) setMobileMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen, mobileMenuOpen]);
  
  const { data: adminReunions, isError } = useAdminListReunions({
    query: {
      queryKey: getAdminListReunionsQueryKey(),
      enabled: !!isSignedIn,
      retry: false,
      staleTime: 1000 * 60 * 5, // 5 minutes
    }
  });
  
  const isAdmin = !isError && !!adminReunions;

  const { data: settings } = useGetSettings();
  const canCreateReunion = settings?.reunionCreationEnabled ?? false;

  const isActive = (href: string) => location === href;

  return (
    <>
      {/* Desktop Top Nav */}
      <div className="hidden md:flex items-center justify-between px-8 py-4 bg-background/95 backdrop-blur-sm border-b sticky top-0 z-50">
        <Link href="/" className="flex items-center gap-2 text-primary font-serif font-bold text-2xl tracking-tight">
          FamJam
        </Link>
        <div className="flex items-center gap-6">
          <Link href="/" className={`font-medium transition-colors hover:text-primary ${isActive('/') ? "text-primary" : "text-foreground/70"}`}>
            Home
          </Link>
          
          <Link href="/join" className={`font-medium transition-colors hover:text-primary ${isActive('/join') ? "text-primary" : "text-foreground/70"}`}>
            Join
          </Link>

          {isSignedIn && (
            <>
              <Link href="/dashboard" className={`font-medium transition-colors hover:text-primary ${isActive('/dashboard') ? "text-primary" : "text-foreground/70"}`}>
                Dashboard
              </Link>
              {canCreateReunion && (
                <Link href="/create" className={`font-medium transition-colors hover:text-primary ${isActive('/create') ? "text-primary" : "text-foreground/70"}`}>
                  Create
                </Link>
              )}
            </>
          )}

          {isAdmin && (
            <Link href="/admin" className={`font-medium transition-colors hover:text-primary flex items-center ${isActive('/admin') ? "text-primary" : "text-foreground/70"}`}>
              <Shield className="w-4 h-4 mr-1" /> Admin
            </Link>
          )}

          <Link href="/faq" className={`font-medium transition-colors hover:text-primary ${isActive('/faq') ? "text-primary" : "text-foreground/70"}`}>
            FAQ
          </Link>

          {isSignedIn ? (
            <div className="relative ml-4" ref={menuRef}>
              <button
                onClick={() => setMenuOpen((o) => !o)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                className="flex items-center gap-2 text-sm font-medium px-4 py-2 bg-muted/50 rounded-full text-foreground/80 hover:bg-muted transition-colors"
              >
                <User className="w-4 h-4" />
                {displayName}
                <ChevronDown className={`w-4 h-4 transition-transform ${menuOpen ? "rotate-180" : ""}`} />
              </button>
              {menuOpen && (
                <div className="absolute right-0 mt-2 w-48 rounded-2xl border bg-background shadow-lg py-2 z-50" role="menu">
                  <button
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      signOut({ redirectUrl: basePath || "/" });
                    }}
                    className="w-full flex items-center gap-2 px-4 py-2 text-sm font-medium text-foreground/70 hover:text-destructive hover:bg-destructive/10 transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                    Sign Out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <Link
              href="/sign-in"
              className="ml-4 px-5 py-2 bg-primary text-primary-foreground rounded-full font-bold hover:bg-primary/90 transition-colors shadow-sm"
            >
              Sign In
            </Link>
          )}
        </div>
      </div>

      {/* Mobile Bottom Nav */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-background border-t pb-safe z-50">
        <div className="flex items-center justify-around p-2">
          {[
            { href: "/", label: "Home", icon: Home },
            { href: "/join", label: "Join", icon: Key },
            ...(isSignedIn ? [
              { href: "/dashboard", label: "Dash", icon: Home },
              ...(canCreateReunion ? [{ href: "/create", label: "Create", icon: Plus }] : [])
            ] : [
              { href: "/sign-in", label: "Sign In", icon: LogOut } // Using LogOut icon as placeholder for sign in
            ])
          ].map((link) => {
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
                <Icon className={`w-6 h-6 ${active ? "fill-primary/10" : ""}`} />
                <span className="text-[10px] font-bold mt-1">{link.label}</span>
              </Link>
            );
          })}
          {isSignedIn && (
            <div className="relative" ref={mobileMenuRef}>
              <button
                onClick={() => setMobileMenuOpen((o) => !o)}
                aria-haspopup="menu"
                aria-expanded={mobileMenuOpen}
                className={`flex flex-col items-center p-2 rounded-xl transition-all ${
                  mobileMenuOpen ? "text-primary" : "text-foreground/50 hover:text-foreground/80"
                }`}
              >
                <User className="w-6 h-6" />
                <span className="text-[10px] font-bold mt-1 max-w-16 truncate">
                  {user?.firstName || "Account"}
                </span>
              </button>
              {mobileMenuOpen && (
                <div className="absolute bottom-full right-0 mb-2 w-52 rounded-2xl border bg-background shadow-lg py-2 z-50" role="menu">
                  <div className="px-4 py-2 text-sm font-medium text-foreground/80 border-b truncate">
                    {displayName}
                  </div>
                  <button
                    role="menuitem"
                    onClick={() => {
                      setMobileMenuOpen(false);
                      signOut({ redirectUrl: basePath || "/" });
                    }}
                    className="w-full flex items-center gap-2 px-4 py-2 text-sm font-medium text-foreground/70 hover:text-destructive hover:bg-destructive/10 transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                    Sign Out
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
