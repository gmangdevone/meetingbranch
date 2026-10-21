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
  useListBranchFees,
  getListBranchFeesQueryKey,
  getListPaymentSubmissionsQueryKey,
  useUpdateContributionPayment,
} from "@workspace/api-client-react";
import { viewerHasRole } from "../../lib/roles";
import { useQueryClient } from "@tanstack/react-query";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Search, Download, Filter, AlertTriangle, Plus, Trash2, ClipboardCheck, CheckCircle2, Clock } from "lucide-react";
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
import { eventCodePath } from "../../lib/eventCode";
import { format } from "date-fns";
import { computeTotal, isConfiguredDinner, isDinnerFee, isAddOnFee } from "../../lib/fees";
import { AddOnPicker, AddOnPurchaseList } from "../../components/AddOnPicker";
import { addOnProblems, buildPurchases, centsLabel, offeredAddOns, picksToSelections, seedPicks, type AddOnPicks } from "../../lib/addOns";
import { defaultDinnerIds, offeredDinners } from "../../lib/dinnerChoices";
import { DinnerModeControls } from "../../components/DinnerModeControls";
import { registrationAddOns, attendeeAddOns, attendeeDinnerStatus } from "../../lib/registrationAddOns";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "../../components/ui/sheet";
import { LedgerHistory } from "../../components/payments/LedgerPanel";
import { RecordPaymentDialog, type PayableRegistration, type RecordPaymentPreset } from "../../components/payments/RecordPaymentDialog";
import { invalidateMoney, money, parseCents, transferMoneyIds } from "../../components/payments/money";
import { Wallet, FileSpreadsheet, SlidersHorizontal } from "lucide-react";
import { RegistrationTable, type DetailKind, type RegistrationActions } from "../../components/registrations/RegistrationTable";
import { RegistrationDetailsSheet } from "../../components/registrations/RegistrationDetailsSheet";
import { CustomizeViewDialog } from "../../components/registrations/CustomizeViewDialog";
import { useRegistrationView } from "../../components/registrations/useRegistrationView";
import { DEFAULT_FIELDS, FIELD_LABEL, PRESETS, matchPreset } from "../../lib/registrationView";


const managedRegistrationSchema = z.object({
  memberFirstName: z.string().min(1, "First name is required"),
  memberLastName: z.string().optional(),
  branchName: z.string().min(1, "Please select a branch"),
  attendees: z.array(z.object({
    name: z.string().min(1, "Name is required"),
    addOnPicks: z.record(z.string(), z.record(z.string(), z.string())).default({}),
    dietaryRestrictions: z.string().optional(),
    age: z.preprocess((val) => {
      if (val === "" || val === undefined || val === null) return undefined;
      return Number(val);
    }, z.number().int().min(0).max(120).optional()),
    includeDinner: z.boolean().optional(),
    dinnerFeeIds: z.array(z.number()).optional(),
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
  const { data: branchFeesData } = useListBranchFees(reunionId, {
    query: { enabled: !isNaN(reunionId), queryKey: getListBranchFeesQueryKey(reunionId) },
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
  // Money drawer + receipt entry.
  const [moneyRegId, setMoneyRegId] = useState<number | null>(null);
  const [recordFor, setRecordFor] = useState<{ regIds: number[]; preset?: RecordPaymentPreset } | null>(null);
  const [transferAmount, setTransferAmount] = useState("");
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
  const householdAddOns = checkInReg
    ? registrationAddOns(reunion?.fees ?? [], checkInReg.selectedFeeIds ?? [], checkInReg.attendees)
      .filter(item => item.fee.chargeType === "flat")
    : [];

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
      attendees: [{ name: "", dietaryRestrictions: "", age: undefined, includeDinner: true, addOnPicks: {} }],
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
  const watchSelectedFees = form.watch("selectedFeeIds") ?? [];
  const managedFees = reunion?.fees ?? [];
  const hasManagedDinner = managedFees.some(isDinnerFee);
  const newDinnerIds = defaultDinnerIds(managedFees);
  const managedOffers = (index: number) => offeredDinners(managedFees, watchSelectedFees, watchAttendees[index]?.dinnerFeeIds ?? []);
  const toggleManagedDinner = (index: number, feeId: number, on: boolean) => {
    const cur = form.getValues(`attendees.${index}.dinnerFeeIds`) ?? [];
    const next = on ? [...new Set([...cur, feeId])] : cur.filter((id) => id !== feeId);
    form.setValue(`attendees.${index}.dinnerFeeIds`, next);
    form.setValue(`attendees.${index}.includeDinner`, next.length > 0);
  };
  // Every new registration starts with each visible dinner selected for its attendees.
  useEffect(() => {
    if (!registerDialogOpen || !hasManagedDinner) return;
    form.getValues("attendees").forEach((a, i) => {
      if (a.dinnerFeeIds == null) {
        form.setValue(`attendees.${i}.dinnerFeeIds`, newDinnerIds);
        form.setValue(`attendees.${i}.includeDinner`, newDinnerIds.length > 0);
      }
    });
  }, [registerDialogOpen, hasManagedDinner, reunion?.id]);
  const [lastSyncedName, setLastSyncedName] = useState("");
  const [managedHouseholdPicks, setManagedHouseholdPicks] = useState<AddOnPicks>({});
  const [managedAddOnErrors, setManagedAddOnErrors] = useState<string[]>([]);
  // Seed mandatory add-ons whenever the dialog opens fresh.
  useEffect(() => {
    if (!registerDialogOpen) return;
    form.getValues("attendees").forEach((a, i) => {
      if (Object.keys(a.addOnPicks ?? {}).length === 0) form.setValue(`attendees.${i}.addOnPicks`, seedPicks(managedFees, "attendee"));
    });
    setManagedHouseholdPicks(seedPicks(managedFees, "household"));
    setManagedAddOnErrors([]);
  }, [registerDialogOpen, reunion?.id]);
  const managedHouseholdPurchases = buildPurchases(managedFees, managedHouseholdPicks);
  const managedAttendeeFees = watchAttendees.map((a) => ({
    age: a?.age == null || (a.age as unknown) === "" ? null : Number(a.age),
    includeDinner: hasManagedDinner ? (a?.dinnerFeeIds ?? []).length > 0 : a?.includeDinner !== false,
    dinnerFeeIds: hasManagedDinner ? a?.dinnerFeeIds ?? [] : null,
    addOns: buildPurchases(managedFees, (a?.addOnPicks ?? {}) as AddOnPicks),
  }));
  const managedChosenFees = (attendees: { dinnerFeeIds?: number[] }[], selected: number[]) => [
    ...selected.filter(id => !managedFees.some(f => f.id === id && (isConfiguredDinner(f) || isAddOnFee(f)))),
    // Configured dinners are saved when any attendee picks them.
    ...managedFees.filter((f) => isConfiguredDinner(f) && attendees.some((a) => (a.dinnerFeeIds ?? []).includes(f.id))).map((f) => f.id),
  ];
  const managedPreviewCents = Math.round(computeTotal(managedFees, managedAttendeeFees, managedChosenFees(watchAttendees, watchSelectedFees), managedHouseholdPurchases) * 100);

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
    const problems = [
      ...values.attendees.flatMap((a, i) =>
        addOnProblems(managedFees, (a.addOnPicks ?? {}) as AddOnPicks, "attendee").map((m) => `${a.name?.trim() || `Person ${i + 1}`}: ${m}`)),
      ...addOnProblems(managedFees, managedHouseholdPicks, "household").map((m) => `Household: ${m}`),
    ];
    setManagedAddOnErrors(problems);
    if (problems.length > 0) return;
    const chosenFees = managedChosenFees(values.attendees, values.selectedFeeIds ?? []);
    createManagedRegistration.mutate({
      reunionId,
      data: {
        memberFirstName: values.memberFirstName,
        memberLastName: values.memberLastName,
        branchName: values.branchName,
        attendees: values.attendees.map(a => ({
          name: a.name,
          addOns: picksToSelections((a.addOnPicks ?? {}) as AddOnPicks),
          dietaryRestrictions: a.dietaryRestrictions || undefined,
          age: a.age,
          ...(hasManagedDinner
            ? { dinnerFeeIds: a.dinnerFeeIds ?? [], includeDinner: (a.dinnerFeeIds ?? []).length > 0 }
            : { includeDinner: a.includeDinner !== false }),
        })),
        selectedFeeIds: chosenFees,
        addOns: picksToSelections(managedHouseholdPicks),
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
    return reunion?.fees?.filter(f => f.isOptional && !isAddOnFee(f) && !isConfiguredDinner(f)) || [];
  }, [reunion?.fees]);

  const filteredRegistrations = useMemo(() => {
    if (!registrations) return [];
    return registrations.filter(reg => {
      const matchesSearch = 
        (reg.userName || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
        reg.userEmail.toLowerCase().includes(searchTerm.toLowerCase()) ||
        reg.branchName.toLowerCase().includes(searchTerm.toLowerCase());
      const ledgerStatus = reg.ledger?.status ?? (reg.paymentStatus === "pending" ? "unpaid" : reg.paymentStatus);
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "outstanding" ? reg.status !== "cancelled" && (reg.ledger?.balanceCents ?? 0) > 0 :
         statusFilter === "reported" ? (reg.ledger?.pendingReportedCents ?? 0) > 0 :
         statusFilter === "credit" ? (reg.ledger?.creditCents ?? 0) > 0 :
         ledgerStatus === statusFilter);
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
        // Includes the open ledger panel's query for this registration.
        invalidateMoney(queryClient, reunionId, [registrationId]);
        toast({ title: status === "waived" ? "Remaining fees waived" : "Waiver removed" });
      },
      onError: (err: any) => toast({ title: err?.error || "Could not update", variant: "destructive" }),
    });
  };

  const moneyReg = useMemo(() => registrations?.find((r) => r.id === moneyRegId) ?? null, [registrations, moneyRegId]);
  const payableFor = (ids: number[]): PayableRegistration[] =>
    (registrations ?? [])
      .filter((r) => ids.includes(r.id) && r.ledger && r.status !== "cancelled")
      .map((r) => ({
        id: r.id, label: `#${r.id} ${r.userName || r.branchName}`, ledger: r.ledger!,
        submittedCashAppTags: [...new Set((submissionsByRegistration.get(r.id) ?? [])
          .filter((s) => s.method === "cashapp" && s.reference?.trim())
          .map((s) => s.reference!.trim()))],
      }));

  const handleReceiptsExport = async () => {
    const res = await fetch(`${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/reunions/${reunionId}/receipts/export`, { credentials: "include" });
    if (!res.ok) {
      toast({ title: "Could not export receipts", variant: "destructive" });
      return;
    }
    const url = URL.createObjectURL(await res.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = `reunion-${reunionId}-receipts.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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

  // Personal view (account-scoped) and per-row routing. Rows are looked up by
  // ID from the live list so actions always target the clicked registration.
  const view = useRegistrationView();
  const viewFields = view.fields ?? (view.isError ? DEFAULT_FIELDS : null);
  const tableFields = viewFields ?? DEFAULT_FIELDS;
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [viewSaved, setViewSaved] = useState(false);
  const [details, setDetails] = useState<{ id: number; kind: DetailKind } | null>(null);
  const detailsReg = useMemo(() => registrations?.find((r) => r.id === details?.id) ?? null, [registrations, details?.id]);
  const byId = (id: number) => registrations?.find((r) => r.id === id) ?? null;
  const rowActions: RegistrationActions = {
    onCheckIn: (id) => setCheckInRegId(id),
    onPayments: (id) => setMoneyRegId(id),
    onSubmissions: (id) => setSubmissionsRegId(id),
    onEdit: reunion?.code ? (id) => setLocation(eventCodePath(reunion.code, `/register/edit/${id}`)) : null,
    onTransfer: (id) => setTransferReg(byId(id)),
    onCancel: (id) => setCancelReg(byId(id)),
    onDetails: (id, kind) => setDetails({ id, kind }),
  };

  const handleCancel = () => {
    if (!cancelReg) return;
    const isPaid = (cancelReg.ledger ? cancelReg.ledger.confirmedCents + cancelReg.ledger.legacyCreditCents : 0) > 0 || cancelReg.paymentStatus === 'paid';
    cancelMutation.mutate({
      reunionId,
      registrationId: cancelReg.id,
      data: {
        resolution: isPaid ? cancelResolution : undefined
      }
    }, {
      onSuccess: () => {
        invalidateMoney(queryClient, reunionId, [cancelReg.id]);
        toast({ title: "Registration cancelled" });
        setCancelReg(null);
      }
    });
  };

  const handleTransfer = () => {
    if (!transferReg) return;
    const movedIds = transferMoneyIds(transferReg.id, transferMode, parseInt(targetRegistrationId, 10));
    transferMutation.mutate({
      id: transferReg.id,
      data: {
        kind: transferMode,
        targetEmail: transferMode === "registration" ? targetEmail : undefined,
        targetRegistrationId: transferMode === "payment" ? parseInt(targetRegistrationId, 10) : undefined,
        amountCents: transferMode === "payment" && transferAmount.trim() ? parseCents(transferAmount) ?? -1 : undefined,
      }
    }, {
      onSuccess: () => {
        invalidateMoney(queryClient, reunionId, movedIds);
        setTransferAmount("");
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
            <Button onClick={handleReceiptsExport} variant="outline" className="rounded-full">
              <FileSpreadsheet className="w-4 h-4 mr-2" /> Receipts CSV
            </Button>
          </div>
        </div>

        {reunion && (
          <DinnerModeControls reunionId={reunionId} fees={reunion.fees} />
        )}

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
                  <SelectItem value="outstanding">Balance due</SelectItem>
                  <SelectItem value="unpaid">Unpaid</SelectItem>
                  <SelectItem value="partial">Partially paid</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
                  <SelectItem value="waived">Waived</SelectItem>
                  <SelectItem value="reported">Reported, unconfirmed</SelectItem>
                  <SelectItem value="credit">Credit to review</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <p className="text-xs text-muted-foreground" data-testid="text-view-summary">
              {viewFields ? `Showing Registrant, ${viewFields.map((f) => FIELD_LABEL[f]).join(", ") || "menu only"}` : "Loading your view"}
              {viewFields && matchPreset(viewFields) ? ` · ${PRESETS[matchPreset(viewFields)!].label} view` : viewFields ? " · Custom view" : ""}
            </p>
            <Button variant="outline" size="sm" className="rounded-full h-8" onClick={() => setCustomizeOpen(true)} disabled={!view.fields && !view.isError} data-testid="button-customize-view">
              <SlidersHorizontal className="w-3.5 h-3.5 mr-1.5" aria-hidden /> Customize view
            </Button>
          </div>
          {view.isError && (
            <div role="alert" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" data-testid="text-view-load-error">
              <span>Could not load your saved view. Showing the default layout for now.</span>
              <Button size="sm" variant="outline" className="h-7 rounded-lg" onClick={() => view.refetch()}>Retry</Button>
            </div>
          )}
          {view.resetInvalid && (
            <div role="status" className="mb-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900" data-testid="text-view-reset-invalid">
              Your saved view contained settings that are no longer supported, so the default view is shown. Customize and save to choose a new layout.
            </div>
          )}
          {viewSaved && (
            <div role="status" className="mb-3 flex items-center justify-between gap-2 rounded-xl border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800" data-testid="text-view-saved">
              <span>View saved to your account.</span>
              <button type="button" className="text-xs font-bold underline" onClick={() => setViewSaved(false)}>Dismiss</button>
            </div>
          )}
          <RegistrationTable
            rows={filteredRegistrations}
            fields={tableFields}
            fees={reunion?.fees ?? []}
            isLoading={isLoading || (!view.fields && !view.isError)}
            submissionCount={(id) => submissionsByRegistration.get(id)?.length ?? 0}
            actions={rowActions}
          />
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
                  <span className="font-bold text-lg tabular-nums">{money(s.amountCents ?? Math.round(s.amount * 100))}</span>
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
                          <span className="font-bold tabular-nums text-sm">{money(Math.round(c.amount * 100))}</span>
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

      <CustomizeViewDialog
        open={customizeOpen}
        onOpenChange={setCustomizeOpen}
        current={viewFields ?? DEFAULT_FIELDS}
        queryKey={view.queryKey}
        needsRepair={view.resetInvalid}
        onSaved={() => setViewSaved(true)}
      />
      <RegistrationDetailsSheet reg={detailsReg} kind={details?.kind ?? null} fees={reunion?.fees ?? []} onClose={() => setDetails(null)} />

      <Sheet open={moneyRegId !== null} onOpenChange={(o) => { if (!o) setMoneyRegId(null); }}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          {moneyReg && (
            <>
              <SheetHeader className="text-left">
                <SheetTitle className="font-serif text-2xl">{moneyReg.userName || moneyReg.userEmail || `Registration #${moneyReg.id}`}</SheetTitle>
                <SheetDescription>
                  #{moneyReg.id} · {moneyReg.branchName} · {moneyReg.attendeeCount} {moneyReg.attendeeCount === 1 ? "attendee" : "attendees"}
                </SheetDescription>
              </SheetHeader>
              <div className="mt-4 flex flex-wrap gap-2">
                {moneyReg.status !== "cancelled" && moneyReg.paymentStatus !== "waived" && (
                  <Button className="rounded-xl" onClick={() => setRecordFor({ regIds: [moneyReg.id] })}>
                    <Wallet className="w-4 h-4 mr-2" /> Record payment
                  </Button>
                )}
                {moneyReg.status !== "cancelled" && (
                  <Button
                    variant="outline"
                    className="rounded-xl"
                    disabled={updatePayment.isPending}
                    onClick={() => handleUpdateStatus(moneyReg.id, moneyReg.paymentStatus === "waived" ? "pending" : "waived")}
                  >
                    {moneyReg.paymentStatus === "waived" ? "Remove waiver" : "Waive remaining fees"}
                  </Button>
                )}
              </div>
              <div className="mt-6">
                <LedgerHistory
                  registrationId={moneyReg.id}
                  reunionId={reunionId}
                  onReplace={(e) =>
                    setRecordFor({ regIds: [moneyReg.id], preset: { replacesReceiptId: e.id, method: e.method ?? undefined, receivedDate: e.receivedDate } })
                  }
                />
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {recordFor && (
        <RecordPaymentDialog
          reunionId={reunionId}
          registrations={payableFor(recordFor.regIds)}
          preset={recordFor.preset}
          onClose={() => setRecordFor(null)}
        />
      )}

      <Dialog open={submissionsRegId !== null} onOpenChange={(open) => { if (!open) setSubmissionsRegId(null); }}>
        <DialogContent className="rounded-3xl p-6 sm:p-8 max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl">Payment Submissions</DialogTitle>
            <DialogDescription>
              Details recorded by the registrant. Reported amounts never change the balance;
              confirm only the money that actually arrived.
            </DialogDescription>
          </DialogHeader>
          <div className="divide-y">
            {(submissionsByRegistration.get(submissionsRegId ?? -1) ?? []).map((s) => (
              <div key={s.id} className="py-4 first:pt-0 last:pb-0 space-y-1.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-bold uppercase tracking-wide text-sm">
                    {s.method === "cashapp" ? "Cash App" : s.method === "zelle" ? "Zelle" : s.method === "check" ? "Check" : "Cash"}
                  </span>
                  <span className="font-bold text-lg tabular-nums">{money(s.amountCents ?? Math.round(s.amount * 100))}</span>
                </div>
                {s.confirmedReceiptId ? (
                  <p className="flex items-center gap-1.5 text-xs font-bold text-green-700 dark:text-green-400">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Confirmed as receipt #{s.confirmedReceiptId}
                  </p>
                ) : null}
                {s.confirmedReceiptId && s.contributions.some((c) => c.standalone && c.paymentStatus === "pending") ? (
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    A standalone fund chip-in in this note was left out of the receipt and is still pending. Mark it paid below only if that money arrived.
                  </p>
                ) : !s.confirmedReceiptId ? (
                  <Button
                    size="sm"
                    className="h-8 rounded-lg"
                    onClick={() => {
                      setRecordFor({
                        regIds: s.registrationIds?.length ? s.registrationIds : s.registrationId != null && !s.branchFee ? [s.registrationId] : [],
                        preset: {
                          branchFee: s.branchFee
                            ? (() => {
                                const live = branchFeesData?.branches.find((b) => b.branchId === s.branchFee!.branchId);
                                return {
                                  branchId: s.branchFee.branchId,
                                  branchName: live?.branchName ?? s.branchFee.branchName ?? "Branch",
                                  label: live?.label ?? s.branchFee.label,
                                  amountCents: s.branchFee.amountCents,
                                  payerName: live?.election?.userName ?? null,
                                };
                              })()
                            : undefined,
                          submissionId: s.id,
                          amountCents: s.amountCents ?? Math.round(s.amount * 100),
                          method: s.method,
                          reference: s.reference,
                          receivedDate: s.givenDate,
                          standaloneChipIns: s.contributions
                            .filter((c) => c.standalone && c.paymentStatus === "pending")
                            .map((c) => ({ id: c.id, label: `Fund chip-in · ${c.contributorName ?? "Anonymous"}`, cents: Math.round(c.amount * 100) })),
                        },
                      });
                    }}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" /> Confirm money received
                  </Button>
                ) : null}
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
                {s.branchFee && (
                  <p className="text-xs font-bold text-primary">
                    Includes {money(s.branchFee.amountCents)} for the {s.branchFee.branchName ?? ""} {s.branchFee.label} (shared, once per branch)
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
                          <span className="font-bold tabular-nums text-sm">{money(Math.round(c.amount * 100))}</span>
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
                      {offeredAddOns(managedFees, "attendee").length > 0 && (
                        <div className="col-span-full">
                          <AddOnPicker fees={managedFees} scope="attendee"
                            picks={(watchAttendees[index]?.addOnPicks ?? {}) as AddOnPicks}
                            onChange={(next) => form.setValue(`attendees.${index}.addOnPicks`, next as Record<string, Record<string, string>>)}
                            testIdPrefix={`managed-attendee-${index}`} showErrors={managedAddOnErrors.length > 0} />
                        </div>
                      )}

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

                      {managedOffers(index).length > 0 && (
                        <div className="md:col-span-2 rounded-xl bg-muted/40 p-3 space-y-1" data-testid={`managed-dinner-choices-${index}`}>
                          {managedOffers(index).map((fee) => {
                            const domId = `managed-include-dinner-${index}-${fee.id}`;
                            return (
                              <label key={fee.id} htmlFor={domId} className="flex items-center gap-3 cursor-pointer">
                                <Checkbox
                                  id={domId}
                                  checked={(watchAttendees[index]?.dinnerFeeIds ?? []).includes(fee.id)}
                                  onCheckedChange={(v) => toggleManagedDinner(index, fee.id, v === true)}
                                />
                                <span className="text-sm">
                                  <span className="font-bold">{fee.label}</span>
                                  {fee.dinnerMode === "mandatory" && <span className="ml-1 text-[10px] font-bold uppercase tracking-wider text-primary">Required (organizer may exempt)</span>}
                                  {fee.dinnerMode === "hidden" && <span className="ml-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Hidden</span>}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                <Button
                  type="button"
                  variant="outline"
                  onClick={() => append({ name: "", dietaryRestrictions: "", age: undefined, includeDinner: newDinnerIds.length > 0 || !hasManagedDinner, dinnerFeeIds: hasManagedDinner ? newDinnerIds : undefined, addOnPicks: seedPicks(managedFees, "attendee") })}
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

              {offeredAddOns(managedFees, "household").length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between border-b pb-2">
                    <h3 className="font-serif text-lg font-bold">Household Add-ons</h3>
                  </div>
                  <AddOnPicker fees={managedFees} scope="household" picks={managedHouseholdPicks} onChange={setManagedHouseholdPicks}
                    testIdPrefix="managed-household" showErrors={managedAddOnErrors.length > 0} />
                </div>
              )}
              {managedAddOnErrors.length > 0 && (
                <ul className="p-3 bg-destructive/10 text-destructive text-sm rounded-xl space-y-1" data-testid="managed-addon-errors">
                  {managedAddOnErrors.map((m) => <li key={m}>{m}</li>)}
                </ul>
              )}
              <div className="flex items-center justify-between rounded-xl bg-muted/50 px-4 py-3" data-testid="managed-preview-total">
                <span className="text-sm text-muted-foreground">Estimated total (server confirms)</span>
                <span className="font-serif text-xl font-bold tabular-nums">{centsLabel(managedPreviewCents)}</span>
              </div>

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
        <DialogContent className="rounded-3xl p-6 sm:p-8 max-w-md max-h-[90dvh] overflow-y-auto">
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
              const dinners = attendeeDinnerStatus(reunion?.fees ?? [], checkInReg.selectedFeeIds ?? [], a);
              const addOns = attendeeAddOns((reunion?.fees ?? []).filter((f) => !isDinnerFee(f)), checkInReg.selectedFeeIds ?? [], a);
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
                      <div className="text-xs text-muted-foreground">
                        {addOns.length ? `Add-ons: ${addOns.join(", ")}` : "No individual add-ons"}
                      </div>
                      {dinners.map(({ fee, included }) => (
                        <div key={fee.id} className="text-xs" data-testid={`checkin-dinner-${a.id}-${fee.id}`}>
                          <span className="text-muted-foreground">{fee.label}: </span>
                          <span className={included ? "font-bold text-green-700 dark:text-green-400" : "font-bold text-muted-foreground"}>{included ? "Included" : "Not included"}</span>
                        </div>
                      ))}
                      {!(a.addOns ?? []).length && a.shirtSize && <div className="text-xs text-muted-foreground/70">Historical size on file: {a.shirtSize}</div>}
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
          {(householdAddOns.length > 0 || (checkInReg?.addOns ?? []).length > 0) && (
            <div className="rounded-xl border p-3 text-sm">
              <h3 className="font-medium">Household add-ons</h3>
              <p className="text-xs text-muted-foreground">Shared with this registration; not assigned to an individual.</p>
              {householdAddOns.map(({ fee, quantity }) => <div key={fee.id}>{fee.label} × {quantity}</div>)}
              <AddOnPurchaseList items={checkInReg?.addOns} testIdPrefix="checkin-household" />
            </div>
          )}
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

          {cancelReg && ((cancelReg.ledger ? cancelReg.ledger.confirmedCents + cancelReg.ledger.legacyCreditCents : 0) > 0 || cancelReg.paymentStatus === 'paid') && (
            <div className="space-y-4 py-4">
              <Label className="text-base">Payment Resolution</Label>
              <p className="text-sm text-muted-foreground -mt-2">
                {cancelReg.ledger
                  ? `${money(cancelReg.ledger.confirmedCents + cancelReg.ledger.legacyCreditCents)} was actually received for this registration.`
                  : "This registration has confirmed money."}{" "}
                How are you handling it? Attached fund chip-in money stays with the fund.
              </p>
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
              <TabsTrigger value="payment" disabled={!transferReg?.ledger || transferReg.ledger.confirmedCents + transferReg.ledger.legacyCreditCents <= 0}>Payment Only</TabsTrigger>
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
                Keep the registration here, but move confirmed money to another registration in this reunion.
                {transferReg?.ledger && ` ${money(transferReg.ledger.confirmedCents + transferReg.ledger.legacyCreditCents)} is available.`}
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
              <div className="space-y-2">
                <Label>Amount to move ($, optional)</Label>
                <Input
                  placeholder="Defaults to what the recipient still owes"
                  inputMode="decimal"
                  value={transferAmount}
                  onChange={(e) => setTransferAmount(e.target.value)}
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
