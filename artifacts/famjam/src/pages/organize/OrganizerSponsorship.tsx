import { useState } from "react";
import { OrganizerLayout } from "./OrganizerLayout";
import { useGetSponsorshipFund, getGetSponsorshipFundQueryKey, useListReunionRegistrations, getListReunionRegistrationsQueryKey, useCreateSponsorshipAllocation, useUpdateContributionPayment } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Heart, Info, Plus, ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Skeleton } from "../../components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { RadioGroup, RadioGroupItem } from "../../components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { useToast } from "../../hooks/use-toast";
import { format } from "date-fns";

export function OrganizerSponsorship({ params }: { params: { reunionId: string } }) {
  const reunionId = parseInt(params.reunionId, 10);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const { data: fund, isLoading } = useGetSponsorshipFund(reunionId, {
    query: { enabled: !isNaN(reunionId), queryKey: getGetSponsorshipFundQueryKey(reunionId) }
  });
  
  const { data: registrations } = useListReunionRegistrations(reunionId, {
    query: { enabled: !isNaN(reunionId), queryKey: getListReunionRegistrationsQueryKey(reunionId) }
  });
  
  const activeRegistrations = registrations?.filter(r => r.status === 'active') || [];
  
  const allocateMutation = useCreateSponsorshipAllocation();
  const contributionPaymentMutation = useUpdateContributionPayment();

  const handleContributionStatus = (contributionId: number, paymentStatus: "pending" | "paid" | "waived") => {
    contributionPaymentMutation.mutate(
      { reunionId, contributionId, data: { paymentStatus } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetSponsorshipFundQueryKey(reunionId) });
          toast({ title: "Contribution updated" });
        },
      },
    );
  };
  
  const [isSponsorOpen, setIsSponsorOpen] = useState(false);
  const [regId, setRegId] = useState("");
  const [amount, setAmount] = useState("");
  const [fundedFrom, setFundedFrom] = useState<"fund"|"direct">("fund");
  const [sponsorName, setSponsorName] = useState("");
  const [note, setNote] = useState("");
  const [amountError, setAmountError] = useState<string | null>(null);

  const handleAllocate = () => {
    const numAmount = parseInt(amount, 10);
    if (!regId) return;
    if (isNaN(numAmount) || numAmount <= 0) {
      setAmountError("Amount must be at least $1");
      return;
    }
    setAmountError(null);
    
    allocateMutation.mutate({
      reunionId,
      data: {
        registrationId: parseInt(regId, 10),
        amount: numAmount,
        fundedFrom,
        sponsorName: sponsorName || undefined,
        note: note || undefined,
      }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetSponsorshipFundQueryKey(reunionId) });
        toast({ title: "Sponsorship applied successfully" });
        setIsSponsorOpen(false);
        setRegId("");
        setAmount("");
        setSponsorName("");
        setNote("");
        setFundedFrom("fund");
        setAmountError(null);
      }
    });
  };

  return (
    <OrganizerLayout reunionId={reunionId} requiredRole="power_user">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="font-serif text-3xl font-bold flex items-center gap-3">
              <Heart className="w-8 h-8 text-rose-500" />
              Sponsorship Fund
            </h1>
            <p className="text-muted-foreground flex items-center gap-1.5 mt-1">
              <Info className="w-4 h-4" /> Sponsorship details are confidential to organizers.
            </p>
          </div>
          <Dialog open={isSponsorOpen} onOpenChange={setIsSponsorOpen}>
            <DialogTrigger asChild>
              <Button className="rounded-full bg-rose-500 hover:bg-rose-600 text-white">
                <Plus className="w-4 h-4 mr-2" /> Sponsor a Registration
              </Button>
            </DialogTrigger>
            <DialogContent className="rounded-3xl max-w-lg">
              <DialogHeader>
                <DialogTitle className="font-serif text-2xl">Sponsor a Registration</DialogTitle>
                <DialogDescription>Apply funds to help a family member cover their registration costs.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>Select Registration</Label>
                  <Select value={regId} onValueChange={setRegId}>
                    <SelectTrigger className="rounded-xl">
                      <SelectValue placeholder="Choose a household..." />
                    </SelectTrigger>
                    <SelectContent>
                      {activeRegistrations.map(reg => (
                        <SelectItem key={reg.id} value={reg.id.toString()}>
                          {reg.userName || reg.userEmail} ({reg.branchName})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="space-y-2">
                  <Label>Amount ($)</Label>
                  <Input
                    type="number"
                    min="1"
                    value={amount}
                    onChange={(e) => { setAmount(e.target.value); setAmountError(null); }}
                    className={`rounded-xl${amountError ? " border-destructive focus-visible:ring-destructive" : ""}`}
                  />
                  {amountError && (
                    <p className="text-sm text-destructive font-medium">{amountError}</p>
                  )}
                </div>
                
                <div className="space-y-2">
                  <Label>Funding Source</Label>
                  <RadioGroup value={fundedFrom} onValueChange={(v) => setFundedFrom(v as "fund"|"direct")} className="flex flex-col gap-2">
                    <div className="flex items-center space-x-2 border p-3 rounded-xl cursor-pointer hover:bg-muted/50">
                      <RadioGroupItem value="fund" id="source-fund" />
                      <Label htmlFor="source-fund" className="flex-1 cursor-pointer">
                        From the Sponsorship Fund
                        <span className="block text-xs text-muted-foreground font-normal mt-0.5">Available: ${fund?.balance || 0}</span>
                      </Label>
                    </div>
                    <div className="flex items-center space-x-2 border p-3 rounded-xl cursor-pointer hover:bg-muted/50">
                      <RadioGroupItem value="direct" id="source-direct" />
                      <Label htmlFor="source-direct" className="flex-1 cursor-pointer">
                        Individual Sponsor
                        <span className="block text-xs text-muted-foreground font-normal mt-0.5">Funded directly outside the pool</span>
                      </Label>
                    </div>
                  </RadioGroup>
                </div>
                
                {fundedFrom === "direct" && (
                  <div className="space-y-2">
                    <Label>Sponsor Name (Optional)</Label>
                    <Input placeholder="e.g. Aunt Mary" value={sponsorName} onChange={(e) => setSponsorName(e.target.value)} className="rounded-xl" />
                  </div>
                )}
                
                <div className="space-y-2">
                  <Label>Internal Note (Optional)</Label>
                  <Input placeholder="Why this was allocated..." value={note} onChange={(e) => setNote(e.target.value)} className="rounded-xl" />
                </div>
                
                {allocateMutation.isError && (
                  <div className="p-3 bg-destructive/10 text-destructive text-sm font-medium rounded-xl">
                    {(allocateMutation.error as any)?.data?.error || "Failed to allocate funds."}
                  </div>
                )}
              </div>
              <Button onClick={handleAllocate} disabled={allocateMutation.isPending || !regId || !amount} className="w-full rounded-full py-6 text-lg font-bold bg-rose-500 hover:bg-rose-600 text-white">
                {allocateMutation.isPending ? "Processing..." : "Confirm Sponsorship"}
              </Button>
            </DialogContent>
          </Dialog>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Skeleton className="h-32 rounded-3xl" />
            <Skeleton className="h-32 rounded-3xl" />
            <Skeleton className="h-32 rounded-3xl" />
          </div>
        ) : fund ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-rose-500 text-white border-transparent shadow-md rounded-3xl p-6 relative overflow-hidden">
                <Heart className="absolute -bottom-8 -right-8 w-40 h-40 opacity-10" />
                <h3 className="font-bold text-rose-100 mb-2 relative z-10">Fund Balance</h3>
                <div className="font-serif text-5xl font-bold relative z-10">${fund.balance}</div>
                <p className="text-sm text-rose-100 mt-2 relative z-10">Available to allocate</p>
              </div>
              <div className="bg-card border shadow-sm rounded-3xl p-6">
                <h3 className="font-bold text-muted-foreground mb-2">Total Contributed</h3>
                <div className="font-serif text-4xl font-bold text-foreground">${fund.totalContributed}</div>
                <p className="text-sm text-muted-foreground mt-2">
                  Received funds only
                  {fund.totalPending > 0 && (
                    <span className="block text-amber-600 dark:text-amber-400 font-semibold">
                      +${fund.totalPending} pledged, not yet received
                    </span>
                  )}
                </p>
              </div>
              <div className="bg-card border shadow-sm rounded-3xl p-6">
                <h3 className="font-bold text-muted-foreground mb-2">Total Allocated</h3>
                <div className="font-serif text-4xl font-bold text-foreground">${fund.totalAllocated}</div>
                <p className="text-sm text-muted-foreground mt-2">Spent from the fund</p>
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
              {/* Allocations Ledger */}
              <div className="bg-card border shadow-sm rounded-3xl p-6 flex flex-col h-[500px]">
                <h2 className="font-serif text-2xl font-bold mb-4 flex items-center">
                  <ArrowUpRight className="w-5 h-5 mr-2 text-rose-500" /> Sponsorships Given
                </h2>
                <div className="flex-1 overflow-y-auto pr-2 space-y-3">
                  {fund.allocations.length === 0 ? (
                    <div className="text-center py-10 text-muted-foreground">No sponsorships allocated yet.</div>
                  ) : (
                    fund.allocations.map(alloc => (
                      <div key={alloc.id} className="p-4 border border-rose-100 dark:border-rose-900/30 rounded-2xl flex justify-between items-center bg-rose-50 dark:bg-rose-950/20">
                        <div>
                          <div className="font-bold text-rose-950 dark:text-rose-200">{alloc.registrantName || alloc.registrantEmail}</div>
                          <div className="text-xs text-rose-700/80 dark:text-rose-300/80 mt-1">
                            {format(new Date(alloc.createdAt), 'MMM d, yyyy')} • {alloc.branchName}
                          </div>
                          <div className="text-xs mt-2 inline-flex items-center px-2 py-0.5 rounded bg-rose-100 dark:bg-rose-900/50 text-rose-800 dark:text-rose-300">
                            {alloc.fundedFrom === 'fund' ? 'From Fund' : `Direct: ${alloc.sponsorName || 'Anonymous'}`}
                          </div>
                          {alloc.note && <div className="text-xs text-rose-700/80 dark:text-rose-300/80 mt-1 italic">"{alloc.note}"</div>}
                        </div>
                        <div className="font-bold text-xl text-rose-600 dark:text-rose-400">-${alloc.amount}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Contributions Ledger */}
              <div className="bg-card border shadow-sm rounded-3xl p-6 flex flex-col h-[500px]">
                <h2 className="font-serif text-2xl font-bold mb-4 flex items-center">
                  <ArrowDownRight className="w-5 h-5 mr-2 text-green-500" /> Contributions Received
                </h2>
                <div className="flex-1 overflow-y-auto pr-2 space-y-3">
                  {fund.contributions.length === 0 ? (
                    <div className="text-center py-10 text-muted-foreground">No contributions received yet.</div>
                  ) : (
                    fund.contributions.map(cont => (
                      <div key={cont.id} className="p-4 border rounded-2xl flex justify-between items-center bg-muted/20 gap-3">
                        <div>
                          <div className="font-bold">{cont.contributorName || 'Anonymous'}</div>
                          <div className="text-xs text-muted-foreground mt-1">
                            {format(new Date(cont.createdAt), 'MMM d, yyyy')}
                          </div>
                          <div className="text-xs mt-2 text-muted-foreground capitalize">
                            Source: {cont.source.replace('_', ' ')}
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          <div className={`font-bold text-lg ${cont.paymentStatus === 'paid' ? 'text-green-600' : 'text-muted-foreground'}`}>
                            +${cont.amount}
                          </div>
                          {cont.source !== 'direct' ? (
                            <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                              {cont.source === 'registration'
                                ? `${cont.paymentStatus} · settled with registration`
                                : 'paid · from cancelled registration'}
                            </span>
                          ) : (
                            <Select
                              value={cont.paymentStatus}
                              onValueChange={(v) => handleContributionStatus(cont.id, v as "pending" | "paid" | "waived")}
                              disabled={contributionPaymentMutation.isPending}
                            >
                              <SelectTrigger className="h-7 w-[110px] rounded-lg text-xs font-bold">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="pending">Pending</SelectItem>
                                <SelectItem value="paid">Paid</SelectItem>
                                <SelectItem value="waived">Waived</SelectItem>
                              </SelectContent>
                            </Select>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </OrganizerLayout>
  );
}
