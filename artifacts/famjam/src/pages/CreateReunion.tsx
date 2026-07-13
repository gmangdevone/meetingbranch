import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useGetSettings, useCreateReunion, getListMyReunionsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Plus, Trash2, Copy, Check, ArrowRight } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "../components/ui/form";
import { Skeleton } from "../components/ui/skeleton";
import { useToast } from "../hooks/use-toast";

const formSchema = z.object({
  name: z.string().min(1, "Reunion name is required"),
  startDate: z.string().min(1, "Start date is required"),
  endDate: z.string().min(1, "End date is required"),
  feePerPerson: z.coerce.number().min(0, "Fee cannot be negative"),
  paymentHandle: z.string().min(1, "Payment handle is required"),
  paymentUrl: z.string().optional(),
  branches: z.array(z.object({ value: z.string().min(1, "Branch name is required") })).min(1, "At least one branch is required"),
});

export function CreateReunion() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [successData, setSuccessData] = useState<{ id: number, code: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const { data: settings, isLoading: loadingSettings } = useGetSettings();
  const createMutation = useCreateReunion();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      startDate: "",
      endDate: "",
      feePerPerson: 0,
      paymentHandle: "",
      paymentUrl: "",
      branches: [{ value: "Main Branch" }],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "branches",
  });

  const onSubmit = (values: z.infer<typeof formSchema>) => {
    createMutation.mutate({
      data: {
        name: values.name,
        startDate: values.startDate,
        endDate: values.endDate,
        feePerPerson: values.feePerPerson,
        paymentHandle: values.paymentHandle,
        paymentUrl: values.paymentUrl || undefined,
        branches: values.branches.map(b => b.value),
      }
    }, {
      onSuccess: (data) => {
        queryClient.invalidateQueries({ queryKey: getListMyReunionsQueryKey() });
        setSuccessData({ id: data.id, code: data.code });
        toast({ title: "Reunion created!", description: "Share the code with your family." });
      },
      onError: (err) => {
        toast({ title: "Failed to create", description: (err as any)?.error || "An error occurred", variant: "destructive" });
      }
    });
  };

  const handleCopyCode = () => {
    if (!successData) return;
    navigator.clipboard.writeText(successData.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({ title: "Code copied!", description: "You can paste this anywhere." });
  };

  if (loadingSettings) {
    return (
      <div className="max-w-2xl mx-auto py-12">
        <Skeleton className="h-12 w-3/4 mb-8" />
        <Skeleton className="h-[400px] rounded-3xl" />
      </div>
    );
  }

  if (settings && !settings.reunionCreationEnabled) {
    return (
      <div className="max-w-xl mx-auto py-20 text-center flex flex-col items-center">
        <div className="bg-muted w-24 h-24 rounded-full flex items-center justify-center mb-6">
          <CalendarDays className="w-12 h-12 text-muted-foreground" />
        </div>
        <h1 className="font-serif text-4xl font-bold mb-4">Creation Disabled</h1>
        <p className="text-lg text-muted-foreground mb-8">
          The platform administrator has currently disabled the creation of new reunions. Please check back later or contact support.
        </p>
        <Button onClick={() => setLocation("/dashboard")} variant="outline" size="lg" className="rounded-full">
          Return to Dashboard
        </Button>
      </div>
    );
  }

  if (successData) {
    const shareUrl = `${window.location.origin}/r/${successData.code}`;
    
    return (
      <div className="max-w-xl mx-auto py-16 flex flex-col items-center text-center animate-in zoom-in-95 duration-500">
        <div className="bg-primary/20 text-primary w-24 h-24 rounded-full flex items-center justify-center mb-8 shadow-lg shadow-primary/20">
          <Check className="w-12 h-12" />
        </div>
        <h1 className="font-serif text-4xl font-bold mb-2">It's Official!</h1>
        <p className="text-lg text-muted-foreground mb-12">Your reunion is created and ready for RSVPs.</p>
        
        <div className="bg-card border shadow-md rounded-3xl p-8 w-full mb-8 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-2 bg-primary"></div>
          <p className="text-sm font-bold text-muted-foreground uppercase tracking-widest mb-4">Share this code</p>
          <div className="font-mono text-6xl font-bold tracking-widest text-primary mb-8 select-all">
            {successData.code}
          </div>
          
          <div className="flex flex-col gap-3">
            <Button onClick={handleCopyCode} variant="outline" className="w-full rounded-xl py-6 text-lg border-2" data-testid="button-copy-code">
              {copied ? <Check className="mr-2" /> : <Copy className="mr-2" />}
              {copied ? "Copied!" : "Copy Code"}
            </Button>
            
            <Button onClick={() => {
              navigator.clipboard.writeText(shareUrl);
              toast({ title: "Link copied!" });
            }} variant="ghost" className="w-full rounded-xl py-6">
              Copy direct link instead
            </Button>
          </div>
        </div>
        
        <Button onClick={() => setLocation(`/organize/${successData.id}`)} className="w-full rounded-full py-6 text-lg font-bold shadow-md hover:-translate-y-1 transition-all">
          Go to Organizer Dashboard <ArrowRight className="ml-2 w-5 h-5" />
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto py-8">
      <div className="mb-8">
        <h1 className="font-serif text-4xl font-bold mb-2">Create a Reunion</h1>
        <p className="text-muted-foreground text-lg">Set up the details for your family gathering. You can edit these later.</p>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8 bg-card border shadow-sm p-8 rounded-3xl">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-base font-bold">Reunion Name</FormLabel>
                <FormControl>
                  <Input placeholder="e.g. Lacey Family Reunion 2027" className="rounded-xl px-4 py-6 text-lg bg-muted/50 border-transparent focus:border-primary" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <FormField
              control={form.control}
              name="startDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-base font-bold">Start Date</FormLabel>
                  <FormControl>
                    <Input type="date" className="rounded-xl px-4 py-6 text-base bg-muted/50 border-transparent focus:border-primary" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="endDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-base font-bold">End Date</FormLabel>
                  <FormControl>
                    <Input type="date" className="rounded-xl px-4 py-6 text-base bg-muted/50 border-transparent focus:border-primary" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className="pt-6 border-t">
            <h3 className="font-serif text-xl font-bold mb-4">Registration & Payment</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              <FormField
                control={form.control}
                name="feePerPerson"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base font-bold">Registration Fee Per Person ($)</FormLabel>
                    <FormControl>
                      <Input type="number" min="0" step="1" className="rounded-xl px-4 py-6 text-base bg-muted/50 border-transparent focus:border-primary" {...field} />
                    </FormControl>
                    <FormDescription>Set to 0 if it's free. You can add more fees & dues (T-shirts, age-based pricing, and more) from settings later.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="paymentHandle"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base font-bold">Payment Handle</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. $cashapp or @venmo" className="rounded-xl px-4 py-6 text-base bg-muted/50 border-transparent focus:border-primary" {...field} />
                    </FormControl>
                    <FormDescription>Where should they send money?</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="paymentUrl"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-base font-bold">Payment Link (Optional)</FormLabel>
                  <FormControl>
                    <Input placeholder="https://paypal.me/..." className="rounded-xl px-4 py-6 text-base bg-muted/50 border-transparent focus:border-primary" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className="pt-6 border-t">
            <h3 className="font-serif text-xl font-bold mb-2">Family Branches / Groups</h3>
            <p className="text-sm text-muted-foreground mb-4">
              When family members register, they will select which branch they belong to. Add at least one.
            </p>
            
            <div className="space-y-3 mb-4">
              {fields.map((field, index) => (
                <div key={field.id} className="flex gap-2">
                  <FormField
                    control={form.control}
                    name={`branches.${index}.value`}
                    render={({ field: inputField }) => (
                      <FormItem className="flex-1">
                        <FormControl>
                          <Input placeholder="e.g. The Smith Family" className="rounded-xl px-4 py-6 text-base bg-muted/50 border-transparent focus:border-primary" {...inputField} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  {fields.length > 1 && (
                    <Button 
                      type="button" 
                      variant="ghost" 
                      size="icon" 
                      className="h-auto w-14 text-destructive hover:bg-destructive/10 rounded-xl"
                      onClick={() => remove(index)}
                    >
                      <Trash2 className="w-5 h-5" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
            
            <Button 
              type="button" 
              variant="outline" 
              className="rounded-xl border-dashed border-2 py-6 w-full text-muted-foreground hover:text-foreground"
              onClick={() => append({ value: "" })}
            >
              <Plus className="mr-2 w-4 h-4" /> Add Another Branch
            </Button>
          </div>

          <Button type="submit" disabled={createMutation.isPending} className="w-full rounded-full py-6 text-lg font-bold shadow-md hover:-translate-y-1 transition-all mt-8">
            {createMutation.isPending ? "Creating..." : "Create Reunion"}
          </Button>
        </form>
      </Form>
    </div>
  );
}
