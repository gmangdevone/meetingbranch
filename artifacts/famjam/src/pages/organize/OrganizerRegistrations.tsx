import { useState, useMemo } from "react";
import { useListReunionRegistrations, useUpdateRegistrationPayment, useExportReunionRegistrations, getListReunionRegistrationsQueryKey, getGetReunionReportsQueryKey, getGetReunionSummaryQueryKey, useCancelRegistration, useTransferRegistration, getGetSponsorshipFundQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Search, Download, Check, X, Filter, Ban, Send, AlertTriangle } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "../../components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { Label } from "../../components/ui/label";
import { RadioGroup, RadioGroupItem } from "../../components/ui/radio-group";
import { useToast } from "../../hooks/use-toast";
import { OrganizerLayout } from "./OrganizerLayout";
import { format } from "date-fns";

export function OrganizerRegistrations({ params }: { params: { reunionId: string } }) {
  const reunionId = parseInt(params.reunionId, 10);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  
  const { data: registrations, isLoading } = useListReunionRegistrations(reunionId, {
    query: { enabled: !isNaN(reunionId), queryKey: getListReunionRegistrationsQueryKey(reunionId) }
  });

  const updatePayment = useUpdateRegistrationPayment();
  const cancelMutation = useCancelRegistration();
  const transferMutation = useTransferRegistration();

  const { refetch: fetchExport, isFetching: isExporting } = useExportReunionRegistrations(reunionId, { query: { enabled: false, queryKey: ['export', reunionId] } });

  // Dialog state
  const [cancelReg, setCancelReg] = useState<any>(null);
  const [cancelResolution, setCancelResolution] = useState<'refunded' | 'donated_to_fund'>('refunded');

  const [transferReg, setTransferReg] = useState<any>(null);
  const [transferMode, setTransferMode] = useState<"registration" | "payment">("registration");
  const [targetEmail, setTargetEmail] = useState("");
  const [targetRegistrationId, setTargetRegistrationId] = useState("");

  const filteredRegistrations = useMemo(() => {
    if (!registrations) return [];
    return registrations.filter(reg => {
      const matchesSearch = 
        (reg.userName || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
        reg.userEmail.toLowerCase().includes(searchTerm.toLowerCase()) ||
        reg.branchName.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesStatus = statusFilter === "all" || reg.paymentStatus === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [registrations, searchTerm, statusFilter]);

  const handleUpdateStatus = (registrationId: number, status: 'paid' | 'pending' | 'waived') => {
    updatePayment.mutate({
      reunionId,
      registrationId,
      data: { paymentStatus: status }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListReunionRegistrationsQueryKey(reunionId) });
        queryClient.invalidateQueries({ queryKey: getGetReunionReportsQueryKey(reunionId) });
        queryClient.invalidateQueries({ queryKey: getGetReunionSummaryQueryKey(reunionId) });
        toast({ title: "Status updated" });
      }
    });
  };

  const handleExport = async () => {
    const res = await fetchExport();
    if (res.data) {
      const blob = new Blob([res.data as string], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", `reunion-${reunionId}-registrations.csv`);
      link.style.visibility = "hidden";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const handleCancel = () => {
    if (!cancelReg) return;
    const isPaid = cancelReg.paymentStatus === 'paid';
    cancelMutation.mutate({
      reunionId,
      registrationId: cancelReg.id,
      data: {
        resolution: isPaid ? cancelResolution : undefined
      }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListReunionRegistrationsQueryKey(reunionId) });
        queryClient.invalidateQueries({ queryKey: getGetReunionReportsQueryKey(reunionId) });
        queryClient.invalidateQueries({ queryKey: getGetReunionSummaryQueryKey(reunionId) });
        queryClient.invalidateQueries({ queryKey: getGetSponsorshipFundQueryKey(reunionId) });
        toast({ title: "Registration cancelled" });
        setCancelReg(null);
      }
    });
  };

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
        queryClient.invalidateQueries({ queryKey: getListReunionRegistrationsQueryKey(reunionId) });
        toast({ title: "Registration transferred" });
        setTransferReg(null);
        setTargetEmail("");
        setTargetRegistrationId("");
      }
    });
  };

  return (
    <OrganizerLayout reunionId={reunionId} requiredRole="registration">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <h1 className="font-serif text-3xl font-bold">Registrations</h1>
          <Button onClick={handleExport} variant="outline" className="rounded-full" disabled={isExporting || !registrations?.length}>
            <Download className="w-4 h-4 mr-2" /> Export CSV
          </Button>
        </div>

        <div className="bg-card border shadow-sm rounded-3xl p-6">
          <div className="flex flex-col md:flex-row gap-4 mb-6">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-3 w-5 h-5 text-muted-foreground" />
              <Input 
                placeholder="Search by name, email, or branch..." 
                className="pl-10 rounded-xl bg-muted/50 border-transparent"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <div className="w-full md:w-48 shrink-0">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="rounded-xl bg-muted/50 border-transparent">
                  <Filter className="w-4 h-4 mr-2 text-muted-foreground" />
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
                  <SelectItem value="waived">Waived</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-muted-foreground uppercase bg-muted/50 rounded-t-xl">
                <tr>
                  <th className="px-4 py-3 rounded-tl-xl">Registrant</th>
                  <th className="px-4 py-3">Branch</th>
                  <th className="px-4 py-3">Attendees</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Payment</th>
                  <th className="px-4 py-3 rounded-tr-xl">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {isLoading ? (
                  <tr><td colSpan={6} className="text-center py-8">Loading...</td></tr>
                ) : filteredRegistrations.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-8 text-muted-foreground">No registrations found.</td></tr>
                ) : (
                  filteredRegistrations.map((reg) => {
                    const isCancelled = reg.status === 'cancelled';
                    return (
                    <tr key={reg.id} className={`hover:bg-muted/30 transition-colors ${isCancelled ? 'opacity-60 bg-muted/10' : ''}`}>
                      <td className="px-4 py-4">
                        <div className="font-medium text-foreground">
                          {reg.userName || "Unknown"}
                          <span className="text-xs text-muted-foreground font-mono ml-2 bg-muted px-1 rounded">#{reg.id}</span>
                        </div>
                        <div className="text-muted-foreground text-xs">{reg.userEmail}</div>
                      </td>
                      <td className="px-4 py-4 font-medium">{reg.branchName}</td>
                      <td className="px-4 py-4">
                        <div className="flex flex-col">
                          <span className="font-bold">{reg.attendeeCount}</span>
                          <span className="text-xs text-muted-foreground truncate max-w-[150px]" title={reg.attendees.map(a=>a.name).join(', ')}>
                            {reg.attendees.map(a=>a.name).join(', ')}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap text-muted-foreground text-xs">
                        {format(new Date(reg.createdAt), 'MMM d, yyyy')}
                      </td>
                      <td className="px-4 py-4">
                        {isCancelled ? (
                          <div className="flex flex-col gap-1">
                            <span className="inline-flex items-center px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider bg-destructive/10 text-destructive w-fit">
                              Cancelled
                            </span>
                            {reg.cancellationResolution && (
                              <span className="text-[10px] text-muted-foreground max-w-[110px] leading-tight">
                                {reg.cancellationResolution === 'refunded' ? 'Refunded' : 
                                 reg.cancellationResolution === 'donated_to_fund' ? 'Fund donated' : ''}
                              </span>
                            )}
                          </div>
                        ) : (
                          <Select 
                            value={reg.paymentStatus} 
                            onValueChange={(val: 'paid'|'pending'|'waived') => handleUpdateStatus(reg.id, val)}
                          >
                            <SelectTrigger className={`h-8 text-xs font-bold uppercase tracking-wider rounded-lg border-0 w-[110px] ${
                              reg.paymentStatus === 'paid' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                              reg.paymentStatus === 'waived' ? 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300' :
                              'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                            }`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="pending" className="text-amber-600 font-bold uppercase text-xs">Pending</SelectItem>
                              <SelectItem value="paid" className="text-green-600 font-bold uppercase text-xs">Paid</SelectItem>
                              <SelectItem value="waived" className="text-gray-600 font-bold uppercase text-xs">Waived</SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        {!isCancelled && (
                          <div className="flex flex-wrap gap-2">
                            <Button variant="outline" size="sm" className="h-8 px-2 text-xs rounded-lg" onClick={() => setTransferReg(reg)}>
                              <Send className="w-3 h-3 mr-1" /> Transfer
                            </Button>
                            <Button variant="outline" size="sm" className="h-8 px-2 text-xs rounded-lg text-destructive border-transparent hover:border-destructive/30 hover:text-destructive hover:bg-destructive/10" onClick={() => setCancelReg(reg)}>
                              <Ban className="w-3 h-3 mr-1" /> Cancel
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  )})
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Cancel Dialog */}
      <Dialog open={!!cancelReg} onOpenChange={(open) => !open && setCancelReg(null)}>
        <DialogContent className="rounded-3xl p-6 sm:p-8 max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl text-destructive flex items-center gap-2">
              <AlertTriangle className="w-6 h-6" /> Cancel Registration
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to cancel the registration for <strong>{cancelReg?.userName || cancelReg?.userEmail}</strong>? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>

          {cancelReg?.paymentStatus === 'paid' && (
            <div className="space-y-4 py-4">
              <Label className="text-base">Payment Resolution</Label>
              <p className="text-sm text-muted-foreground -mt-2">This registration is marked as paid. How are you handling the funds?</p>
              <RadioGroup value={cancelResolution} onValueChange={(v) => setCancelResolution(v as any)} className="flex flex-col gap-3">
                <div className="flex items-center space-x-2 border p-3 rounded-xl cursor-pointer hover:bg-muted/50">
                  <RadioGroupItem value="refunded" id="res-refund" />
                  <Label htmlFor="res-refund" className="flex-1 cursor-pointer">
                    Refunded
                    <span className="block text-xs text-muted-foreground font-normal mt-0.5">Money returned outside the app</span>
                  </Label>
                </div>
                <div className="flex items-center space-x-2 border p-3 rounded-xl cursor-pointer hover:bg-muted/50">
                  <RadioGroupItem value="donated_to_fund" id="res-donate" />
                  <Label htmlFor="res-donate" className="flex-1 cursor-pointer">
                    Donate to Sponsorship Fund
                    <span className="block text-xs text-muted-foreground font-normal mt-0.5">Add their paid amount to the pool</span>
                  </Label>
                </div>
              </RadioGroup>
            </div>
          )}

          {cancelMutation.isError && (
            <div className="mt-4 p-3 bg-destructive/10 text-destructive text-sm font-medium rounded-xl">
              {(cancelMutation.error as any)?.error || "Failed to cancel. Please try again."}
            </div>
          )}

          <div className="mt-6 flex justify-end gap-3">
            <Button variant="ghost" onClick={() => setCancelReg(null)} className="rounded-xl">Keep Registration</Button>
            <Button onClick={handleCancel} variant="destructive" disabled={cancelMutation.isPending} className="rounded-xl">
              {cancelMutation.isPending ? "Cancelling..." : "Yes, Cancel Registration"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Transfer Dialog */}
      <Dialog open={!!transferReg} onOpenChange={(open) => !open && setTransferReg(null)}>
        <DialogContent className="rounded-3xl p-6 sm:p-8 max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl">Transfer Registration</DialogTitle>
            <DialogDescription>
              Transferring <strong>{transferReg?.userName || transferReg?.userEmail}</strong>'s registration.
            </DialogDescription>
          </DialogHeader>
          
          <Tabs value={transferMode} onValueChange={(v) => setTransferMode(v as "registration" | "payment")} className="mt-4">
            <TabsList className="grid grid-cols-2 w-full mb-6">
              <TabsTrigger value="registration">Full Registration</TabsTrigger>
              <TabsTrigger value="payment" disabled={transferReg?.paymentStatus !== "paid"}>Payment Only</TabsTrigger>
            </TabsList>
            
            <TabsContent value="registration" className="space-y-4">
              <p className="text-sm text-muted-foreground mb-4">
                Move this entire registration (including all attendees and fee selections) to another family member's account.
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
                Keep the registration here, but transfer its "paid" status to another registration in this reunion.
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
            <Button variant="ghost" onClick={() => setTransferReg(null)} className="rounded-xl">Cancel</Button>
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
    </OrganizerLayout>
  );
}
