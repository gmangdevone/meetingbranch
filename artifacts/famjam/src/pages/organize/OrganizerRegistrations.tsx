import { useState, useMemo, useEffect } from "react";
import { useLocation } from "wouter";
import { 
  useListReunionRegistrations, 
  useUpdateRegistrationPayment, 
  useExportReunionRegistrations, 
  getListReunionRegistrationsQueryKey, 
  getGetReunionReportsQueryKey, 
  getGetReunionSummaryQueryKey, 
  useCancelRegistration, 
  useTransferRegistration, 
  getGetSponsorshipFundQueryKey,
  useGetReunion,
  getGetReunionQueryKey,
  useCreateManagedRegistration,
  useSetAttendeeCheckIn,
  useListPaymentSubmissions,
  getListPaymentSubmissionsQueryKey,
  useUpdateContributionPayment,
} from "@workspace/api-client-react";
import { viewerHasRole } from "../../lib/roles";
import { useQueryClient } from "@tanstack/react-query";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Search, Download, Filter, Ban, Send, AlertTriangle, Plus, Trash2, ClipboardCheck, Pencil, Receipt, CheckCircle2, Clock } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "../../components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { Label } from "../../components/ui/label";
import { RadioGroup, RadioGroupItem } from "../../components/ui/radio-group";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "../../components/ui/form";
import { Checkbox } from "../../components/ui/checkbox";
import { useToast } from "../../hooks/use-toast";
import { OrganizerLayout } from "./OrganizerLayout";
import { format } from "date-fns";

const SHIRT_SIZES = ["XS", "S", "M", "L", "XL", "2XL", "3XL"] as const;

const managedRegistrationSchema = z.object({
  memberFirstName: z.string().min(1, "First name is required"),
  memberLastName: z.string().optional(),
  branchName: z.string().min(1, "Please select a branch"),
  attendees: z.array(z.object({
    name: z.string().min(1, "Name is required"),
    shirtSize: z.enum(SHIRT_SIZES, { required_error: "Shirt size is required" }),
    dietaryRestrictions: z.string().optional(),
    age: z.preprocess((val) => {
      if (val === "" || val === undefined || val === null) return undefined;
      return Number(val);
    }, z.number().int().min(0).max(120).optional())
  })).min(1, "Add at least one attendee"),
  selectedFeeIds: z.array(z.number()).optional(),
});

export function OrganizerRegistrations({ params }: { params: { reunionId: string } }) {
  const reunionId = parseInt(params.reunionId, 10);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  
  const { data: registrations, isLoading } = useListReunionRegistrations(reunionId, {
    query: { enabled: !isNaN(reunionId), queryKey: getListReunionRegistrationsQueryKey(reunionId) }
  });

  const { data: summary } = useGetReunion(reunionId, {
    query: { enabled: !isNaN(reunionId), queryKey: getGetReunionQueryKey(reunionId) }
  });
  const reunion = summary?.reunion;
  const viewer = summary?.viewer;
  const isPowerUser = viewerHasRole(viewer, "power_user");

  const updatePayment = useUpdateRegistrationPayment();
  const updateContributionPayment = useUpdateContributionPayment();
  const cancelMutation = useCancelRegistration();
  const transferMutation = useTransferRegistration();
  const createManagedRegistration = useCreateManagedRegistration();
  const setCheckIn = useSetAttendeeCheckIn();

  const { refetch: fetchExport, isFetching: isExporting } = useExportReunionRegistrations(reunionId, { query: { enabled: false, queryKey: ['export', reunionId] } });

  // Registrant-recorded payment submissions (Cash App / Zelle / cash / check),
  // grouped per registration for the reconciliation dialog.
  const { data: paymentSubmissionsData } = useListPaymentSubmissions(reunionId, {
    query: { enabled: !isNaN(reunionId), queryKey: getListPaymentSubmissionsQueryKey(reunionId) },
  });
  const submissionsByRegistration = useMemo(() => {
    const map = new Map<number, NonNullable<typeof paymentSubmissionsData>["submissions"]>();
    for (const s of paymentSubmissionsData?.submissions ?? []) {
      // A submission can cover several registrations; show it under each one.
      // Contribution-only submissions have no registration and are skipped here.
      const covered = s.registrationIds?.length
        ? s.registrationIds
        : s.registrationId != null
          ? [s.registrationId]
          : [];
      for (const regId of covered) {
        const list = map.get(regId) ?? [];
        list.push(s);
        map.set(regId, list);
      }
    }
    return map;
  }, [paymentSubmissionsData]);
  const [submissionsRegId, setSubmissionsRegId] = useState<number | null>(null);
  // Submissions that cover ONLY standalone fund chip-ins — they have no
  // registration row to appear under, so they get their own section.
  const chipInOnlySubmissions = useMemo(
    () =>
      (paymentSubmissionsData?.submissions ?? []).filter(
        (s) => !s.registrationIds?.length && s.registrationId == null,
      ),
    [paymentSubmissionsData],
  );

  // Dialog state
  const [cancelReg, setCancelReg] = useState<any>(null);
  const [cancelResolution, setCancelResolution] = useState<'refunded' | 'donated_to_fund'>('refunded');

  const [transferReg, setTransferReg] = useState<any>(null);
  const [transferMode, setTransferMode] = useState<"registration" | "payment">("registration");
  const [targetEmail, setTargetEmail] = useState("");
  const [targetRegistrationId, setTargetRegistrationId] = useState("");

  const [registerDialogOpen, setRegisterDialogOpen] = useState(false);
  const [checkInRegId, setCheckInRegId] = useState<number | null>(null);
  // Live row for the check-in dialog so checkbox states update as data refetches.
  const checkInReg = useMemo(
    () => registrations?.find((r) => r.id === checkInRegId) ?? null,
    [registrations, checkInRegId],
  );

  const handleMarkChipInPaid = (contributionId: number) => {
    updateContributionPayment.mutate(
      { reunionId, contributionId, data: { paymentStatus: "paid" } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPaymentSubmissionsQueryKey(reunionId) });
          queryClient.invalidateQueries({ queryKey: getGetSponsorshipFundQueryKey(reunionId) });
        },
      },
    );
  };

  const handleToggleCheckIn = (attendeeId: number, checkedIn: boolean) => {
    setCheckIn.mutate(
      { reunionId, attendeeId, data: { checkedIn } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListReunionRegistrationsQueryKey(reunionId) });
        },
      },
    );
  };

  const form = useForm<z.infer<typeof managedRegistrationSchema>>({
    resolver: zodResolver(managedRegistrationSchema),
    defaultValues: {
      memberFirstName: "",
      memberLastName: "",
      branchName: "",
      attendees: [{ name: "", shirtSize: "M", dietaryRestrictions: "", age: undefined }],
      selectedFeeIds: [],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "attendees",
  });

  const firstName = form.watch("memberFirstName");
  const lastName = form.watch("memberLastName");
  const watchAttendees = form.watch("attendees");
  const [lastSyncedName, setLastSyncedName] = useState("");

  useEffect(() => {
    if (fields.length > 0) {
      const currentName = watchAttendees[0]?.name || "";
      const newFullName = [firstName, lastName].filter(Boolean).join(" ");
      
      if (!currentName || currentName === lastSyncedName) {
        form.setValue("attendees.0.name", newFullName, { shouldValidate: !!newFullName });
        setLastSyncedName(newFullName);
      }
    }
  }, [firstName, lastName, fields.length]);

  const onSubmitManaged = (values: z.infer<typeof managedRegistrationSchema>) => {
    createManagedRegistration.mutate({
      reunionId,
      data: {
        memberFirstName: values.memberFirstName,
        memberLastName: values.memberLastName,
        branchName: values.branchName,
        attendees: values.attendees.map(a => ({
          name: a.name,
          shirtSize: a.shirtSize,
          dietaryRestrictions: a.dietaryRestrictions || undefined,
          age: a.age,
        })),
        selectedFeeIds: values.selectedFeeIds && values.selectedFeeIds.length > 0 ? values.selectedFeeIds : undefined,
      }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListReunionRegistrationsQueryKey(reunionId) });
        queryClient.invalidateQueries({ queryKey: getGetReunionReportsQueryKey(reunionId) });
        queryClient.invalidateQueries({ queryKey: getGetReunionSummaryQueryKey(reunionId) });
        toast({ title: "Registration created" });
        setRegisterDialogOpen(false);
        form.reset();
        setLastSyncedName("");
      }
    });
  };

  const optionalFees = useMemo(() => {
    return reunion?.fees?.filter(f => f.isOptional) || [];
  }, [reunion?.fees]);

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
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => setRegisterDialogOpen(true)} className="rounded-full shadow-lg hover:-translate-y-0.5 transition-transform">
              <Plus className="w-4 h-4 mr-2" /> Register Member
            </Button>
            <Button onClick={handleExport} variant="outline" className="rounded-full" disabled={isExporting || !registrations?.length}>
              <Download className="w-4 h-4 mr-2" /> Export CSV
            </Button>
          </div>
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
                  <th className="px-4 py-3">Check-in</th>
                  <th className="px-4 py-3">Payment</th>
                  <th className="px-4 py-3 rounded-tr-xl">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {isLoading ? (
                  <tr><td colSpan={7} className="text-center py-8">Loading...</td></tr>
                ) : filteredRegistrations.length === 0 ? (
                  <tr><td colSpan={7} className="text-center py-8 text-muted-foreground">No registrations found.</td></tr>
                ) : (
                  filteredRegistrations.map((reg) => {
                    const isCancelled = reg.status === 'cancelled';
                    return (
                    <tr key={reg.id} className={`hover:bg-muted/30 transition-colors ${isCancelled ? 'opacity-60 bg-muted/10' : ''}`}>
                      <td className="px-4 py-4">
                        <div className="font-medium text-foreground flex items-center gap-2">
                          {reg.userName || "Unknown"}
                          <span className="text-xs text-muted-foreground font-mono bg-muted px-1 rounded">#{reg.id}</span>
                        </div>
                        <div className="text-muted-foreground text-xs flex items-center gap-2 mt-1">
                          <span className="truncate max-w-[150px]">{reg.userEmail}</span>
                          {reg.registrantIsManaged && (
                            <span className="inline-block bg-primary/10 text-primary px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider">
                              Registered by organizer
                            </span>
                          )}
                        </div>
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
                        {!isCancelled && (() => {
                          const checkedIn = reg.attendees.filter((a) => a.checkedInAt).length;
                          const total = reg.attendees.length;
                          const allIn = total > 0 && checkedIn === total;
                          return (
                            <Button
                              variant="outline"
                              size="sm"
                              className={`h-8 px-2 text-xs rounded-lg ${allIn ? 'bg-green-100 text-green-700 border-green-200 hover:bg-green-200 hover:text-green-800 dark:bg-green-900/30 dark:text-green-400 dark:border-green-900/40' : checkedIn > 0 ? 'bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-200 hover:text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-900/40' : ''}`}
                              onClick={() => setCheckInRegId(reg.id)}
                            >
                              <ClipboardCheck className="w-3 h-3 mr-1" /> {checkedIn}/{total}
                            </Button>
                          );
                        })()}
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
                        {(submissionsByRegistration.get(reg.id)?.length ?? 0) > 0 && (
                          <button
                            type="button"
                            onClick={() => setSubmissionsRegId(reg.id)}
                            className="mt-1.5 flex items-center gap-1 text-xs font-bold text-primary hover:underline"
                          >
                            <Receipt className="w-3.5 h-3.5" />
                            {submissionsByRegistration.get(reg.id)!.length}{" "}
                            {submissionsByRegistration.get(reg.id)!.length === 1 ? "payment note" : "payment notes"}
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        {!isCancelled && (
                          <div className="flex flex-wrap gap-2">
                            {reunion?.code && (
                              <Button variant="outline" size="sm" className="h-8 px-2 text-xs rounded-lg" onClick={() => setLocation(`/r/${reunion.code}/register/edit/${reg.id}`)}>
                                <Pencil className="w-3 h-3 mr-1" /> Edit
                              </Button>
                            )}
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

      {chipInOnlySubmissions.length > 0 && (
        <div className="bg-card border shadow-sm rounded-3xl p-6">
          <h2 className="font-serif text-2xl font-bold mb-1">Fund Chip-in Payments</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Payment notes covering only standalone fund chip-ins. Confirm the money arrived,
            then mark each chip-in paid below{isPowerUser ? "." : " on the Sponsorship page."}
          </p>
          <div className="divide-y">
            {chipInOnlySubmissions.map((s) => (
              <div key={s.id} className="py-4 first:pt-0 last:pb-0 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-bold uppercase tracking-wide text-sm">
                    {s.method === "cashapp" ? "Cash App" : s.method === "zelle" ? "Zelle" : s.method === "check" ? "Check" : "Cash"}
                  </span>
                  <span className="font-bold text-lg tabular-nums">${s.amount}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Submitted {format(new Date(s.createdAt), "MMM d, yyyy 'at' h:mm a")}
                </p>
                {(s.submittedByName || s.submittedByEmail) && (
                  <p className="text-xs text-muted-foreground">
                    Submitted by{" "}
                    <span className="font-medium text-foreground">
                      {s.submittedByName ?? s.submittedByEmail}
                    </span>
                    {s.submittedByName && s.submittedByEmail && (
                      <> (<span className="font-mono">{s.submittedByEmail}</span>)</>
                    )}
                  </p>
                )}
                {s.reference && (
                  <p className="text-sm">
                    <span className="text-muted-foreground">
                      {s.method === "cashapp" ? "Their $cashtag: " : s.method === "zelle" ? "Their Zelle ID: " : s.method === "cash" ? "Given to: " : "Check #: "}
                    </span>
                    <span className="font-mono font-bold">{s.reference}</span>
                  </p>
                )}
                {s.givenDate && (
                  <p className="text-sm">
                    <span className="text-muted-foreground">Date given: </span>
                    <span className="font-bold">{s.givenDate}</span>
                  </p>
                )}
                {s.note && (
                  <p className="text-sm bg-muted/50 border rounded-lg px-3 py-2 whitespace-pre-wrap">{s.note}</p>
                )}
                {/* Chip-in detail rows */}
                {s.contributions.length > 0 && (
                  <div className="mt-2 space-y-1.5">
                    <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide">
                      Covered chip-in{s.contributions.length === 1 ? "" : "s"}
                    </p>
                    {s.contributions.map((c) => (
                      <div key={c.id} className="flex items-center justify-between gap-2 rounded-xl border bg-muted/30 px-3 py-2">
                        <div className="flex flex-col min-w-0">
                          <span className="text-sm font-medium truncate">{c.contributorName ?? "Anonymous"}</span>
                          <span className="text-xs text-muted-foreground">
                            {format(new Date(c.createdAt), "MMM d, yyyy")}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="font-bold tabular-nums text-sm">${c.amount}</span>
                          {c.paymentStatus === "paid" ? (
                            <span className="flex items-center gap-1 text-xs font-bold text-green-700 dark:text-green-400">
                              <CheckCircle2 className="w-3.5 h-3.5" /> Paid
                            </span>
                          ) : isPowerUser ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-xs rounded-lg"
                              disabled={updateContributionPayment.isPending}
                              onClick={() => handleMarkChipInPaid(c.id)}
                            >
                              Mark paid
                            </Button>
                          ) : (
                            <span className="flex items-center gap-1 text-xs font-bold text-amber-700 dark:text-amber-400">
                              <Clock className="w-3.5 h-3.5" /> Pending
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <Dialog open={submissionsRegId !== null} onOpenChange={(open) => { if (!open) setSubmissionsRegId(null); }}>
        <DialogContent className="rounded-3xl p-6 sm:p-8 max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl">Payment Submissions</DialogTitle>
            <DialogDescription>
              Details recorded by the registrant. Confirm the money actually arrived before
              marking the registration paid — submitting never changes the status.
            </DialogDescription>
          </DialogHeader>
          <div className="divide-y">
            {(submissionsByRegistration.get(submissionsRegId ?? -1) ?? []).map((s) => (
              <div key={s.id} className="py-4 first:pt-0 last:pb-0 space-y-1.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-bold uppercase tracking-wide text-sm">
                    {s.method === "cashapp" ? "Cash App" : s.method === "zelle" ? "Zelle" : s.method === "check" ? "Check" : "Cash"}
                  </span>
                  <span className="font-bold text-lg tabular-nums">${s.amount}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Submitted {format(new Date(s.createdAt), "MMM d, yyyy 'at' h:mm a")}
                </p>
                {(s.submittedByName || s.submittedByEmail) && (
                  <p className="text-xs text-muted-foreground">
                    Submitted by{" "}
                    <span className="font-medium text-foreground">
                      {s.submittedByName ?? s.submittedByEmail}
                    </span>
                    {s.submittedByName && s.submittedByEmail && (
                      <> (<span className="font-mono">{s.submittedByEmail}</span>)</>
                    )}
                  </p>
                )}
                {(s.registrationIds?.length ?? 0) > 1 && (
                  <p className="text-xs font-bold text-amber-700 dark:text-amber-400">
                    Covers {s.registrationIds.length} registrations in one payment
                  </p>
                )}
                {s.contributions.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide">
                      Also covers {s.contributions.length} fund chip-in{s.contributions.length === 1 ? "" : "s"}
                    </p>
                    {s.contributions.map((c) => (
                      <div key={c.id} className="flex items-center justify-between gap-2 rounded-xl border bg-muted/30 px-3 py-2">
                        <div className="flex flex-col min-w-0">
                          <span className="text-sm font-medium truncate">{c.contributorName ?? "Anonymous"}</span>
                          <span className="text-xs text-muted-foreground">
                            {format(new Date(c.createdAt), "MMM d, yyyy")}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="font-bold tabular-nums text-sm">${c.amount}</span>
                          {c.paymentStatus === "paid" ? (
                            <span className="flex items-center gap-1 text-xs font-bold text-green-700 dark:text-green-400">
                              <CheckCircle2 className="w-3.5 h-3.5" /> Paid
                            </span>
                          ) : isPowerUser ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-xs rounded-lg"
                              disabled={updateContributionPayment.isPending}
                              onClick={() => handleMarkChipInPaid(c.id)}
                            >
                              Mark paid
                            </Button>
                          ) : (
                            <span className="flex items-center gap-1 text-xs font-bold text-amber-700 dark:text-amber-400">
                              <Clock className="w-3.5 h-3.5" /> Pending
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {s.reference && (
                  <p className="text-sm">
                    <span className="text-muted-foreground">
                      {s.method === "cashapp" ? "Their $cashtag: " : s.method === "zelle" ? "Their Zelle ID: " : s.method === "cash" ? "Given to: " : "Check #: "}
                    </span>
                    <span className="font-mono font-bold">{s.reference}</span>
                  </p>
                )}
                {s.givenDate && (
                  <p className="text-sm">
                    <span className="text-muted-foreground">Date given: </span>
                    <span className="font-bold">{s.givenDate}</span>
                  </p>
                )}
                {s.note && (
                  <p className="text-sm bg-muted/50 border rounded-lg px-3 py-2 whitespace-pre-wrap">{s.note}</p>
                )}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={registerDialogOpen} onOpenChange={setRegisterDialogOpen}>
        <DialogContent className="rounded-3xl p-6 sm:p-8 max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl">Register a Family Member</DialogTitle>
            <DialogDescription asChild>
              <div>
                Create a registration for someone who isn't signing up themselves. 
                <br className="mb-2"/>
                <span className="inline-block bg-primary/10 text-primary px-2 py-1 rounded-md text-xs font-medium mt-2">
                  This registration is managed by organizers and uses a shared contact email. The member won't get their own login.
                </span>
              </div>
            </DialogDescription>
          </DialogHeader>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmitManaged)} className="space-y-6 mt-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="memberFirstName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>First Name</FormLabel>
                      <FormControl>
                        <Input placeholder="John" className="rounded-xl" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="memberLastName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Last Name (Optional)</FormLabel>
                      <FormControl>
                        <Input placeholder="Doe" className="rounded-xl" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="branchName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Family Branch</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger className="rounded-xl">
                          <SelectValue placeholder="Select a branch..." />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {reunion?.branches.sort((a, b) => a.sortOrder - b.sortOrder).map(branch => (
                          <SelectItem key={branch.id} value={branch.name}>{branch.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="space-y-4">
                <div className="flex items-center justify-between border-b pb-2">
                  <h3 className="font-serif text-lg font-bold">Attendees</h3>
                </div>

                {fields.map((field, index) => (
                  <div key={field.id} className="bg-muted/30 border p-4 rounded-2xl relative">
                    {fields.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute top-2 right-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-full h-8 w-8"
                        onClick={() => remove(index)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                    
                    <h4 className="font-bold text-xs uppercase tracking-widest text-muted-foreground mb-3">Person {index + 1}</h4>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name={`attendees.${index}.name`}
                        render={({ field: inputField }) => (
                          <FormItem className="md:col-span-2">
                            <FormLabel>Full Name</FormLabel>
                            <FormControl>
                              <Input placeholder="Jane Doe" className="rounded-xl" {...inputField} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      
                      <FormField
                        control={form.control}
                        name={`attendees.${index}.shirtSize`}
                        render={({ field: inputField }) => (
                          <FormItem>
                            <FormLabel>T-Shirt Size</FormLabel>
                            <Select onValueChange={inputField.onChange} defaultValue={inputField.value}>
                              <FormControl>
                                <SelectTrigger className="rounded-xl">
                                  <SelectValue placeholder="Size" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {SHIRT_SIZES.map(size => (
                                  <SelectItem key={size} value={size}>{size}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      
                      <FormField
                        control={form.control}
                        name={`attendees.${index}.age`}
                        render={({ field: inputField }) => (
                          <FormItem>
                            <FormLabel>Age (Optional)</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                min={0}
                                max={120}
                                placeholder="e.g. 34"
                                className="rounded-xl"
                                {...inputField}
                                value={inputField.value ?? ""}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name={`attendees.${index}.dietaryRestrictions`}
                        render={({ field: inputField }) => (
                          <FormItem className="md:col-span-2">
                            <FormLabel>Dietary Info (Optional)</FormLabel>
                            <FormControl>
                              <Input placeholder="e.g. Vegetarian, Peanut allergy" className="rounded-xl" {...inputField} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>
                ))}

                <Button
                  type="button"
                  variant="outline"
                  onClick={() => append({ name: "", shirtSize: "M", dietaryRestrictions: "", age: undefined })}
                  className="w-full py-4 border-dashed rounded-2xl text-muted-foreground hover:text-foreground"
                >
                  <Plus className="mr-2 w-4 h-4" /> Add Another Person
                </Button>
              </div>

              {optionalFees.length > 0 && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between border-b pb-2">
                    <h3 className="font-serif text-lg font-bold">Optional Fees</h3>
                  </div>
                  <div className="space-y-3">
                    {optionalFees.map(fee => (
                      <FormField
                        key={fee.id}
                        control={form.control}
                        name="selectedFeeIds"
                        render={({ field }) => {
                          return (
                            <FormItem
                              key={fee.id}
                              className="flex flex-row items-start space-x-3 space-y-0 p-3 rounded-xl border bg-card hover:bg-muted/30 transition-colors cursor-pointer"
                            >
                              <FormControl>
                                <Checkbox
                                  checked={field.value?.includes(fee.id)}
                                  onCheckedChange={(checked) => {
                                    return checked
                                      ? field.onChange([...(field.value || []), fee.id])
                                      : field.onChange(
                                          field.value?.filter(
                                            (value) => value !== fee.id
                                          )
                                        )
                                  }}
                                />
                              </FormControl>
                              <div className="space-y-1 leading-none flex-1">
                                <FormLabel className="font-medium cursor-pointer">
                                  {fee.label}
                                </FormLabel>
                              </div>
                            </FormItem>
                          )
                        }}
                      />
                    ))}
                  </div>
                </div>
              )}

              {createManagedRegistration.isError && (
                <div className="p-3 bg-destructive/10 text-destructive text-sm font-medium rounded-xl">
                  {(createManagedRegistration.error as any)?.error || "Failed to create registration. Please try again."}
                </div>
              )}

              <div className="flex justify-end gap-3 pt-4 border-t">
                <Button type="button" variant="ghost" onClick={() => setRegisterDialogOpen(false)} className="rounded-xl">Cancel</Button>
                <Button type="submit" disabled={createManagedRegistration.isPending} className="rounded-xl">
                  {createManagedRegistration.isPending ? "Creating..." : "Create Registration"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Check-in Dialog */}
      <Dialog open={!!checkInReg} onOpenChange={(open) => !open && setCheckInRegId(null)}>
        <DialogContent className="rounded-3xl p-6 sm:p-8 max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl flex items-center gap-2">
              <ClipboardCheck className="w-6 h-6 text-primary" /> Check In Attendees
            </DialogTitle>
            <DialogDescription>
              {checkInReg?.userName || checkInReg?.userEmail} — mark who has arrived. Checked-in households can vote in family polls.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 mt-2">
            {checkInReg?.attendees.map((a) => {
              const isIn = !!a.checkedInAt;
              return (
                <label
                  key={a.id}
                  className={`flex items-center justify-between gap-3 border rounded-xl p-3 cursor-pointer transition-colors ${isIn ? 'border-green-300 bg-green-50 dark:bg-green-900/10 dark:border-green-900/40' : 'hover:bg-muted/30'}`}
                >
                  <div className="flex items-center gap-3">
                    <Checkbox
                      checked={isIn}
                      disabled={setCheckIn.isPending}
                      onCheckedChange={(checked) => handleToggleCheckIn(a.id, checked === true)}
                    />
                    <div>
                      <div className="font-medium">{a.name}</div>
                      {isIn && a.checkedInAt && (
                        <div className="text-xs text-muted-foreground">
                          Checked in {format(new Date(a.checkedInAt), 'MMM d, h:mm a')}
                        </div>
                      )}
                    </div>
                  </div>
                </label>
              );
            })}
          </div>
          <div className="flex justify-between items-center gap-3 pt-4 border-t mt-2">
            <Button
              variant="outline"
              size="sm"
              className="rounded-xl text-xs"
              disabled={setCheckIn.isPending || !checkInReg}
              onClick={() => {
                const anyNotIn = checkInReg?.attendees.some((a) => !a.checkedInAt);
                checkInReg?.attendees
                  .filter((a) => (anyNotIn ? !a.checkedInAt : true))
                  .forEach((a) => handleToggleCheckIn(a.id, !!anyNotIn));
              }}
            >
              {checkInReg?.attendees.some((a) => !a.checkedInAt) ? 'Check in everyone' : 'Undo all check-ins'}
            </Button>
            <Button className="rounded-xl" onClick={() => setCheckInRegId(null)}>Done</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Cancel Dialog */}
      <Dialog open={!!cancelReg} onOpenChange={(open) => !open && setCancelReg(null)}>
        <DialogContent className="rounded-3xl p-6 sm:p-8 max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl text-destructive flex items-center gap-2">
              <AlertTriangle className="w-6 h-6" /> Cancel Registration
            </DialogTitle>
            <DialogDescription asChild>
              <div>
                Are you sure you want to cancel the registration for <strong>{cancelReg?.userName || cancelReg?.userEmail}</strong>? This action cannot be undone.
              </div>
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
            <DialogDescription asChild>
              <div>
                Transferring <strong>{transferReg?.userName || transferReg?.userEmail}</strong>'s registration.
              </div>
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
