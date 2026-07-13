import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@clerk/react";
import { CalendarDays, Users, Plus, Key, ArrowRight } from "lucide-react";
import famjamHero from "@assets/generated_images/famjam-hero.jpg";

export function Home() {
  const { isSignedIn } = useAuth();

  return (
    <div className="flex flex-col gap-12 pb-12">
      {/* Hero Section */}
      <section className="relative rounded-3xl overflow-hidden shadow-xl">
        <div className="absolute inset-0 bg-black/50 z-10" />
        {/* We use a fallback if the generated image isn't available */}
        <div className="w-full h-[50vh] md:h-[60vh] bg-secondary/80 bg-cover bg-center" style={{ backgroundImage: `url(${famjamHero})` }} />
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center text-center p-6 text-white">
          <h2 className="font-serif italic text-xl md:text-3xl mb-4 tracking-wide text-primary-foreground/90">
            Gather your people.
          </h2>
          <h1 className="font-serif font-bold text-5xl md:text-7xl lg:text-8xl mb-6 drop-shadow-lg max-w-4xl leading-tight">
            The effortless way to run a family reunion.
          </h1>
          <p className="text-lg md:text-2xl font-medium max-w-2xl bg-black/20 backdrop-blur-md px-6 py-3 rounded-full border border-white/20 shadow-lg">
            Spin up a hub, share a code, get the headcount.
          </p>
        </div>
      </section>

      {/* Action Links */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-6 relative z-30 -mt-20 mx-4 md:mx-12">
        <Link href="/create" className="bg-card border shadow-xl rounded-3xl p-8 flex flex-col items-center text-center group hover:border-primary/50 transition-all hover:-translate-y-1">
          <div className="bg-primary/10 text-primary w-16 h-16 rounded-full flex items-center justify-center mb-6 group-hover:scale-110 group-hover:bg-primary group-hover:text-primary-foreground transition-all">
            <Plus className="w-8 h-8" />
          </div>
          <h3 className="font-serif text-3xl font-bold text-foreground mb-3">Create a Reunion</h3>
          <p className="text-muted-foreground mb-6 max-w-xs">
            Organizing the big event? Set up your itinerary, branches, and payment details in minutes.
          </p>
          <span className="mt-auto font-bold text-primary flex items-center">
            Get Started <ArrowRight className="ml-2 w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </span>
        </Link>

        <Link href="/join" className="bg-card border shadow-xl rounded-3xl p-8 flex flex-col items-center text-center group hover:border-secondary/50 transition-all hover:-translate-y-1">
          <div className="bg-secondary/10 text-secondary w-16 h-16 rounded-full flex items-center justify-center mb-6 group-hover:scale-110 group-hover:bg-secondary group-hover:text-secondary-foreground transition-all">
            <Key className="w-8 h-8" />
          </div>
          <h3 className="font-serif text-3xl font-bold text-foreground mb-3">Join a Reunion</h3>
          <p className="text-muted-foreground mb-6 max-w-xs">
            Got a 7-character code from your family? Enter it here to RSVP and see the schedule.
          </p>
          <span className="mt-auto font-bold text-secondary flex items-center">
            Enter Code <ArrowRight className="ml-2 w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </span>
        </Link>
      </section>

      {/* Features */}
      <section className="py-12 text-center max-w-4xl mx-auto">
        <h2 className="font-serif text-3xl md:text-4xl font-bold mb-12">Everything you need, nothing you don't.</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 text-left">
          <div>
            <div className="bg-muted w-12 h-12 rounded-xl flex items-center justify-center mb-4">
              <Users className="w-6 h-6 text-foreground" />
            </div>
            <h3 className="font-bold text-xl mb-2">Household RSVPs</h3>
            <p className="text-muted-foreground">Let one person register the whole immediate family. Track t-shirt sizes and dietary needs easily.</p>
          </div>
          <div>
            <div className="bg-muted w-12 h-12 rounded-xl flex items-center justify-center mb-4">
              <CalendarDays className="w-6 h-6 text-foreground" />
            </div>
            <h3 className="font-bold text-xl mb-2">Live Itinerary</h3>
            <p className="text-muted-foreground">No more messy group chats. Everyone sees the exact same schedule and locations in the app.</p>
          </div>
          <div>
            <div className="bg-muted w-12 h-12 rounded-xl flex items-center justify-center mb-4">
              <Key className="w-6 h-6 text-foreground" />
            </div>
            <h3 className="font-bold text-xl mb-2">Simple Access</h3>
            <p className="text-muted-foreground">Just share a short code. Grandparents can join instantly without navigating complicated invites.</p>
          </div>
        </div>
      </section>
    </div>
  );
}
