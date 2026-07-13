import { Link, useLocation } from "wouter";
import { Home, Users, BarChart2, Bell, Calendar, Shield, Ticket, Menu, X } from "lucide-react";
import { ReactNode, useState } from "react";

export function AdminLayout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const links = [
    { href: "/admin", label: "Overview", icon: Shield },
    { href: "/admin/registrations", label: "Registrations", icon: Ticket },
    { href: "/admin/reports", label: "Reports", icon: BarChart2 },
    { href: "/admin/announcements", label: "Announcements", icon: Bell },
    { href: "/admin/schedule", label: "Schedule", icon: Calendar },
    { href: "/admin/users", label: "Users", icon: Users },
  ];

  const isActive = (href: string) => {
    if (href === "/admin") return location === "/admin";
    return location.startsWith(href);
  };

  return (
    <div className="min-h-[100dvh] flex flex-col md:flex-row bg-muted/30">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex flex-col w-64 bg-card border-r fixed top-0 bottom-0 z-10">
        <div className="p-6 border-b">
          <Link href="/" className="flex items-center gap-2 text-primary font-serif font-bold text-2xl">
            FamJam '27
          </Link>
          <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider mt-1">Admin Portal</div>
        </div>
        <nav className="flex-1 p-4 flex flex-col gap-2 overflow-y-auto">
          {links.map((link) => {
            const active = isActive(link.href);
            const Icon = link.icon;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-all ${
                  active 
                    ? "bg-primary text-primary-foreground shadow-md" 
                    : "text-foreground/70 hover:bg-muted hover:text-foreground"
                }`}
              >
                <Icon className="w-5 h-5" />
                {link.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Mobile Top Bar */}
      <div className="md:hidden flex items-center justify-between p-4 bg-card border-b sticky top-0 z-20">
        <div className="flex items-center gap-2 text-primary font-serif font-bold text-xl">
          Admin Portal
        </div>
        <button 
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="p-2 -mr-2 text-foreground/70 hover:text-foreground"
        >
          {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {/* Mobile Menu Dropdown */}
      {mobileMenuOpen && (
        <div className="md:hidden fixed top-[65px] bottom-0 left-0 right-0 bg-card z-20 border-b flex flex-col p-4 gap-2 overflow-y-auto">
          {links.map((link) => {
            const active = isActive(link.href);
            const Icon = link.icon;
            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileMenuOpen(false)}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-all ${
                  active 
                    ? "bg-primary text-primary-foreground shadow-md" 
                    : "text-foreground/70 hover:bg-muted hover:text-foreground"
                }`}
              >
                <Icon className="w-5 h-5" />
                {link.label}
              </Link>
            );
          })}
          <Link href="/" className="flex items-center gap-3 px-4 py-3 rounded-xl font-medium text-foreground/70 hover:bg-muted hover:text-foreground mt-4 border-t pt-6">
            <Home className="w-5 h-5" />
            Back to Main Site
          </Link>
        </div>
      )}

      {/* Main Content Area */}
      <main className="flex-1 md:ml-64 p-4 md:p-8 animate-in fade-in duration-300">
        <div className="max-w-6xl mx-auto">
          {children}
        </div>
      </main>

      {/* Bottom Nav for mobile - optional since we added menu, but let's stick to simple tab style if preferred? The menu is better for 6 items. Let's keep the menu. */}
    </div>
  );
}
