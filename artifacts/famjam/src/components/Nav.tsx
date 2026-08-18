import { Link, useLocation } from "wouter";
import { Home, User, LogOut, Shield, Plus, Key, ChevronDown } from "lucide-react";
import { useAuth, useUser, useClerk } from "@clerk/react";
import { useAdminListReunions, getAdminListReunionsQueryKey, useGetSettings } from "@workspace/api-client-react";
import { useEffect, useRef, useState } from "react";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
const isDevEnvironment = import.meta.env.DEV;

function DevBadge() {
  if (!isDevEnvironment) return null;
  return (
    <span
      title="You are viewing the development version of this app"
      style={{
        background: "#F59E0B",
        color: "#451A03",
        fontWeight: 800,
        fontSize: "0.65rem",
        letterSpacing: "0.08em",
        padding: "2px 8px",
        borderRadius: "9999px",
        textTransform: "uppercase",
      }}
    >
      Dev
    </span>
  );
}

import { useLastReunionCode } from "../lib/lastReunion";

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
      staleTime: 1000 * 60 * 5,
    }
  });

  const isAdmin = !isError && !!adminReunions;

  const { data: settings } = useGetSettings();
  const canCreateReunion = settings?.reunionCreationEnabled ?? false;

  const isActive = (href: string) => location === href;

  // If the user has entered a valid RSVP code, "Home" returns to that reunion hub
  const lastCode = useLastReunionCode();
  const homeHref = lastCode ? `/r/${lastCode}` : "/";

  // Mobile nav items
  const mobileLinks = [
    { href: homeHref, label: "Home", icon: Home },
    { href: "/join", label: "Join", icon: Key },
    ...(isSignedIn ? [
      { href: "/dashboard", label: "Dash", icon: Home },
      ...(canCreateReunion ? [{ href: "/create", label: "Create", icon: Plus }] : []),
      ...(isAdmin ? [{ href: "/admin", label: "Admin", icon: Shield }] : []),
    ] : [
      { href: "/sign-in", label: "Sign In", icon: LogOut },
    ]),
  ];

  return (
    <>
      {/* ── Desktop Top Nav ─────────────────────────────────────────── */}
      <div className="hidden md:flex items-center justify-between px-8 py-4 sticky top-0 z-50"
        style={{ background: "var(--fj-bg)", borderBottom: "1px solid var(--fj-line)", backdropFilter: "blur(8px)" }}>
        <div className="flex items-center gap-2.5">
          <Link href="/" style={{ color: "var(--fj-brand)", fontFamily: "var(--font-serif)", fontWeight: 600, fontSize: "1.5rem", letterSpacing: "-0.5px" }}>
            Meeting Branch
          </Link>
          <DevBadge />
        </div>
        <div className="flex items-center gap-6">
          {[
            { href: homeHref, label: "Home" },
            { href: "/join", label: "Join" },
            ...(isSignedIn ? [
              { href: "/dashboard", label: "Dashboard" },
              ...(canCreateReunion ? [{ href: "/create", label: "Create" }] : []),
            ] : []),
            { href: "/faq", label: "FAQ" },
          ].map((link) => (
            <Link key={link.href} href={link.href}
              style={{
                fontWeight: 700,
                fontSize: "0.875rem",
                color: isActive(link.href) ? "var(--fj-brand)" : "var(--fj-ink-soft)",
                transition: "color 0.15s",
              }}>
              {link.label}
            </Link>
          ))}

          {isAdmin && (
            <Link href="/admin"
              className="flex items-center gap-1"
              style={{
                fontWeight: 700,
                fontSize: "0.875rem",
                color: isActive("/admin") ? "var(--fj-brand)" : "var(--fj-ink-soft)",
              }}>
              <Shield style={{ width: 14, height: 14 }} /> Admin
            </Link>
          )}

          {isSignedIn ? (
            <div className="relative ml-2" ref={menuRef}>
              <button
                onClick={() => setMenuOpen((o) => !o)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                className="flex items-center gap-2 px-3 py-2 rounded-full transition-all"
                style={{
                  background: menuOpen ? "var(--fj-sky)" : "transparent",
                  border: "1.5px solid var(--fj-line)",
                  fontWeight: 700,
                  fontSize: "0.875rem",
                  color: "var(--fj-ink)",
                }}
              >
                <User style={{ width: 16, height: 16 }} />
                <span className="max-w-28 truncate">{user?.firstName || "Account"}</span>
                <ChevronDown style={{ width: 14, height: 14, opacity: 0.6 }} />
              </button>
              {menuOpen && (
                <div className="absolute right-0 mt-2 w-52 py-2 z-50"
                  style={{ background: "var(--fj-surface)", border: "1px solid var(--fj-line)", borderRadius: "var(--fj-r-card)", boxShadow: "var(--fj-shadow-pop)" }}
                  role="menu">
                  <div className="px-4 py-2 text-sm truncate" style={{ color: "var(--fj-ink-soft)", fontWeight: 600, borderBottom: "1px solid var(--fj-line)" }}>
                    {displayName}
                  </div>
                  <button
                    role="menuitem"
                    onClick={() => { setMenuOpen(false); signOut({ redirectUrl: basePath || "/" }); }}
                    className="w-full flex items-center gap-2 px-4 py-2 text-sm transition-colors"
                    style={{ fontWeight: 700, color: "var(--fj-ink-soft)" }}
                    onMouseEnter={e => (e.currentTarget.style.color = "#C24D6A")}
                    onMouseLeave={e => (e.currentTarget.style.color = "var(--fj-ink-soft)")}
                  >
                    <LogOut style={{ width: 14, height: 14 }} />
                    Sign Out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <Link href="/sign-in"
              className="px-4 py-2"
              style={{
                background: "var(--fj-accent)",
                color: "var(--fj-brand-deep)",
                fontWeight: 800,
                fontSize: "0.875rem",
                borderRadius: "var(--fj-r-btn)",
                boxShadow: "0 2px 0 var(--fj-accent-shadow)",
              }}>
              Sign In
            </Link>
          )}
        </div>
      </div>

      {/* ── Mobile Dev Badge (top of screen) ────────────────────────── */}
      {isDevEnvironment && (
        <div
          className="md:hidden fixed top-2 left-1/2 -translate-x-1/2 z-50 pointer-events-none"
          style={{ paddingTop: "env(safe-area-inset-top)" }}
        >
          <DevBadge />
        </div>
      )}

      {/* ── Mobile Bottom Nav ───────────────────────────────────────── */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-50"
        style={{
          background: "var(--fj-brand-gradient)",
          borderRadius: "20px 20px 0 0",
          boxShadow: "0 -4px 20px rgba(18,63,98,0.35)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}>
        <div className="flex items-center justify-around px-1 py-2">
          {mobileLinks.map((link) => {
            const Icon = link.icon;
            const active = isActive(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className="flex flex-col items-center py-1 px-2 min-w-[44px] min-h-[44px] justify-center"
                style={{ transition: "opacity 0.15s" }}
              >
                <Icon
                  style={{
                    width: 20,
                    height: 20,
                    color: active ? "var(--fj-accent-soft)" : "#9EBDD6",
                    transition: "color 0.15s",
                  }}
                />
                <span
                  style={{
                    fontSize: "10.5px",
                    fontWeight: 800,
                    marginTop: 3,
                    color: active ? "#ffffff" : "#9EBDD6",
                    transition: "color 0.15s",
                  }}
                >
                  {link.label}
                </span>
              </Link>
            );
          })}

          {/* Account button */}
          {isSignedIn && (
            <div className="relative" ref={mobileMenuRef}>
              <button
                onClick={() => setMobileMenuOpen((o) => !o)}
                aria-haspopup="menu"
                aria-expanded={mobileMenuOpen}
                className="flex flex-col items-center py-1 px-2 min-w-[44px] min-h-[44px] justify-center"
              >
                <User style={{ width: 20, height: 20, color: mobileMenuOpen ? "var(--fj-accent-soft)" : "#9EBDD6" }} />
                <span style={{ fontSize: "10.5px", fontWeight: 800, marginTop: 3, color: mobileMenuOpen ? "#fff" : "#9EBDD6", maxWidth: 56, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {user?.firstName || "Account"}
                </span>
              </button>
              {mobileMenuOpen && (
                <div className="absolute bottom-full right-0 mb-2 w-52 py-2 z-50"
                  style={{ background: "var(--fj-surface)", border: "1px solid var(--fj-line)", borderRadius: "var(--fj-r-card)", boxShadow: "var(--fj-shadow-pop)" }}
                  role="menu">
                  <div className="px-4 py-2 text-sm truncate" style={{ color: "var(--fj-ink-soft)", fontWeight: 600, borderBottom: "1px solid var(--fj-line)" }}>
                    {displayName}
                  </div>
                  <button
                    role="menuitem"
                    onClick={() => { setMobileMenuOpen(false); signOut({ redirectUrl: basePath || "/" }); }}
                    className="w-full flex items-center gap-2 px-4 py-2 text-sm transition-colors"
                    style={{ fontWeight: 700, color: "var(--fj-ink-soft)" }}
                    onMouseEnter={e => (e.currentTarget.style.color = "#C24D6A")}
                    onMouseLeave={e => (e.currentTarget.style.color = "var(--fj-ink-soft)")}
                  >
                    <LogOut style={{ width: 14, height: 14 }} /> Sign Out
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
