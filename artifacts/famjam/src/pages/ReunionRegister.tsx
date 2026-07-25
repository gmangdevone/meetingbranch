import { useState, useMemo, useEffect } from "react";
import { useLocation } from "wouter";
import { useGetReunionByCode, getGetReunionByCodeQueryKey, useCreateRegistration, useUpdateRegistration, useGetRegistration, getGetRegistrationQueryKey, getListMyRegistrationsQueryKey, getGetReunionSummaryQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { ArrowLeft, Plus, Trash2, Users, Heart } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "../components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Skeleton } from "../components/ui/skeleton";
import { Checkbox } from "../components/ui/checkbox";
import { useToast } from "../hooks/use-toast";
import { computeTotal, computeFeeAmount, feeApplies, describeFee } from "../lib/fees";

const SHIRT_SIZES = ["XS", "S", "M", "L", "XL", "2XL", "3XL"] as const;

const formSchema = z.object({
  branchName: z.string().min(1, "Please select your family branch"),
  attendees: z.array(z.object({
    name: z.string().min(1, "Name is required"),
    shirtSize: z.enum(SHIRT_SIZES, { required_error: "Shirt size is required" }),
    dietaryRestrictions: z.string().optional(),
    age: z.coerce.number({ invalid_type_error: "Enter an age" }).int().min(0, "Enter a valid age").max(120, "Enter a valid age"),
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

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      branchName: "",
      attendees: [{ name: "", shirtSize: "M", dietaryRestrictions: "", age: undefined as unknown as number }],
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
      })),
    });
    setSelectedFeeIds(existingReg.selectedFeeIds ?? []);
  }, [isEdit, existingReg, form]);

  const watchAttendees = form.watch("attendees");
  const watchSponsorshipContribution = form.watch("sponsorshipContribution");

  // Live totals: parse ages defensively since inputs emit strings before submit.
  const feeAttendees = useMemo(
    () =>
      watchAttendees.map((a) => {
        const n = Number(a?.age);
        return { age: a?.age == null || (a.age as unknown) === "" || Number.isNaN(n) ? null : n };
      }),
    [watchAttendees],
  );

  const fees = reunion?.fees ?? [];
  const optionalFees = useMemo(() => fees.filter((f) => f.isOptional), [fees]);
  const feeLines = useMemo(
    () =>
      fees
        .filter((f) => feeApplies(f, selectedFeeIds))
        .map((f) => ({ id: f.id, label: f.label, amount: computeFeeAmount(f, feeAttendees) }))
        .filter((line) => line.amount > 0),
    [fees, selectedFeeIds, feeAttendees],
  );
  const totalCost = useMemo(
    () => {
      const baseTotal = reunion ? computeTotal(fees, feeAttendees, selectedFeeIds) : 0;
      const contribution = Number(watchSponsorshipContribution) || 0;
      return baseTotal + contribution;
    },
    [reunion, fees, feeAttendees, selectedFeeIds, watchSponsorshipContribution],
  );

  const toggleFee = (feeId: number, checked: boolean) =>
    setSelectedFeeIds((prev) =>
      checked ? [...new Set([...prev, feeId])] : prev.filter((id) => id !== feeId),
    );

  const onSubmit = (values: z.infer<typeof formSchema>) => {
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
          queryClient.invalidateQueries({ queryKey: getListMyRegistrationsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetRegistrationQueryKey(editId) });
          queryClient.invalidateQueries({ queryKey: getGetReunionSummaryQueryKey(reunion.id) });
          toast({ title: "Registration updated", description: "Your changes have been saved." });
          setLocation(`/registrations/${editId}`);
        },
        onError: (err) => {
          toast({ title: "Update failed", description: (err as any)?.error || "An error occurred", variant: "destructive" });
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
        queryClient.invalidateQueries({ queryKey: getListMyRegistrationsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetReunionSummaryQueryKey(reunion.id) });
        toast({ title: "Registration Successful!", description: "We can't wait to see you." });
        setLocation(`/registrations/${data.id}`);
      },
      onError: (err) => {
        toast({ title: "Registration failed", description: (err as any)?.error || "An error occurred", variant: "destructive" });
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
        <Button onClick={() => setLocation(`/r/${reunion.code}`)} variant="outline" className="rounded-full">
          <ArrowLeft className="w-4 h-4 mr-2" /> Back to Hub
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto py-8">
      <Button 
        variant="ghost" 
        onClick={() => setLocation(`/r/${reunion.code}`)} 
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
            {watchAttendees.length} {watchAttendees.length === 1 ? "attendee" : "attendees"}
          </span>
          <span className="flex items-baseline gap-2">
            <span className="text-xs font-bold uppercase tracking-widest text-primary-foreground/70">Total</span>
            <span className="font-serif text-2xl font-bold tabular-nums">${totalCost}</span>
          </span>
        </div>
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
                      <Select onValueChange={field.onChange} value={field.value}>
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
              </div>

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
                    </div>
                  </div>
                ))}

                <Button
                  type="button"
                  variant="outline"
                  onClick={() => append({ name: "", shirtSize: "M", dietaryRestrictions: "", age: undefined as unknown as number })}
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

              <div className="lg:hidden">
                {/* Mobile summary duplicate */}
                <div className="bg-primary text-primary-foreground rounded-3xl p-6 shadow-xl mb-6">
                  <h3 className="font-bold mb-4 pb-4 border-b border-primary-foreground/20">Summary</h3>
                  <div className="flex justify-between items-center mb-2">
                    <span>Attendees</span>
                    <span>{watchAttendees.length}</span>
                  </div>
                  {feeLines.length > 0 && (
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
                        <span>${totalCost}</span>
                      </div>
                    </>
                  )}
                </div>
              </div>

              <Button type="submit" disabled={registerMutation.isPending || updateMutation.isPending} className="w-full rounded-full py-7 text-lg font-bold shadow-lg hover:-translate-y-1 transition-all">
                {isEdit
                  ? (updateMutation.isPending ? "Saving..." : "Save Changes")
                  : (registerMutation.isPending ? "Submitting..." : "Complete Registration")}
              </Button>
            </form>
          </Form>
        </div>

        <div className="hidden lg:block">
          <div className="bg-card border shadow-sm rounded-3xl p-6 sticky top-24">
            <h3 className="font-serif text-xl font-bold mb-6 flex items-center"><Users className="w-5 h-5 mr-2" /> Registration Summary</h3>
            
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Total Attendees</span>
                <span className="font-bold text-xl">{watchAttendees.length}</span>
              </div>
              
              {(feeLines.length > 0 || Number(watchSponsorshipContribution) > 0) && (
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
                      <span className="font-serif text-4xl font-bold text-primary">${totalCost}</span>
                    </div>
                  </div>
                  
                  <div className="bg-muted p-4 rounded-xl mt-6 text-sm">
                    <span className="font-bold block mb-1">How to pay:</span>
                    Pay via <span className="font-mono bg-background px-1 rounded">{reunion.paymentHandle}</span> after submitting.
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
