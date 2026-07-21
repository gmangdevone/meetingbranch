import { Link, useLocation } from "wouter";
import { useGetReunionByCode, getGetReunionByCodeQueryKey, useCreateSponsorshipContribution, useGetMyContributions, getGetMyContributionsQueryKey } from "@workspace/api-client-react";
import { format } from "date-fns";
import { CalendarDays, DollarSign, MapPin, Users, Edit3, ArrowRight, Home, Heart, Vote, History } from "lucide-react";
import { Skeleton } from "../components/ui/skeleton";
import { Button } from "../components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { useState } from "react";
import { useUser } from "@clerk/react";
import { describeFee } from "../lib/fees";
import { saveLastReunionCode, clearLastReunionCode, getLastReunionCode } from "../lib/lastReunion";
import { useEffect } from "react";

export function ReunionHub({ params }: { params: { code: string } }) {
  const code = params.code?.toUpperCase();
  const [, setLocation] = useLocation();
  const { isSignedIn } = useUser();
  const [contributionAmount, setContributionAmount] = useState("");
  const [contributorName, setContributorName] = useState("");
  const [showThankYou, setShowThankYou] = useState(false);
  const [isSponsorDialogOpen, setIsSponsorDialogOpen] = useState(false);
  
  const createContribution = useCreateSponsorshipContribution();

  const { data: reunion, isLoading, isError } = useGetReunionByCode(code, {
    query: { 
      enabled: !!code,
      retry: false
    , queryKey: getGetReunionByCodeQueryKey(code) }
  });

  const { data: myContributionsData } = useGetMyContributions(reunion?.id ?? 0, {
    query: { 
      enabled: isSignedIn && !!reunion?.id,
      queryKey: getGetMyContributionsQueryKey(reunion?.id ?? 0)
    }
  });

  // Remember the last successfully visited reunion so the Home nav can return here;
  // forget it if the code turns out to be invalid.
  useEffect(() => {
    if (reunion) {
      saveLastReunionCode(reunion.code);
    } else if (isError && getLastReunionCode() === code) {
      clearLastReunionCode();
    }
  }, [reunion, isError, code]);

  const handleContribute = () => {
    if (!reunion) return;
    const amount = parseInt(contributionAmount, 10);
    if (isNaN(amount) || amount <= 0) return;
    
    createContribution.mutate({
      reunionId: reunion.id,
      data: {
        amount,
        contributorName: contributorName || undefined,
      }
    }, {
      onSuccess: () => {
        setShowThankYou(true);
        setTimeout(() => {
          setIsSponsorDialogOpen(false);
          setShowThankYou(false);
          setContributionAmount("");
          setContributorName("");
        }, 3000);
      }
    });
  };

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
              This is the central location for everything related to {reunion.name}. {reunion.registrationsOpen ? "Be sure to register your household so we have a final headcount for food and activities!" : "Registration is currently closed."}
            </p>
            
            {reunion.registrationsOpen ? (
              <Link href={`/r/${reunion.code}/register`} className="block w-full">
                <Button className="w-full rounded-2xl py-8 text-xl font-bold shadow-md hover:-translate-y-1 transition-all group">
                  <Edit3 className="mr-3 w-6 h-6 group-hover:rotate-12 transition-transform" />
                  Register My Household
                </Button>
              </Link>
            ) : (
              <Button disabled className="w-full rounded-2xl py-8 text-xl font-bold bg-muted text-muted-foreground">
                Registration Closed
              </Button>
            )}
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

            <Link href={`/r/${reunion.code}/polls`} className="bg-primary/5 border border-primary/20 rounded-3xl p-8 flex flex-col items-start hover:bg-primary/10 transition-colors group md:col-span-2">
              <div className="bg-primary text-primary-foreground w-12 h-12 rounded-full flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <Vote className="w-6 h-6" />
              </div>
              <h3 className="font-serif text-2xl font-bold mb-2">Family Vote</h3>
              <p className="text-muted-foreground mb-4">Weigh in on family decisions — polls open to checked-in members.</p>
              <span className="mt-auto font-bold text-primary flex items-center">
                See Polls <ArrowRight className="ml-2 w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </span>
            </Link>
          </div>

          {isSignedIn && (
            <div className="bg-card border shadow-sm rounded-3xl p-8">
              <div className="flex items-center gap-3 mb-6">
                <div className="bg-rose-100 text-rose-500 w-10 h-10 rounded-full flex items-center justify-center shrink-0">
                  <History className="w-5 h-5" />
                </div>
                <h2 className="font-serif text-2xl font-bold">My Contributions</h2>
              </div>

              {!myContributionsData ? (
                <div className="space-y-3">
                  <div className="h-12 bg-muted rounded-2xl animate-pulse" />
                  <div className="h-12 bg-muted rounded-2xl animate-pulse" />
                </div>
              ) : myContributionsData.contributions.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Heart className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p className="font-medium">You haven't contributed to the fund yet.</p>
                  <p className="text-sm mt-1">Use the "Chip in to Fund" button to make your first contribution.</p>
                </div>
              ) : (
                <div className="divide-y">
                  {myContributionsData.contributions.map((contribution) => (
                    <div key={contribution.id} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                      <div>
                        <p className="font-semibold text-foreground">
                          {contribution.contributorName ?? "Anonymous"}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {format(new Date(contribution.createdAt), "MMM d, yyyy")}
                        </p>
                      </div>
                      <span className="font-bold text-rose-600 text-lg">
                        ${contribution.amount}
                      </span>
                    </div>
                  ))}
                  <div className="flex justify-between items-center pt-4 mt-1">
                    <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Total</span>
                    <span className="font-bold text-xl text-rose-600">
                      ${myContributionsData.contributions.reduce((sum, c) => sum + c.amount, 0)}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
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
            
            {isSignedIn && (
              <div className="mt-6 pt-6 border-t">
                <Dialog open={isSponsorDialogOpen} onOpenChange={setIsSponsorDialogOpen}>
                  <DialogTrigger asChild>
                    <Button variant="outline" className="w-full rounded-xl bg-rose-50 text-rose-600 border-rose-200 hover:bg-rose-100 hover:text-rose-700 dark:bg-rose-950/30 dark:border-rose-900/50 dark:hover:bg-rose-900/40">
                      <Heart className="w-4 h-4 mr-2" /> Chip in to Fund
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="rounded-3xl p-6 sm:p-8 max-w-md">
                    {showThankYou ? (
                      <div className="text-center py-8">
                        <div className="bg-rose-100 text-rose-500 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                          <Heart className="w-8 h-8 fill-current" />
                        </div>
                        <h2 className="font-serif text-3xl font-bold mb-2">Thank You!</h2>
                        <p className="text-muted-foreground">Your generous contribution has been recorded. It will help make the reunion special for everyone.</p>
                      </div>
                    ) : (
                      <>
                        <DialogHeader>
                          <DialogTitle className="font-serif text-2xl">Sponsorship Fund</DialogTitle>
                          <DialogDescription>
                            Help cover costs for family members who need a little assistance. Your contribution amount is kept private from other members.
                          </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4 py-4">
                          <div className="space-y-2">
                            <Label htmlFor="amount">Amount ($)</Label>
                            <Input
                              id="amount"
                              type="number"
                              min="1"
                              placeholder="50"
                              value={contributionAmount}
                              onChange={(e) => setContributionAmount(e.target.value)}
                              className="rounded-xl"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="name">Display Name (Optional)</Label>
                            <Input
                              id="name"
                              placeholder="e.g. The Smith Family"
                              value={contributorName}
                              onChange={(e) => setContributorName(e.target.value)}
                              className="rounded-xl"
                            />
                            <p className="text-xs text-muted-foreground">Leave blank to remain anonymous.</p>
                          </div>
                          {createContribution.isError && (
                            <p className="text-sm text-destructive font-medium">{(createContribution.error as any)?.error || "Failed to submit contribution."}</p>
                          )}
                        </div>
                        <Button 
                          className="w-full rounded-full py-6 text-lg font-bold" 
                          onClick={handleContribute}
                          disabled={!contributionAmount || createContribution.isPending}
                        >
                          {createContribution.isPending ? "Submitting..." : "Contribute"}
                        </Button>
                      </>
                    )}
                  </DialogContent>
                </Dialog>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
