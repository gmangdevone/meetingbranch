import { useLocation } from "wouter";
import { useGetRegistration, getGetRegistrationQueryKey, useTransferRegistration, getListMyRegistrationsQueryKey } from "@workspace/api-client-react";
import { format } from "date-fns";
import { ArrowLeft, Users, CreditCard, ExternalLink, CalendarDays, Send, AlertTriangle } from "lucide-react";
import { Skeleton } from "../components/ui/skeleton";
import { Button } from "../components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "../components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Label } from "../components/ui/label";
import { Input } from "../components/ui/input";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

export function RegistrationDetail({ params }: { params: { id: string } }) {
  const [, setLocation] = useLocation();
  const id = parseInt(params.id, 10);
  const queryClient = useQueryClient();

  const [transferMode, setTransferMode] = useState<"registration" | "payment">("registration");
  const [targetEmail, setTargetEmail] = useState("");
  const [targetRegistrationId, setTargetRegistrationId] = useState("");
  const [isTransferDialogOpen, setIsTransferDialogOpen] = useState(false);

  const { data: reg, isLoading, isError } = useGetRegistration(id, {
    query: { enabled: !isNaN(id), retry: false, queryKey: getGetRegistrationQueryKey(id) }
  });

  const transferMutation = useTransferRegistration();

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
  const isCancelled = reg.status === 'cancelled';

  const handleTransfer = () => {
    transferMutation.mutate({
      id: reg.id,
      data: {
        kind: transferMode,
        targetEmail: transferMode === "registration" ? targetEmail : undefined,
        targetRegistrationId: transferMode === "payment" ? parseInt(targetRegistrationId, 10) : undefined,
      }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListMyRegistrationsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetRegistrationQueryKey(id) });
        setIsTransferDialogOpen(false);
        setTargetEmail("");
        setTargetRegistrationId("");
      }
    });
  };

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
        {isCancelled && (
          <div className="bg-destructive/10 border border-destructive/20 rounded-3xl p-6 flex items-start gap-4">
            <div className="bg-destructive/20 p-2 rounded-full mt-1">
              <AlertTriangle className="w-5 h-5 text-destructive" />
            </div>
            <div>
              <h3 className="font-bold text-lg text-destructive mb-1">Registration Cancelled</h3>
              <p className="text-muted-foreground">This registration has been cancelled by an organizer.</p>
              {reg.cancellationResolution === 'refunded' && <p className="text-sm font-medium mt-2">Resolution: Refunded</p>}
              {reg.cancellationResolution === 'donated_to_fund' && <p className="text-sm font-medium mt-2">Resolution: Paid amount donated to sponsorship fund</p>}
            </div>
          </div>
        )}

        <div className={`bg-card border shadow-md rounded-3xl overflow-hidden ${isCancelled ? 'opacity-70 grayscale-[0.5]' : ''}`}>
          <div className={`${isCancelled ? 'bg-muted' : 'bg-primary'} p-8 text-${isCancelled ? 'muted-foreground' : 'primary-foreground'} relative`}>
            <div className="absolute top-8 right-8 flex flex-col items-end gap-2">
              {isCancelled ? (
                <div className="px-4 py-1.5 rounded-full text-sm font-bold uppercase tracking-wider bg-destructive text-destructive-foreground">
                  Cancelled
                </div>
              ) : (
                <div className={`px-4 py-1.5 rounded-full text-sm font-bold uppercase tracking-wider ${
                  reg.paymentStatus === 'paid' ? 'bg-white text-green-700' :
                  reg.paymentStatus === 'waived' ? 'bg-white/20 text-white' :
                  'bg-amber-400 text-amber-950'
                }`}>
                  {reg.paymentStatus}
                </div>
              )}
            </div>
            
            <p className={`${isCancelled ? 'text-muted-foreground' : 'text-primary-foreground/80'} text-sm font-medium uppercase tracking-widest mb-2`}>
              Registration ID: <span className="font-mono bg-background/20 px-2 py-0.5 rounded ml-1">#{reg.id}</span>
            </p>
            <h1 className="font-serif text-3xl md:text-4xl font-bold mb-6 pr-24">{reg.reunionName || `Reunion ${reg.reunionCode}`}</h1>
            
            <div className={`flex items-center gap-6 ${isCancelled ? 'text-muted-foreground' : 'text-primary-foreground/90'}`}>
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
            
            <div className="mt-8 pt-6 border-t flex flex-col sm:flex-row justify-between items-center gap-4">
              <Button onClick={() => setLocation(`/r/${reg.reunionCode}`)} variant="outline" className="rounded-xl w-full sm:w-auto">
                Go to Reunion Hub
              </Button>

              {!isCancelled && (
                <Dialog open={isTransferDialogOpen} onOpenChange={setIsTransferDialogOpen}>
                  <DialogTrigger asChild>
                    <Button variant="ghost" className="rounded-xl w-full sm:w-auto text-primary hover:text-primary hover:bg-primary/10">
                      <Send className="w-4 h-4 mr-2" /> Transfer
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="rounded-3xl p-6 sm:p-8 max-w-lg">
                    <DialogHeader>
                      <DialogTitle className="font-serif text-2xl">Transfer</DialogTitle>
                      <DialogDescription>
                        Transfer this registration to someone else, or transfer its payment status to another registration in the same reunion.
                      </DialogDescription>
                    </DialogHeader>
                    
                    <Tabs value={transferMode} onValueChange={(v) => setTransferMode(v as "registration" | "payment")} className="mt-4">
                      <TabsList className="grid grid-cols-2 w-full mb-6">
                        <TabsTrigger value="registration">Registration</TabsTrigger>
                        <TabsTrigger value="payment" disabled={reg.paymentStatus !== "paid"}>Payment Only</TabsTrigger>
                      </TabsList>
                      
                      <TabsContent value="registration" className="space-y-4">
                        <p className="text-sm text-muted-foreground mb-4">
                          Hand over this entire registration (including all attendees and fee selections) to another family member's account.
                        </p>
                        <div className="space-y-2">
                          <Label>Recipient's Email Address</Label>
                          <Input 
                            placeholder="jane@example.com" 
                            type="email"
                            value={targetEmail}
                            onChange={(e) => setTargetEmail(e.target.value)}
                            className="rounded-xl"
                          />
                        </div>
                      </TabsContent>
                      
                      <TabsContent value="payment" className="space-y-4">
                        <p className="text-sm text-muted-foreground mb-4">
                          Keep your registration, but apply your "paid" status to someone else's registration. They can find their Registration ID on their own details page.
                        </p>
                        <div className="space-y-2">
                          <Label>Recipient's Registration ID</Label>
                          <Input 
                            placeholder="e.g. 42" 
                            type="number"
                            value={targetRegistrationId}
                            onChange={(e) => setTargetRegistrationId(e.target.value)}
                            className="rounded-xl"
                          />
                        </div>
                      </TabsContent>
                    </Tabs>

                    {transferMutation.isError && (
                      <div className="mt-4 p-3 bg-destructive/10 text-destructive text-sm font-medium rounded-xl">
                        {(transferMutation.error as any)?.error || "Failed to transfer. Please try again."}
                      </div>
                    )}

                    <div className="mt-6 flex justify-end gap-3">
                      <Button variant="ghost" onClick={() => setIsTransferDialogOpen(false)} className="rounded-xl">Cancel</Button>
                      <Button 
                        onClick={handleTransfer} 
                        disabled={transferMutation.isPending || (transferMode === "registration" && !targetEmail) || (transferMode === "payment" && !targetRegistrationId)}
                        className="rounded-xl"
                      >
                        {transferMutation.isPending ? "Transferring..." : "Confirm Transfer"}
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
              )}
            </div>
          </div>
        </div>

        {!isPaid && !isCancelled && (
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
