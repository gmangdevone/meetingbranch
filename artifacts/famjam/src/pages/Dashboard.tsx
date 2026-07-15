import { useState } from "react";
import { Link } from "wouter";
import { useListMyReunions, useListMyRegistrations, useTransferRegistration, getListMyRegistrationsQueryKey, useGetSettings } from "@workspace/api-client-react";
import { CalendarDays, Settings, Users, ArrowRight, Plus, Key, Send } from "lucide-react";
import { format } from "date-fns";
import { Skeleton } from "../components/ui/skeleton";
import { AdminSetupPrompt } from "../components/AdminSetupPrompt";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "../components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Label } from "../components/ui/label";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { useQueryClient } from "@tanstack/react-query";

export function Dashboard() {
  const queryClient = useQueryClient();
  const { data: reunions, isLoading: loadingReunions } = useListMyReunions();
  const { data: registrations, isLoading: loadingRegistrations } = useListMyRegistrations();
  const { data: settings, isLoading: loadingSettings } = useGetSettings();
  const canCreateReunion = settings?.reunionCreationEnabled ?? false;

  const [transferReg, setTransferReg] = useState<any>(null);
  const [transferMode, setTransferMode] = useState<"registration" | "payment">("registration");
  const [targetEmail, setTargetEmail] = useState("");
  const [targetRegistrationId, setTargetRegistrationId] = useState("");
  
  const transferMutation = useTransferRegistration();

  const handleTransfer = () => {
    if (!transferReg) return;
    transferMutation.mutate({
      id: transferReg.id,
      data: {
        kind: transferMode,
        targetEmail: transferMode === "registration" ? targetEmail : undefined,
        targetRegistrationId: transferMode === "payment" ? parseInt(targetRegistrationId, 10) : undefined,
      }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListMyRegistrationsQueryKey() });
        setTransferReg(null);
        setTargetEmail("");
        setTargetRegistrationId("");
      }
    });
  };

  return (
    <div className="flex flex-col gap-12 pb-12">
      <div className="flex flex-col gap-2">
        <h1 className="font-serif text-4xl md:text-5xl font-bold text-foreground">Welcome Back</h1>
        <p className="text-lg text-muted-foreground">Manage your upcoming family gatherings.</p>
      </div>

      <div className={`grid grid-cols-1 ${canCreateReunion ? "md:grid-cols-2" : ""} gap-6 transition-opacity ${loadingSettings ? "opacity-0" : "opacity-100"}`}>
        {canCreateReunion && (
        <Link href="/create" className="bg-primary/10 border border-primary/20 rounded-3xl p-6 flex items-center gap-4 hover:bg-primary/15 transition-all group">
          <div className="bg-primary text-primary-foreground w-12 h-12 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
            <Plus className="w-6 h-6" />
          </div>
          <div>
            <h3 className="font-bold text-lg text-foreground">Create a Reunion</h3>
            <p className="text-muted-foreground text-sm">Start organizing a new family event.</p>
          </div>
        </Link>
        )}
        <Link href="/join" className="bg-secondary/10 border border-secondary/20 rounded-3xl p-6 flex items-center gap-4 hover:bg-secondary/15 transition-all group">
          <div className="bg-secondary text-secondary-foreground w-12 h-12 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
            <Key className="w-6 h-6" />
          </div>
          <div>
            <h3 className="font-bold text-lg text-foreground">Join a Reunion</h3>
            <p className="text-muted-foreground text-sm">Enter a code to RSVP for an event.</p>
          </div>
        </Link>
      </div>

      <AdminSetupPrompt />

      <section>
        <div className="flex items-center justify-between mb-6">
          <h2 className="font-serif text-2xl font-bold text-foreground">My Registrations</h2>
        </div>
        
        {loadingRegistrations ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Skeleton className="h-32 rounded-3xl" />
            <Skeleton className="h-32 rounded-3xl" />
          </div>
        ) : !registrations || registrations.length === 0 ? (
          <div className="bg-card border shadow-sm rounded-3xl p-8 text-center flex flex-col items-center">
            <div className="bg-muted w-16 h-16 rounded-full flex items-center justify-center mb-4">
              <CalendarDays className="w-8 h-8 text-muted-foreground" />
            </div>
            <h3 className="font-bold text-lg mb-2">No registrations yet</h3>
            <p className="text-muted-foreground mb-6 max-w-sm mx-auto">You haven't RSVP'd to any family reunions. Join one using a family code.</p>
            <Link href="/join" className="text-primary font-bold hover:underline">Join a Reunion</Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {registrations.map(reg => {
              const isCancelled = reg.status === 'cancelled';
              return (
              <div key={reg.id} className={`bg-card border shadow-sm rounded-3xl p-6 flex flex-col gap-4 hover:shadow-md transition-shadow ${isCancelled ? 'opacity-70 grayscale-[0.5]' : ''}`}>
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-bold text-xl mb-1">{reg.reunionName || `Reunion ${reg.reunionCode}`}</h3>
                    <p className="text-muted-foreground text-sm">Attending as: <span className="font-medium text-foreground">{reg.branchName}</span></p>
                  </div>
                  <div className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
                    isCancelled ? 'bg-destructive/10 text-destructive' :
                    reg.paymentStatus === 'paid' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                    reg.paymentStatus === 'waived' ? 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300' :
                    'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                  }`}>
                    {isCancelled ? 'Cancelled' : reg.paymentStatus}
                  </div>
                </div>
                
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Users className="w-4 h-4" />
                  <span>{reg.attendeeCount} {reg.attendeeCount === 1 ? 'person' : 'people'}</span>
                </div>
                
                <div className="mt-2 pt-4 border-t flex items-center gap-3">
                  <Link href={`/registrations/${reg.id}`} className="flex-1 text-center py-2 bg-secondary/10 text-secondary hover:bg-secondary/20 rounded-xl font-medium transition-colors">
                    View Details
                  </Link>
                  <Link href={`/r/${reg.reunionCode}`} className="flex-1 text-center py-2 bg-primary/10 text-primary hover:bg-primary/20 rounded-xl font-medium transition-colors">
                    Reunion Hub
                  </Link>
                </div>
              </div>
            )})}
          </div>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between mb-6">
          <h2 className="font-serif text-2xl font-bold text-foreground">Reunions I Organize</h2>
        </div>
        
        {loadingReunions ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Skeleton className="h-40 rounded-3xl" />
          </div>
        ) : !reunions || reunions.length === 0 ? (
          <div className="bg-card border shadow-sm rounded-3xl p-8 text-center flex flex-col items-center">
            <div className="bg-muted w-16 h-16 rounded-full flex items-center justify-center mb-4">
              <Settings className="w-8 h-8 text-muted-foreground" />
            </div>
            <h3 className="font-bold text-lg mb-2">No organized reunions</h3>
            <p className="text-muted-foreground mb-6 max-w-sm mx-auto">You aren't organizing any reunions yet.</p>
            {canCreateReunion && (
              <Link href="/create" className="text-primary font-bold hover:underline">Create a Reunion</Link>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {reunions.map(({ reunion, registrationCount, attendeeCount }) => (
              <Link key={reunion.id} href={`/organize/${reunion.id}`} className="bg-card border shadow-sm rounded-3xl p-6 group hover:border-primary/50 transition-all flex flex-col">
                <div className="mb-4 flex-1">
                  <div className="flex justify-between items-start mb-2">
                    <h3 className="font-bold text-lg group-hover:text-primary transition-colors">{reunion.name}</h3>
                    <div className="bg-primary/10 text-primary text-xs font-bold px-2 py-1 rounded-md font-mono">
                      {reunion.code}
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {format(new Date(reunion.startDate), 'MMM d')} - {format(new Date(reunion.endDate), 'MMM d, yyyy')}
                  </p>
                </div>
                
                <div className="flex gap-4 text-sm mt-auto pt-4 border-t">
                  <div className="flex flex-col">
                    <span className="text-muted-foreground">Households</span>
                    <span className="font-bold">{registrationCount}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-muted-foreground">Attendees</span>
                    <span className="font-bold">{attendeeCount}</span>
                  </div>
                  <div className="ml-auto flex items-center text-primary">
                    <span className="sr-only">Manage</span>
                    <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
