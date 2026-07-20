import { Link } from "wouter";
import { useAuth } from "@clerk/react";
import { useGetSettings } from "@workspace/api-client-react";
import { CalendarDays, Users, Key, ArrowRight, MapPin } from "lucide-react";

// Bunting SVG — signature element, used once on home only
function BuntingBanner() {
  return (
    <svg viewBox="0 0 320 34" width="100%" height="30" preserveAspectRatio="none" aria-hidden="true">
      <path d="M0 4 Q160 20 320 4" stroke="#123F62" strokeWidth="2" fill="none" opacity=".5"/>
      <path d="M3 6 L37 6 L20 30 Z"     fill="#E8A020"/>
      <path d="M43 6 L77 6 L60 30 Z"    fill="#C24D6A"/>
      <path d="M83 6 L117 6 L100 30 Z"  fill="#2E7DB0"/>
      <path d="M123 6 L157 6 L140 30 Z" fill="#E8A020"/>
      <path d="M163 6 L197 6 L180 30 Z" fill="#C24D6A"/>
      <path d="M203 6 L237 6 L220 30 Z" fill="#2E7DB0"/>
      <path d="M243 6 L277 6 L260 30 Z" fill="#E8A020"/>
      <path d="M283 6 L317 6 L300 30 Z" fill="#C24D6A"/>
    </svg>
  );
}

export function Home() {
  const { isSignedIn } = useAuth();
  const { data: settings, isLoading: loadingSettings } = useGetSettings();
  const canCreateReunion = settings?.reunionCreationEnabled ?? false;

  return (
    <div className="flex flex-col gap-0 pb-12">

      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section
        className="relative overflow-hidden flex flex-col"
        style={{
          background: "var(--fj-brand-gradient)",
          borderRadius: "0 0 26px 26px",
          paddingBottom: 32,
        }}
      >
        {/* Bunting */}
        <div style={{ width: "100%", lineHeight: 0 }}>
          <BuntingBanner />
        </div>

        {/* Copy */}
        <div className="flex flex-col items-center text-center px-6 pt-4 gap-3">
          <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: "1.5px", textTransform: "uppercase", color: "var(--fj-accent-soft)" }}>
            Family Reunion Hub
          </p>
          <h1
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: "clamp(2rem, 8vw, 3.5rem)",
              fontWeight: 600,
              color: "#fff",
              lineHeight: 1.15,
              letterSpacing: "-0.5px",
              maxWidth: 520,
            }}
          >
            Gather your people.
          </h1>
          <p style={{ fontSize: 15, fontWeight: 600, color: "#9EBDD6", maxWidth: 340, lineHeight: 1.5 }}>
            Spin up a hub, share a code, get the headcount — all in one place.
          </p>
          <div className="flex items-center gap-1 mt-1" style={{ color: "#9EBDD6", fontSize: 13, fontWeight: 700 }}>
            <MapPin style={{ width: 14, height: 14 }} />
            <span>Wherever family gathers</span>
          </div>
        </div>
      </section>

      {/* ── CTA Cards ────────────────────────────────────────────────── */}
      <div className="px-5 mt-[-16px] flex flex-col gap-3">
        {/* Join — primary CTA */}
        <Link
          href="/join"
          className="flex items-center justify-between px-5 py-4 transition-all active:scale-[0.98]"
          style={{
            background: "var(--fj-accent)",
            borderRadius: "var(--fj-r-card)",
            boxShadow: "0 2px 0 var(--fj-accent-shadow)",
            color: "var(--fj-brand-deep)",
            fontWeight: 800,
            fontSize: 16,
            textDecoration: "none",
          }}
        >
          <div className="flex items-center gap-3">
            <Key style={{ width: 20, height: 20 }} />
            <div>
              <div style={{ fontWeight: 800 }}>Join a Reunion</div>
              <div style={{ fontWeight: 600, fontSize: 12, opacity: 0.7 }}>Got a 7-character code?</div>
            </div>
          </div>
          <ArrowRight style={{ width: 18, height: 18 }} />
        </Link>

        {/* Create — secondary CTA (only if enabled) */}
        {!loadingSettings && canCreateReunion && (
          <Link
            href="/create"
            className="flex items-center justify-between px-5 py-4 transition-all active:scale-[0.98]"
            style={{
              background: "var(--fj-surface)",
              border: "1px solid var(--fj-line)",
              borderRadius: "var(--fj-r-card)",
              boxShadow: "var(--fj-shadow-card)",
              color: "var(--fj-brand)",
              fontWeight: 800,
              fontSize: 16,
              textDecoration: "none",
            }}
          >
            <div className="flex items-center gap-3">
              <CalendarDays style={{ width: 20, height: 20, color: "var(--fj-brand)" }} />
              <div>
                <div style={{ fontWeight: 800, color: "var(--fj-ink)" }}>Create a Reunion</div>
                <div style={{ fontWeight: 600, fontSize: 12, color: "var(--fj-ink-soft)" }}>Start organizing your family event</div>
              </div>
            </div>
            <ArrowRight style={{ width: 18, height: 18, color: "var(--fj-brand)" }} />
          </Link>
        )}

        {/* Dashboard — signed-in shortcut */}
        {isSignedIn && (
          <Link
            href="/dashboard"
            className="flex items-center justify-between px-5 py-4 transition-all active:scale-[0.98]"
            style={{
              background: "var(--fj-surface)",
              border: "1px solid var(--fj-line)",
              borderRadius: "var(--fj-r-card)",
              boxShadow: "var(--fj-shadow-card)",
              textDecoration: "none",
            }}
          >
            <div className="flex items-center gap-3">
              <Users style={{ width: 20, height: 20, color: "var(--fj-brand)" }} />
              <div>
                <div style={{ fontWeight: 800, color: "var(--fj-ink)" }}>My Reunions</div>
                <div style={{ fontWeight: 600, fontSize: 12, color: "var(--fj-ink-soft)" }}>View your registrations & events</div>
              </div>
            </div>
            <ArrowRight style={{ width: 18, height: 18, color: "var(--fj-brand)" }} />
          </Link>
        )}
      </div>

      {/* ── Quick-feature tiles ───────────────────────────────────────── */}
      <section className="px-5 mt-8">
        <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: "1.5px", textTransform: "uppercase", color: "var(--fj-accent)", marginBottom: 12 }}>
          Everything you need
        </p>
        <div className="grid grid-cols-2 gap-3">
          {[
            { icon: Users, title: "Household RSVPs", desc: "One person, whole family" },
            { icon: CalendarDays, title: "Live Itinerary", desc: "Shared schedule in the app" },
            { icon: Key, title: "Simple Access", desc: "Just share a short code" },
            { icon: CalendarDays, title: "Fund & Polls", desc: "Sponsorship + live voting" },
          ].map(({ icon: Icon, title, desc }) => (
            <div
              key={title}
              className="flex flex-col gap-2 p-4"
              style={{
                background: "var(--fj-surface)",
                border: "1px solid var(--fj-line)",
                borderRadius: "var(--fj-r-tile)",
                boxShadow: "var(--fj-shadow-card)",
              }}
            >
              <div
                className="flex items-center justify-center"
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  background: "var(--fj-sky)",
                }}
              >
                <Icon style={{ width: 18, height: 18, color: "var(--fj-brand)" }} />
              </div>
              <div style={{ fontWeight: 800, fontSize: 13, color: "var(--fj-ink)" }}>{title}</div>
              <div style={{ fontWeight: 600, fontSize: 11, color: "var(--fj-ink-soft)", lineHeight: 1.4 }}>{desc}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
