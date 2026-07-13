import { Link, useLocation } from "wouter";
import { useGetReunionByCode, getGetReunionByCodeQueryKey } from "@workspace/api-client-react";
import { format } from "date-fns";
import { CalendarDays, DollarSign, MapPin, Users, Edit3, ArrowRight, Home } from "lucide-react";
import { Skeleton } from "../components/ui/skeleton";
import { Button } from "../components/ui/button";
import { describeFee } from "../lib/fees";

export function ReunionHub({ params }: { params: { code: string } }) {
  const code = params.code?.toUpperCase();
  const [, setLocation] = useLocation();

  const { data: reunion, isLoading, isError } = useGetReunionByCode(code, {
    query: { 
      enabled: !!code,
      retry: false
    , queryKey: getGetReunionByCodeQueryKey(code) }
  });

  if (isLoading) {
    return (
      <div className="max-w-3xl mx-auto py-12">
        <Skeleton className="h-40 rounded-3xl mb-8" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Skeleton className="h-64 rounded-3xl" />
          <Skeleton className="h-64 rounded-3xl" />
        </div>
      </div>
    );
  }

  if (isError || !reunion) {
    return (
      <div className="max-w-xl mx-auto py-20 text-center">
        <h1 className="font-serif text-5xl font-bold mb-4">Reunion Not Found</h1>
        <p className="text-lg text-muted-foreground mb-8">
          We couldn't find a reunion with the code <span className="font-mono font-bold bg-muted px-2 py-1 rounded">{code}</span>.
        </p>
        <Button onClick={() => setLocation("/join")} variant="outline" size="lg" className="rounded-full">
          Try another code
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 pb-12 animate-in fade-in zoom-in-95 duration-500">
      <div className="relative rounded-3xl overflow-hidden bg-primary shadow-xl text-primary-foreground p-8 md:p-12">
        <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
          <Users className="w-64 h-64" />
        </div>
        <div className="relative z-10">
          <div className="inline-block bg-white/20 backdrop-blur-sm px-4 py-1.5 rounded-full text-sm font-bold tracking-widest uppercase mb-6">
            Code: <span className="font-mono ml-1">{reunion.code}</span>
          </div>
          <h1 className="font-serif text-5xl md:text-6xl font-bold mb-4 drop-shadow-md">
            {reunion.name}
          </h1>
          <div className="flex flex-wrap gap-6 text-lg font-medium">
            <div className="flex items-center gap-2">
              <CalendarDays className="w-5 h-5" />
              <span>
                {format(new Date(reunion.startDate), 'MMM d')} – {format(new Date(reunion.endDate), 'MMM d, yyyy')}
              </span>
            </div>
            {reunion.fees.length > 0 && (
              <div className="flex items-center gap-2">
                <DollarSign className="w-5 h-5" />
                <span>
                  {reunion.fees.length === 1
                    ? describeFee(reunion.fees[0])
                    : `${reunion.fees.length} fees & dues`}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 flex flex-col gap-6">
          <div className="bg-card border shadow-sm rounded-3xl p-8">
            <h2 className="font-serif text-2xl font-bold mb-4">Welcome to the Hub</h2>
            <p className="text-muted-foreground text-lg mb-8">
              This is the central location for everything related to {reunion.name}. Be sure to register your household so we have a final headcount for food and activities!
            </p>
            
            <Link href={`/r/${reunion.code}/register`} className="block w-full">
              <Button className="w-full rounded-2xl py-8 text-xl font-bold shadow-md hover:-translate-y-1 transition-all group">
                <Edit3 className="mr-3 w-6 h-6 group-hover:rotate-12 transition-transform" />
                Register My Household
              </Button>
            </Link>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Link href={`/r/${reunion.code}/schedule`} className="bg-secondary/10 border border-secondary/20 rounded-3xl p-8 flex flex-col items-start hover:bg-secondary/20 transition-colors group">
              <div className="bg-secondary text-secondary-foreground w-12 h-12 rounded-full flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <CalendarDays className="w-6 h-6" />
              </div>
              <h3 className="font-serif text-2xl font-bold mb-2">Schedule</h3>
              <p className="text-muted-foreground mb-4">View the full itinerary and locations for all events.</p>
              <span className="mt-auto font-bold text-secondary flex items-center">
                View Itinerary <ArrowRight className="ml-2 w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </span>
            </Link>

            <Link href={`/r/${reunion.code}/announcements`} className="bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-900/30 rounded-3xl p-8 flex flex-col items-start hover:bg-amber-100 dark:hover:bg-amber-900/20 transition-colors group">
              <div className="bg-amber-500 text-white w-12 h-12 rounded-full flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <Users className="w-6 h-6" />
              </div>
              <h3 className="font-serif text-2xl font-bold mb-2">Announcements</h3>
              <p className="text-muted-foreground mb-4">Read updates and important news from the organizers.</p>
              <span className="mt-auto font-bold text-amber-700 dark:text-amber-500 flex items-center">
                Read News <ArrowRight className="ml-2 w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </span>
            </Link>
          </div>
        </div>

        <div className="lg:col-span-1">
          <div className="bg-muted/50 border rounded-3xl p-6 sticky top-24">
            <h3 className="font-bold text-sm uppercase tracking-widest text-muted-foreground mb-6">Payment Info</h3>
            {reunion.fees.length === 0 ? (
              <p className="text-foreground font-medium">This reunion is free to attend!</p>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-3 pb-4 border-b">
                  {reunion.fees.map((fee) => (
                    <div key={fee.id} className="flex justify-between items-start gap-3">
                      <span className="text-muted-foreground">
                        {fee.label}
                        {fee.isOptional && (
                          <span className="ml-1 text-xs text-muted-foreground/70">(optional)</span>
                        )}
                        <span className="block text-xs text-muted-foreground/70">
                          {describeFee(fee)}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
                <div>
                  <span className="text-muted-foreground text-sm block mb-1">Send payments to</span>
                  <div className="font-mono bg-background border px-3 py-2 rounded-lg font-bold">
                    {reunion.paymentHandle}
                  </div>
                </div>
                {reunion.paymentUrl && (
                  <a href={reunion.paymentUrl} target="_blank" rel="noopener noreferrer" className="text-primary font-bold text-sm hover:underline flex items-center">
                    Pay Online <ArrowRight className="ml-1 w-3 h-3" />
                  </a>
                )}
              </div>
            )}
            
            <div className="mt-8 pt-6 border-t">
              <Link href="/dashboard" className="flex items-center text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
                <Home className="w-4 h-4 mr-2" /> Back to Dashboard
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
