import { useLocation } from "wouter";
import { useGetRegistration, getGetRegistrationQueryKey } from "@workspace/api-client-react";
import { format } from "date-fns";
import { ArrowLeft, Users, CreditCard, ExternalLink, CalendarDays } from "lucide-react";
import { Skeleton } from "../components/ui/skeleton";
import { Button } from "../components/ui/button";

export function RegistrationDetail({ params }: { params: { id: string } }) {
  const [, setLocation] = useLocation();
  const id = parseInt(params.id, 10);

  const { data: reg, isLoading, isError } = useGetRegistration(id, {
    query: { enabled: !isNaN(id), retry: false, queryKey: getGetRegistrationQueryKey(id) }
  });

  if (isLoading) {
    return (
      <div className="max-w-2xl mx-auto py-12">
        <Skeleton className="h-10 w-32 mb-8" />
        <Skeleton className="h-64 rounded-3xl mb-6" />
        <Skeleton className="h-48 rounded-3xl" />
      </div>
    );
  }

  if (isError || !reg) {
    return (
      <div className="text-center py-20">
        <h1 className="text-2xl font-bold">Registration Not Found</h1>
        <Button onClick={() => setLocation("/dashboard")} className="mt-4">Back to Dashboard</Button>
      </div>
    );
  }

  const isPaid = reg.paymentStatus === 'paid' || reg.paymentStatus === 'waived';

  return (
    <div className="max-w-2xl mx-auto py-8">
      <Button 
        variant="ghost" 
        onClick={() => setLocation("/dashboard")} 
        className="mb-6 -ml-4 text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="w-4 h-4 mr-2" /> Back to Dashboard
      </Button>

      <div className="flex flex-col gap-6">
        <div className="bg-card border shadow-md rounded-3xl overflow-hidden">
          <div className="bg-primary p-8 text-primary-foreground relative">
            <div className="absolute top-8 right-8">
              <div className={`px-4 py-1.5 rounded-full text-sm font-bold uppercase tracking-wider ${
                reg.paymentStatus === 'paid' ? 'bg-white text-green-700' :
                reg.paymentStatus === 'waived' ? 'bg-white/20 text-white' :
                'bg-amber-400 text-amber-950'
              }`}>
                {reg.paymentStatus}
              </div>
            </div>
            
            <p className="text-primary-foreground/80 text-sm font-medium uppercase tracking-widest mb-2">Registration Ticket</p>
            <h1 className="font-serif text-3xl md:text-4xl font-bold mb-6 pr-24">{reg.reunionName || `Reunion ${reg.reunionCode}`}</h1>
            
            <div className="flex items-center gap-6 text-primary-foreground/90">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5" />
                <span className="font-medium">{reg.attendeeCount} People</span>
              </div>
              <div className="flex items-center gap-2">
                <CalendarDays className="w-5 h-5" />
                <span className="font-medium">Branch: {reg.branchName}</span>
              </div>
            </div>
          </div>
          
          <div className="p-8">
            <h3 className="font-bold text-sm uppercase tracking-widest text-muted-foreground mb-4">Attendees</h3>
            <div className="divide-y">
              {reg.attendees.map(attendee => (
                <div key={attendee.id} className="py-3 flex justify-between items-center first:pt-0 last:pb-0">
                  <div>
                    <div className="font-bold text-foreground">{attendee.name}</div>
                    {attendee.dietaryRestrictions && (
                      <div className="text-sm text-muted-foreground">Diet: {attendee.dietaryRestrictions}</div>
                    )}
                  </div>
                  <div className="bg-muted px-3 py-1 rounded-lg text-sm font-medium">
                    Size: {attendee.shirtSize}
                  </div>
                </div>
              ))}
            </div>
            
            <div className="mt-8 pt-6 border-t flex justify-center">
              <Button onClick={() => setLocation(`/r/${reg.reunionCode}`)} variant="outline" className="rounded-xl w-full sm:w-auto">
                Go to Reunion Hub
              </Button>
            </div>
          </div>
        </div>

        {!isPaid && (
          <div className="bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-900/30 rounded-3xl p-8 flex flex-col items-center text-center animate-in slide-in-from-bottom-4">
            <div className="bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-500 w-16 h-16 rounded-full flex items-center justify-center mb-4">
              <CreditCard className="w-8 h-8" />
            </div>
            <h3 className="font-bold text-xl mb-2 text-amber-900 dark:text-amber-500">Payment Pending</h3>
            <p className="text-amber-700 dark:text-amber-600/80 mb-6 max-w-md">
              Your registration is saved, but you still need to pay the organizer to complete it. They will update your status once payment is received.
            </p>
            
            <div className="bg-white dark:bg-background border border-amber-200 dark:border-amber-900/30 rounded-xl p-4 w-full text-left">
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-1">Send payment to</p>
              <p className="font-mono text-xl font-bold mb-4">{/* Fallback generic text since we don't have reunion info directly on reg object without fetching reunion */}
                 See Reunion Hub for payment details
              </p>
              <Button onClick={() => setLocation(`/r/${reg.reunionCode}`)} className="w-full bg-amber-500 hover:bg-amber-600 text-white rounded-lg">
                View Payment Instructions
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
