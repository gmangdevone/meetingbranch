import { Link, useLocation } from "wouter";
import { Home, User, Edit3, LogOut, Shield, Plus, Key } from "lucide-react";
import { useAuth, useClerk } from "@clerk/react";
import { useAdminListReunions, getAdminListReunionsQueryKey } from "@workspace/api-client-react";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

export function Nav() {
  const [location] = useLocation();
  const { isSignedIn } = useAuth();
  const { signOut } = useClerk();
  
  const { data: adminReunions, isError } = useAdminListReunions({
    query: {
      queryKey: getAdminListReunionsQueryKey(),
      enabled: !!isSignedIn,
      retry: false,
      staleTime: 1000 * 60 * 5, // 5 minutes
    }
  });
  
  const isAdmin = !isError && !!adminReunions;

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
              <Link href="/create" className={`font-medium transition-colors hover:text-primary ${isActive('/create') ? "text-primary" : "text-foreground/70"}`}>
                Create
              </Link>
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
            <button
              onClick={() => signOut({ redirectUrl: basePath || "/" })}
              className="ml-4 flex items-center gap-2 text-sm font-medium px-4 py-2 bg-muted/50 rounded-full text-foreground/70 hover:text-destructive hover:bg-destructive/10 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
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
              { href: "/dashboard", label: "Dash", icon: User },
              { href: "/create", label: "Create", icon: Plus }
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
        </div>
      </div>
    </>
  );
}
