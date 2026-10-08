import { useState, useMemo, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { invalidateRegistrationTotals } from "../components/payments/money";
import { useGetReunionByCode, getGetReunionByCodeQueryKey, useCreateRegistration, useUpdateRegistration, useGetRegistration, getGetRegistrationQueryKey, useListBranchFeeOptions, getListBranchFeeOptionsQueryKey, useElectBranchFee, getListMyBranchFeeElectionsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { ArrowLeft, Plus, Trash2, Users, Heart } from "lucide-react";
import { BranchFeeQuestion, branchFeeOptionFor, type FeeChoice } from "../components/payments/BranchFeeQuestion";
import { errorMessage } from "../components/payments/LedgerPanel";
import { money } from "../components/payments/money";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "../components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Skeleton } from "../components/ui/skeleton";
import { Checkbox } from "../components/ui/checkbox";
import { useToast } from "../hooks/use-toast";
import { eventCodePath } from "../lib/eventCode";
import { computeTotal, computeFeeAmount, feeApplies, describeFee, isDinnerFee } from "../lib/fees";
import { registrationPricingReady } from "../lib/registrationReadiness";
import { SpecialInstructionsNote, approvedInstructions } from "../components/payments/SpecialInstructionsNote";

const SHIRT_SIZES = ["XS", "S", "M", "L", "XL", "2XL", "3XL"] as const;

const formSchema = z.object({
  branchName: z.string().min(1, "Please select your family branch"),
  attendees: z.array(z.object({
    name: z.string().trim().min(1, "Name is required"),
    shirtSize: z.enum(SHIRT_SIZES, { required_error: "Shirt size is required" }),
    dietaryRestrictions: z.string().optional(),
    age: z.preprocess((value) => value == null || String(value).trim() === "" ? undefined : value,
      z.coerce.number({ invalid_type_error: "Enter an age" }).int().min(0, "Enter a valid age").max(120, "Enter a valid age")),
    includeDinner: z.boolean(),
  })).min(1, "Add at least one attendee"),
  sponsorshipContribution: z.coerce.number().int().min(0).optional(),
});

export function ReunionRegister({ params }: { params: { code: string; editId?: string } }) {
  const code = params.code?.toUpperCase();
  const editId = params.editId ? parseInt(params.editId, 10) : null;
  const isEdit = editId != null && !isNaN(editId);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: reunion, isLoading } = useGetReunionByCode(code, {
    query: {  enabled: !!code, retry: false , queryKey: getGetReunionByCodeQueryKey(code) }
  });

  const { data: existingReg, isLoading: isLoadingExisting } = useGetRegistration(editId ?? 0, {
    query: { enabled: isEdit, retry: false, queryKey: getGetRegistrationQueryKey(editId ?? 0) }
  });

  const registerMutation = useCreateRegistration();
  const updateMutation = useUpdateRegistration();

  const [selectedFeeIds, setSelectedFeeIds] = useState<number[]>([]);
  // Branch special fee: asked right after the branch, before attendees.
  const [feeChoice, setFeeChoice] = useState<FeeChoice>(null);
  const [feeOnly, setFeeOnly] = useState(false);
  // Visible inline error (toasts alone can go unseen). `hubLink` when a fee choice was saved.
  const [flowError, setFlowError] = useState<{ title: string; detail: string; hubLink?: boolean } | null>(null);
  const electedThisSession = useRef<string | null>(null);
  const electFee = useElectBranchFee();
  const reunionIdForFees = reunion?.id ?? 0;
  const { data: feeOptionsData, refetch: refetchFeeOptions } = useListBranchFeeOptions(reunionIdForFees, {
    query: { enabled: !!reunion, queryKey: getListBranchFeeOptionsQueryKey(reunionIdForFees) },
  });

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      branchName: "",
      attendees: [{ name: "", shirtSize: "M", dietaryRestrictions: "", age: undefined as unknown as number, includeDinner: true }],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "attendees",
  });

  // Prefill the form when editing an existing registration
  useEffect(() => {
    if (!isEdit || !existingReg) return;
    form.reset({
      branchName: existingReg.branchName,
      attendees: existingReg.attendees.map((a) => ({
        name: a.name,
        shirtSize: a.shirtSize,
        dietaryRestrictions: a.dietaryRestrictions ?? "",
        age: (a.age ?? undefined) as unknown as number,
        includeDinner: a.includeDinner ?? true,
      })),
    });
    setSelectedFeeIds(existingReg.selectedFeeIds ?? []);
  }, [isEdit, existingReg, form]);

  const watchBranch = form.watch("branchName");
  const feeOption = branchFeeOptionFor(reunion?.branches ?? [], feeOptionsData?.options ?? [], watchBranch);
  const asksFee = feeOption?.state === "available";
  const electingFee = asksFee && feeChoice === "yes";
  const feeOnlyMode = electingFee && feeOnly && !isEdit;
  // Attendee details appear once the branch is chosen and any fee question is answered.
  // Editing: the saved branch is already chosen, so the optional fee question never gates the form.
  const showAttendees = !!watchBranch && (isEdit || !asksFee || feeChoice !== null) && !feeOnlyMode;
  const feeCents = electingFee ? feeOption!.amountCents : 0;
  const changeBranch = (name: string) => {
    // A different branch discards the stale fee answer and re-checks live status.
    setFeeChoice(null);
    setFeeOnly(false);
    setFlowError(null);
    void refetchFeeOptions();
    return name;
  };
  const watchAttendees = form.watch("attendees");
  const watchSponsorshipContribution = form.watch("sponsorshipContribution");
  const pricingReady = registrationPricingReady(watchAttendees, watchSponsorshipContribution);
  const pendingPriceMessage = "Enter each attendee's name and valid age to calculate your total.";

  // Live totals: parse ages defensively since inputs emit strings before submit.
  // React Hook Form can mutate the watched array in place. Derive ages on
  // every render rather than memoizing on that array's identity.
  const feeAttendees = watchAttendees.map((a) => {
    const n = Number(a?.age);
    return { age: a?.age == null || (a.age as unknown) === "" || Number.isNaN(n) ? null : n, includeDinner: a?.includeDinner !== false };
  });

  const fees = reunion?.fees ?? [];
  const optionalFees = useMemo(() => fees.filter((f) => f.isOptional), [fees]);
  // Dinner fees this household is charged (an optional dinner must be opted into first).
  const dinnerFees = fees.filter((f) => isDinnerFee(f) && feeApplies(f, selectedFeeIds));
  const dinnerCostFor = (age: number | null) =>
    dinnerFees.reduce((sum, f) => sum + computeFeeAmount(f, [{ age, includeDinner: true }]), 0);
  const feeLines = useMemo(
    () =>
      (pricingReady ? fees : [])
        .filter((f) => feeApplies(f, selectedFeeIds))
        .map((f) => ({ id: f.id, label: f.label, amount: computeFeeAmount(f, feeAttendees) }))
        .filter((line) => line.amount > 0),
    [fees, selectedFeeIds, feeAttendees, pricingReady],
  );
  const totalCost = useMemo(
    () => {
      if (!pricingReady) return null;
      const baseTotal = reunion ? computeTotal(fees, feeAttendees, selectedFeeIds) : 0;
      const contribution = Number(watchSponsorshipContribution) || 0;
      return baseTotal + contribution;
    },
    [reunion, fees, feeAttendees, selectedFeeIds, watchSponsorshipContribution, pricingReady],
  );

  const toggleFee = (feeId: number, checked: boolean) =>
    setSelectedFeeIds((prev) =>
      checked ? [...new Set([...prev, feeId])] : prev.filter((id) => id !== feeId),
    );

  const invalidateFees = () => {
    if (!reunion) return;
    queryClient.invalidateQueries({ queryKey: getListBranchFeeOptionsQueryKey(reunion.id) });
    queryClient.invalidateQueries({ queryKey: getListMyBranchFeeElectionsQueryKey(reunion.id) });
  };

  /** Elect the full fee first; a race (already paid / claimed / amount changed) stops the flow. */
  const electThen = (next: () => void) => {
    setFlowError(null);
    if (!reunion || !electingFee || !feeOption) return next();
    const label = feeOption.label;
    electFee.mutate(
      { reunionId: reunion.id, data: { branchId: feeOption.branchId, expectedAmountCents: feeOption.amountCents } },
      {
        onSuccess: () => {
          electedThisSession.current = label;
          invalidateFees();
          next();
        },
        onError: (err) => {
          setFeeChoice(null);
          setFeeOnly(false);
          void refetchFeeOptions();
          const detail = `${errorMessage(err)} Nothing was saved. Review the branch fee status above and choose again.`;
          setFlowError({ title: `The ${label} wasn't added`, detail });
          toast({ title: "Branch fee not added", description: detail, variant: "destructive" });
        },
      },
    );
  };

  const submitFeeOnly = () => {
    if (!reunion || !feeOnlyMode) return;
    if (!form.getValues("branchName")) {
      form.setError("branchName", { message: "Please select your family branch" });
      return;
    }
    electThen(() => {
      toast({ title: `${feeOption!.label} added`, description: "Report your payment from the reunion hub. No attendees were registered." });
      setLocation(`${eventCodePath(reunion.code)}?branchFee=1`);
    });
  };

  const onSubmit = (values: z.infer<typeof formSchema>) => {
    if (!reunion) return;
    if (asksFee && feeChoice === null && !isEdit) {
      setFlowError({ title: "One quick question", detail: `Let us know above if you'll pay the ${feeOption!.label}.` });
      return;
    }
    electThen(() => submitRegistration(values));
  };

  // The fee choice and the registration are saved separately (not atomic):
  // if the fee was chosen but the registration failed, say so plainly.
  const registrationFailure = (title: string, detail: string) =>
    electedThisSession.current
      ? {
          title,
          detail: `${detail} Your choice to pay the ${electedThisSession.current} WAS saved and is waiting in the reunion hub. Fix the problem and submit again; it won't be charged twice.`,
          hubLink: true,
        }
      : { title, detail: `${detail} Nothing was saved. Fix the problem and submit again.` };

  const submitRegistration = (values: z.infer<typeof formSchema>) => {
    if (!reunion) return;

    if (isEdit && editId != null) {
      updateMutation.mutate({
        id: editId,
        data: {
          branchName: values.branchName,
          selectedFeeIds,
          attendees: values.attendees.map(a => ({
            ...a,
            dietaryRestrictions: a.dietaryRestrictions || undefined
          }))
        }
      }, {
        onSuccess: () => {
          // Totals live in several caches (ledger, lists, reports, summary): refresh all of them.
          invalidateRegistrationTotals(queryClient, reunion.id, editId);
          toast({ title: "Registration updated", description: "Your changes have been saved." });
          setLocation(`/registrations/${editId}`);
        },
        onError: (err) => {
          const detail = errorMessage(err);
          setFlowError(registrationFailure("Changes not saved", detail));
          toast({ title: "Update failed", description: detail, variant: "destructive" });
        }
      });
      return;
    }

    registerMutation.mutate({
      data: {
        reunionId: reunion.id,
        branchName: values.branchName,
        selectedFeeIds,
        sponsorshipContribution: values.sponsorshipContribution && values.sponsorshipContribution > 0 ? values.sponsorshipContribution : undefined,
        attendees: values.attendees.map(a => ({
          ...a,
          dietaryRestrictions: a.dietaryRestrictions || undefined
        }))
      }
    }, {
      onSuccess: (data) => {
        invalidateRegistrationTotals(queryClient, reunion.id, data.id);
        toast({ title: "Registration Successful!", description: "We can't wait to see you." });
        setLocation(`/registrations/${data.id}`);
      },
      onError: (err) => {
        const detail = errorMessage(err);
        setFlowError(registrationFailure("Registration not saved", detail));
        toast({ title: "Registration failed", description: detail, variant: "destructive" });
      }
    });
  };

  if (isLoading || (isEdit && isLoadingExisting)) {
    return (
      <div className="max-w-3xl mx-auto py-12">
        <Skeleton className="h-12 w-48 mb-8" />
        <Skeleton className="h-[600px] rounded-3xl" />
      </div>
    );
  }

  if (!reunion) {
    return (
      <div className="max-w-xl mx-auto py-20 text-center">
        <h1 className="font-serif text-4xl font-bold mb-4">Reunion Not Found</h1>
        <Button onClick={() => setLocation("/dashboard")} variant="outline" className="rounded-full">Back to Dashboard</Button>
      </div>
    );
  }

  if (isEdit && !existingReg) {
    return (
      <div className="max-w-xl mx-auto py-20 text-center">
        <h1 className="font-serif text-4xl font-bold mb-4">Registration Not Found</h1>
        <Button onClick={() => setLocation("/dashboard")} variant="outline" className="rounded-full">Back to Dashboard</Button>
      </div>
    );
  }

  if (!isEdit && !reunion.registrationsOpen) {
    return (
      <div className="max-w-xl mx-auto py-20 text-center">
        <div className="bg-primary/10 text-primary w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6">
          <Heart className="w-8 h-8" />
        </div>
        <h1 className="font-serif text-4xl font-bold mb-4">Registration is Closed</h1>
        <p className="text-lg text-muted-foreground mb-8">
          The organizer has closed registration for {reunion.name}. If you think this is a mistake or you still need to register, please reach out to them directly.
        </p>
        <Button onClick={() => setLocation(eventCodePath(reunion.code))} variant="outline" className="rounded-full">
          <ArrowLeft className="w-4 h-4 mr-2" /> Back to Hub
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto py-8">
      <Button 
        variant="ghost" 
        onClick={() => setLocation(eventCodePath(reunion.code))}
        className="mb-6 -ml-4 text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="w-4 h-4 mr-2" /> Back to Hub
      </Button>

      <div className="mb-8">
        <div className="inline-block bg-primary/10 text-primary px-3 py-1 rounded-full text-xs font-bold uppercase tracking-widest mb-3">
          {reunion.name}
        </div>
        <h1 className="font-serif text-4xl md:text-5xl font-bold mb-3">{isEdit ? "Edit Registration" : "Register Your Household"}</h1>
        <p className="text-lg text-muted-foreground">{isEdit ? "Update the attendees, branch, or add-ons for this registration." : "Add everyone in your immediate household who is attending."}</p>
      </div>

      <div className="lg:hidden sticky top-2 z-30 mb-6">
        <div className="bg-primary text-primary-foreground rounded-2xl shadow-xl px-5 py-3 flex items-center justify-between gap-4">
          <span className="flex items-center gap-2 text-sm font-medium">
            <Users className="w-4 h-4" />
            {feeOnlyMode ? "Fee only · 0 attendees" : `${watchAttendees.length} ${watchAttendees.length === 1 ? "attendee" : "attendees"}`}
          </span>
          <span className="flex items-baseline gap-2">
            <span className="text-xs font-bold uppercase tracking-widest text-primary-foreground/70">Total</span>
            <span className="font-serif text-2xl font-bold tabular-nums">{feeOnlyMode ? money(feeCents) : pricingReady ? (electingFee ? money(Math.round((totalCost ?? 0) * 100) + feeCents) : `$${totalCost}`) : "—"}</span>
          </span>
        </div>
        {!feeOnlyMode && !pricingReady && <p className="text-sm text-muted-foreground mt-2">{pendingPriceMessage}</p>}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
              <div className="bg-card border shadow-sm p-6 md:p-8 rounded-3xl">
                <FormField
                  control={form.control}
                  name="branchName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-base font-bold">Which family branch are you in?</FormLabel>
                      <Select onValueChange={(v) => { if (v && v !== field.value) field.onChange(changeBranch(v)); }} value={field.value}>
                        <FormControl>
                          <SelectTrigger className="rounded-xl h-14 bg-muted/50 border-transparent focus:border-primary">
                            <SelectValue placeholder="Select a branch..." />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {reunion.branches.sort((a, b) => a.sortOrder - b.sortOrder).map(branch => (
                            <SelectItem key={branch.id} value={branch.name}>{branch.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {watchBranch && feeOption && (
                  <BranchFeeQuestion
                    option={feeOption}
                    choice={feeChoice}
                    onChoice={(c) => { setFeeChoice(c); if (c !== "yes") setFeeOnly(false); }}
                    feeOnly={feeOnly}
                    onFeeOnly={setFeeOnly}
                    allowFeeOnly={!isEdit}
                  />
                )}
              </div>

              {showAttendees && (<>
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h2 className="font-serif text-2xl font-bold">Attendees</h2>
                </div>

                {fields.map((field, index) => (
                  <div key={field.id} className="bg-card border shadow-sm p-6 rounded-3xl relative animate-in slide-in-from-bottom-4">
                    {fields.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute top-4 right-4 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-full"
                        onClick={() => remove(index)}
                      >
                        <Trash2 className="w-5 h-5" />
                      </Button>
                    )}
                    
                    <h3 className="font-bold text-sm uppercase tracking-widest text-muted-foreground mb-4">Person {index + 1}</h3>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name={`attendees.${index}.name`}
                        render={({ field: inputField }) => (
                          <FormItem className="md:col-span-2">
                            <FormLabel>Full Name</FormLabel>
                            <FormControl>
                              <Input placeholder="Jane Doe" className="rounded-xl bg-muted/50 border-transparent focus:border-primary" {...inputField} />
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
                            <Select onValueChange={inputField.onChange} value={inputField.value}>
                              <FormControl>
                                <SelectTrigger className="rounded-xl bg-muted/50 border-transparent focus:border-primary">
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
                            <FormLabel>Age</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                min={0}
                                max={120}
                                placeholder="e.g. 34"
                                className="rounded-xl bg-muted/50 border-transparent focus:border-primary"
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
                              <Input placeholder="e.g. Vegetarian, Peanut allergy" className="rounded-xl bg-muted/50 border-transparent focus:border-primary" {...inputField} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      {dinnerFees.length > 0 && (
                        <FormField
                          control={form.control}
                          name={`attendees.${index}.includeDinner`}
                          render={({ field: inputField }) => {
                            const cost = dinnerCostFor(feeAttendees[index]?.age ?? null);
                            return (
                              <FormItem className="md:col-span-2">
                                <label
                                  htmlFor={`include-dinner-${index}`}
                                  className="flex items-center gap-3 p-3 rounded-2xl bg-muted/40 border border-transparent hover:border-primary/40 cursor-pointer transition-colors"
                                >
                                  <Checkbox
                                    id={`include-dinner-${index}`}
                                    checked={inputField.value !== false}
                                    onCheckedChange={(v) => inputField.onChange(v === true)}
                                    data-testid={`include-dinner-${index}`}
                                  />
                                  <span className="flex-1 text-sm">
                                    <span className="font-bold">Include dinner</span>
                                    <span className="text-muted-foreground"> · {dinnerFees.map((f) => f.label).join(", ")}</span>
                                  </span>
                                  <span className={`text-sm font-bold tabular-nums ${inputField.value === false ? "line-through text-muted-foreground" : ""}`}>
                                    {cost === 0 ? "Free" : `$${cost}`}
                                  </span>
                                </label>
                              </FormItem>
                            );
                          }}
                        />
                      )}
                    </div>
                  </div>
                ))}

                <Button
                  type="button"
                  variant="outline"
                  onClick={() => append({ name: "", shirtSize: "M", dietaryRestrictions: "", age: undefined as unknown as number, includeDinner: true })}
                  className="w-full py-8 border-dashed border-2 rounded-3xl text-muted-foreground hover:text-foreground bg-transparent hover:bg-muted/30"
                >
                  <Plus className="mr-2 w-5 h-5" /> Add Another Person
                </Button>
              </div>

              {optionalFees.length > 0 && (
                <div className="bg-card border shadow-sm p-6 md:p-8 rounded-3xl space-y-4">
                  <div>
                    <h2 className="font-serif text-2xl font-bold">Optional Add-ons</h2>
                    <p className="text-muted-foreground text-sm">Choose any extras for your household.</p>
                  </div>
                  <div className="space-y-3">
                    {optionalFees.map((fee) => (
                      <label
                        key={fee.id}
                        htmlFor={`fee-${fee.id}`}
                        className="flex items-start gap-3 p-4 rounded-2xl bg-muted/40 border border-transparent hover:border-primary/40 cursor-pointer transition-colors"
                      >
                        <Checkbox
                          id={`fee-${fee.id}`}
                          checked={selectedFeeIds.includes(fee.id)}
                          onCheckedChange={(v) => toggleFee(fee.id, v === true)}
                          className="mt-0.5"
                        />
                        <span className="flex-1">
                          <span className="font-bold block">{fee.label}</span>
                          <span className="text-sm text-muted-foreground">{describeFee(fee)}</span>
                        </span>
                        <span className="font-bold">${computeFeeAmount(fee, feeAttendees)}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {!isEdit && (
              <div className="bg-card border shadow-sm p-6 md:p-8 rounded-3xl space-y-4">
                <div className="flex items-center gap-3">
                  <div className="bg-rose-100 text-rose-500 w-10 h-10 rounded-full flex items-center justify-center">
                    <Heart className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="font-serif text-2xl font-bold">Sponsorship Fund</h2>
                    <p className="text-muted-foreground text-sm">Help cover costs for family members who need a little assistance. (Anonymous)</p>
                  </div>
                </div>
                <FormField
                  control={form.control}
                  name="sponsorshipContribution"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Chip in amount ($)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={0}
                          placeholder="e.g. 50"
                          className="rounded-xl bg-muted/50 border-transparent focus:border-primary w-full md:w-1/2"
                          {...field}
                          value={field.value ?? ""}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              )}
              </>)}

              <div className="lg:hidden">
                {/* Mobile summary duplicate */}
                <div className="bg-primary text-primary-foreground rounded-3xl p-6 shadow-xl mb-6">
                  <h3 className="font-bold mb-4 pb-4 border-b border-primary-foreground/20">Summary</h3>
                  <div className="flex justify-between items-center mb-2">
                    <span>Attendees</span>
                    <span>{feeOnlyMode ? 0 : watchAttendees.length}</span>
                  </div>
                  {electingFee && (
                    <div className="flex justify-between items-center text-sm mb-2" data-testid="summary-branch-fee-mobile">
                      <span className="opacity-90">{feeOption!.label} · {feeOption!.branchName} (once per branch)</span>
                      <span>{money(feeCents)}</span>
                    </div>
                  )}
                  {feeOnlyMode && (
                    <div className="flex justify-between items-center font-bold text-2xl mt-4">
                      <span>Total</span>
                      <span>{money(feeCents)}</span>
                    </div>
                  )}
                  {!feeOnlyMode && !pricingReady && <p className="text-sm mt-4">{pendingPriceMessage}</p>}
                  {!feeOnlyMode && pricingReady && (
                    <>
                      <div className="mb-4 pb-4 border-b border-primary-foreground/20 space-y-1">
                        {feeLines.map((line) => (
                          <div key={line.id} className="flex justify-between items-center text-sm">
                            <span className="opacity-90">{line.label}</span>
                            <span>${line.amount}</span>
                          </div>
                        ))}
                        {Number(watchSponsorshipContribution) > 0 && (
                          <div className="flex justify-between items-center text-sm text-rose-200">
                            <span className="opacity-90">Sponsorship Contribution</span>
                            <span>${watchSponsorshipContribution}</span>
                          </div>
                        )}
                      </div>
                      <div className="flex justify-between items-center font-bold text-2xl">
                        <span>Total</span>
                        <span>{electingFee ? money(Math.round((totalCost ?? 0) * 100) + feeCents) : `$${totalCost}`}</span>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {flowError && (
                <div role="alert" className="rounded-2xl border border-destructive/40 bg-destructive/5 p-4 text-sm" data-testid="register-flow-error">
                  <p className="font-bold text-destructive">{flowError.title}</p>
                  <p className="mt-1">{flowError.detail}</p>
                  {flowError.hubLink && (
                    <button type="button" className="mt-2 font-bold text-primary hover:underline" onClick={() => setLocation(eventCodePath(reunion.code))}>
                      Go to the hub
                    </button>
                  )}
                </div>
              )}
              {feeOnlyMode ? (
                <Button type="button" onClick={submitFeeOnly} disabled={electFee.isPending} className="w-full rounded-full py-7 text-lg font-bold shadow-lg hover:-translate-y-1 transition-all">
                  {electFee.isPending ? "Saving..." : `Pay the ${feeOption!.label} only (${money(feeCents)})`}
                </Button>
              ) : (
              <Button type="submit" disabled={!showAttendees || registerMutation.isPending || updateMutation.isPending || electFee.isPending} className="w-full rounded-full py-7 text-lg font-bold shadow-lg hover:-translate-y-1 transition-all">
                {isEdit
                  ? (updateMutation.isPending ? "Saving..." : "Save Changes")
                  : (registerMutation.isPending || electFee.isPending ? "Submitting..." : "Complete Registration")}
              </Button>
              )}
            </form>
          </Form>
        </div>

        <div className="hidden lg:block">
          <div className="bg-card border shadow-sm rounded-3xl p-6 sticky top-24">
            <h3 className="font-serif text-xl font-bold mb-6 flex items-center"><Users className="w-5 h-5 mr-2" /> Registration Summary</h3>
            
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Total Attendees</span>
                <span className="font-bold text-xl">{feeOnlyMode ? 0 : watchAttendees.length}</span>
              </div>
              {electingFee && (
                <div className="flex justify-between items-center rounded-xl bg-primary/5 border border-primary/20 px-3 py-2" data-testid="summary-branch-fee">
                  <span className="text-sm">
                    <span className="font-bold block">{feeOption!.label}</span>
                    <span className="text-muted-foreground text-xs">{feeOption!.branchName} branch · once per branch, paid in full by you</span>
                  </span>
                  <span className="font-bold tabular-nums">{money(feeCents)}</span>
                </div>
              )}
              {feeOnlyMode && (
                <div className="pt-4 border-t border-dashed mt-4">
                  <p className="text-sm text-muted-foreground mb-2">Fee only: no attendees, no registration or dinner cost.</p>
                  <div className="flex justify-between items-end">
                    <span className="text-muted-foreground font-medium">Total Cost</span>
                    <span className="font-serif text-4xl font-bold text-primary">{money(feeCents)}</span>
                  </div>
                </div>
              )}
              {!feeOnlyMode && !pricingReady && <p className="text-sm text-muted-foreground">{pendingPriceMessage}</p>}
              {!feeOnlyMode && pricingReady && (
                <>
                  <div className="space-y-2 pt-2">
                    {feeLines.map((line) => (
                      <div key={line.id} className="flex justify-between items-center">
                        <span className="text-muted-foreground">{line.label}</span>
                        <span className="font-medium">${line.amount}</span>
                      </div>
                    ))}
                    {Number(watchSponsorshipContribution) > 0 && (
                      <div className="flex justify-between items-center text-rose-500">
                        <span className="text-muted-foreground">Sponsorship Contribution</span>
                        <span className="font-medium">${watchSponsorshipContribution}</span>
                      </div>
                    )}
                  </div>
                  
                  <div className="pt-4 border-t border-dashed mt-4">
                    <div className="flex justify-between items-end">
                      <span className="text-muted-foreground font-medium">Total Cost</span>
                      <span className="font-serif text-4xl font-bold text-primary">{electingFee ? money(Math.round((totalCost ?? 0) * 100) + feeCents) : `$${totalCost}`}</span>
                    </div>
                  </div>
                  
                  <div className="bg-muted p-4 rounded-xl mt-6 text-sm">
                    <span className="font-bold block mb-1">How to pay:</span>
                    {reunion.paymentRecipient?.status === "approved" && (reunion.paymentRecipient.paymentHandle || reunion.paymentRecipient.zelleContact || reunion.paymentRecipient.paymentInstructions) ? (
                      <>
                        {reunion.paymentRecipient.paymentHandle && (
                          <>Pay via <span className="font-mono bg-background px-1 rounded">{reunion.paymentRecipient.paymentHandle}</span> after submitting.</>
                        )}
                        {reunion.paymentRecipient.zelleRecipientName && reunion.paymentRecipient.zelleContact && (
                          <span className="block mt-1">
                            {reunion.paymentRecipient.paymentHandle ? "Or send" : "Send"} with Zelle from your own bank's app to{" "}
                            <span className="font-bold">{reunion.paymentRecipient.zelleRecipientName}</span> at{" "}
                            <span className="font-mono bg-background px-1 rounded">{reunion.paymentRecipient.zelleContact}</span>.
                          </span>
                        )}
                        {approvedInstructions(reunion.paymentRecipient) && (
                          <div className="mt-3">
                            <SpecialInstructionsNote text={approvedInstructions(reunion.paymentRecipient)!} compact />
                          </div>
                        )}
                      </>
                    ) : (
                      <>Online payment is not configured yet. Your organizers will share payment instructions.</>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
