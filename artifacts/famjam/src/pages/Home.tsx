import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@clerk/react";
import famjamHero from "@assets/generated_images/famjam-hero.jpg";

export function Home() {
  const { isSignedIn } = useAuth();
  
  // Reunion Date: July 16, 2027 12:00:00
  const reunionDate = new Date("2027-07-16T12:00:00").getTime();
  const [timeLeft, setTimeLeft] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0 });

  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date().getTime();
      const distance = reunionDate - now;

      if (distance < 0) {
        clearInterval(timer);
        return;
      }

      setTimeLeft({
        days: Math.floor(distance / (1000 * 60 * 60 * 24)),
        hours: Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
        minutes: Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60)),
        seconds: Math.floor((distance % (1000 * 60)) / 1000),
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [reunionDate]);

  return (
    <div className="flex flex-col gap-8 pb-12">
      {/* Hero Section */}
      <section className="relative rounded-3xl overflow-hidden shadow-xl">
        <div className="absolute inset-0 bg-black/40 z-10" />
        <img 
          src={famjamHero} 
          alt="Lacey Family Reunion" 
          className="w-full h-[50vh] md:h-[60vh] object-cover object-center"
        />
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center text-center p-6 text-white">
          <h2 className="font-serif italic text-xl md:text-3xl mb-2 tracking-wide text-primary-foreground/90">
            Welcome to the official
          </h2>
          <h1 className="font-serif font-bold text-5xl md:text-7xl lg:text-8xl mb-6 drop-shadow-lg">
            Lacey Family Reunion
          </h1>
          <p className="text-lg md:text-2xl font-medium max-w-2xl bg-black/20 backdrop-blur-md px-6 py-3 rounded-full border border-white/20 shadow-lg">
            July 16–19, 2027 • Celebrating Our Roots
          </p>
        </div>
      </section>

      {/* Countdown Section */}
      <section className="bg-card border shadow-sm rounded-3xl p-8 text-center -mt-16 relative z-30 mx-4 md:mx-12">
        <h3 className="text-secondary font-bold tracking-widest uppercase text-sm mb-6">Countdown to FamJam</h3>
        <div className="flex justify-center gap-4 md:gap-8">
          {[
            { label: "Days", value: timeLeft.days },
            { label: "Hours", value: timeLeft.hours },
            { label: "Mins", value: timeLeft.minutes },
            { label: "Secs", value: timeLeft.seconds },
          ].map((item, i) => (
            <div key={item.label} className="flex flex-col items-center">
              <div className="bg-secondary text-secondary-foreground w-16 h-16 md:w-24 md:h-24 rounded-2xl flex items-center justify-center text-3xl md:text-5xl font-serif font-bold shadow-inner">
                {String(item.value).padStart(2, '0')}
              </div>
              <span className="text-xs md:text-sm font-medium mt-3 text-muted-foreground uppercase tracking-widest">{item.label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Action Links */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
        {!isSignedIn ? (
          <div className="bg-primary/10 border border-primary/20 rounded-3xl p-8 flex flex-col items-center text-center hover-elevate transition-all">
            <h3 className="font-serif text-3xl font-bold text-primary mb-3">Join the Family</h3>
            <p className="text-foreground/70 mb-6 max-w-xs">
              Sign in or create an account to register your immediate family for the 2027 reunion.
            </p>
            <Link href="/sign-in" className="bg-primary text-primary-foreground px-8 py-4 rounded-full font-bold text-lg shadow-md hover:bg-primary/90 transition-all w-full md:w-auto">
              Sign In to Register
            </Link>
          </div>
        ) : (
          <div className="bg-primary/10 border border-primary/20 rounded-3xl p-8 flex flex-col items-center text-center hover-elevate transition-all">
            <h3 className="font-serif text-3xl font-bold text-primary mb-3">You're In!</h3>
            <p className="text-foreground/70 mb-6 max-w-xs">
              Head to your dashboard to manage your registrations and view the family roster.
            </p>
            <Link href="/dashboard" className="bg-primary text-primary-foreground px-8 py-4 rounded-full font-bold text-lg shadow-md hover:bg-primary/90 transition-all w-full md:w-auto">
              Go to Dashboard
            </Link>
          </div>
        )}

        <div className="bg-secondary/10 border border-secondary/20 rounded-3xl p-8 flex flex-col items-center text-center hover-elevate transition-all">
          <h3 className="font-serif text-3xl font-bold text-secondary mb-3">The Itinerary</h3>
          <p className="text-foreground/70 mb-6 max-w-xs">
            From the opening picnic to the closing church service, see what we have planned.
          </p>
          <Link href="/schedule" className="bg-secondary text-secondary-foreground px-8 py-4 rounded-full font-bold text-lg shadow-md hover:bg-secondary/90 transition-all w-full md:w-auto">
            View Schedule
          </Link>
        </div>
      </section>
    </div>
  );
}
