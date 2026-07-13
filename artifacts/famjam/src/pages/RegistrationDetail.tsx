import { useGetRegistration } from "@workspace/api-client-react";
import { useParams, Link } from "wouter";
import { ArrowLeft, Ticket, CheckCircle2, User, Shirt, Heart, DollarSign } from "lucide-react";
import { format } from "date-fns";
import { getGetRegistrationQueryKey } from "@workspace/api-client-react";

export function RegistrationDetail() {
  const params = useParams();
  const id = Number(params.id);
  
  const { data: registration, isLoading } = useGetRegistration(id, {
    query: { enabled: !!id, queryKey: getGetRegistrationQueryKey(id) }
  });

  if (isLoading) {
    return (
      <div className="max-w-3xl mx-auto animate-pulse flex flex-col gap-6">
        <div className="h-8 w-24 bg-muted rounded-lg" />
        <div className="h-40 bg-muted rounded-3xl" />
        <div className="h-64 bg-muted rounded-3xl" />
      </div>
    );
  }

  if (!registration) {
    return (
      <div className="max-w-3xl mx-auto text-center py-20">
        <h2 className="text-2xl font-bold text-destructive mb-2">Registration Not Found</h2>
        <Link href="/dashboard" className="text-primary font-bold hover:underline">Return to Dashboard</Link>
      </div>
    );
  }

  const totalDue = registration.attendeeCount * 50;

  return (
    <div className="max-w-3xl mx-auto pb-12">
      <Link href="/dashboard" className="inline-flex items-center gap-2 text-muted-foreground hover:text-primary font-bold mb-8 transition-colors">
        <ArrowLeft className="w-4 h-4" />
        Back to Dashboard
      </Link>

      <div className="bg-secondary text-secondary-foreground rounded-3xl p-8 shadow-xl relative overflow-hidden mb-8">
        <div className="absolute -right-12 -top-12 opacity-10">
          <Ticket className="w-48 h-48" />
        </div>
        
        <div className="relative z-10">
          <div className="inline-flex items-center gap-2 bg-white/20 backdrop-blur-sm px-4 py-1.5 rounded-full text-sm font-bold mb-6">
            <CheckCircle2 className="w-4 h-4" />
            Registration Confirmed
          </div>
          
          <h1 className="font-serif text-4xl md:text-5xl font-bold mb-2">
            {registration.attendees[0]?.name || 'Family'}'s Party
          </h1>
          <p className="text-secondary-foreground/80 font-medium text-lg">
            {registration.siblingName} Branch • Registered on {format(new Date(registration.createdAt), "MMMM d, yyyy")}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="md:col-span-2 space-y-6">
          <h2 className="font-serif text-2xl font-bold text-foreground">Guest List ({registration.attendeeCount})</h2>
          
          <div className="flex flex-col gap-4">
            {registration.attendees.map((attendee) => (
              <div key={attendee.id} className="bg-card border shadow-sm rounded-2xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-primary/10 text-primary rounded-full flex items-center justify-center flex-shrink-0">
                    <User className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="font-bold text-lg">{attendee.name}</h3>
                    {attendee.dietaryRestrictions && (
                      <p className="text-sm text-muted-foreground flex items-center gap-1.5 mt-1">
                        <Heart className="w-3.5 h-3.5" />
                        {attendee.dietaryRestrictions}
                      </p>
                    )}
                  </div>
                </div>
                
                <div className="flex items-center gap-2 bg-input/30 px-3 py-1.5 rounded-full text-sm font-bold text-foreground self-start md:self-auto">
                  <Shirt className="w-4 h-4 text-muted-foreground" />
                  Size {attendee.shirtSize}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="md:col-span-1 space-y-6">
          <div className="bg-accent/20 border border-accent/30 rounded-3xl p-6 sticky top-24">
            <h3 className="font-serif text-xl font-bold text-foreground mb-4 flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-accent-foreground" />
              Payment Info
            </h3>
            
            <div className="space-y-3 mb-6">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Fee per person</span>
                <span className="font-bold">$50.00</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Number of guests</span>
                <span className="font-bold">× {registration.attendeeCount}</span>
              </div>
              <div className="border-t border-accent/30 pt-3 flex justify-between">
                <span className="font-bold text-foreground">Total Due</span>
                <span className="font-bold text-xl text-foreground">${totalDue}.00</span>
              </div>
            </div>

            <a 
              href="https://cash.app/$goudycgp"
              target="_blank"
              rel="noopener noreferrer"
              className="bg-[#00D632] hover:bg-[#00D632]/90 text-white w-full py-3.5 rounded-full font-bold shadow-md transition-all flex items-center justify-center gap-2"
            >
              Pay with Cash App
            </a>
            <p className="text-xs text-center text-muted-foreground mt-4 leading-relaxed">
              Please include your name and <strong>"{registration.siblingName}"</strong> in the payment note.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
