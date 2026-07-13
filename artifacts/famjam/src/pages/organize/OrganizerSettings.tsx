import { useEffect } from "react";
import { useGetReunion, useUpdateReunion, getGetReunionQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { OrganizerLayout } from "./OrganizerLayout";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "../../components/ui/form";
import { useToast } from "../../hooks/use-toast";

const formSchema = z.object({
  name: z.string().min(1, "Required"),
  startDate: z.string().min(1, "Required"),
  endDate: z.string().min(1, "Required"),
  feePerPerson: z.coerce.number().min(0),
  paymentHandle: z.string().min(1, "Required"),
  paymentUrl: z.string().optional(),
});

export function OrganizerSettings({ params }: { params: { reunionId: string } }) {
  const reunionId = parseInt(params.reunionId, 10);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: summary } = useGetReunion(reunionId, {
    query: { enabled: !isNaN(reunionId), queryKey: getGetReunionQueryKey(reunionId) }
  });

  const updateMutation = useUpdateReunion();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      startDate: "",
      endDate: "",
      feePerPerson: 0,
      paymentHandle: "",
      paymentUrl: "",
    },
  });

  useEffect(() => {
    if (summary) {
      form.reset({
        name: summary.reunion.name,
        startDate: summary.reunion.startDate,
        endDate: summary.reunion.endDate,
        feePerPerson: summary.reunion.feePerPerson,
        paymentHandle: summary.reunion.paymentHandle,
        paymentUrl: summary.reunion.paymentUrl || "",
      });
    }
  }, [summary, form]);

  const onSubmit = (values: z.infer<typeof formSchema>) => {
    updateMutation.mutate({
      reunionId,
      data: {
        name: values.name,
        startDate: values.startDate,
        endDate: values.endDate,
        feePerPerson: values.feePerPerson,
        paymentHandle: values.paymentHandle,
        paymentUrl: values.paymentUrl || undefined,
      }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetReunionQueryKey(reunionId) });
        toast({ title: "Settings saved" });
      }
    });
  };

  if (!summary) return null;

  return (
    <OrganizerLayout reunionId={reunionId}>
      <div className="flex flex-col gap-6 max-w-2xl">
        <h1 className="font-serif text-3xl font-bold">Settings</h1>
        
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 bg-card border shadow-sm rounded-3xl p-6 md:p-8">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="font-bold">Reunion Name</FormLabel>
                  <FormControl>
                    <Input className="rounded-xl bg-muted/50" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="startDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-bold">Start Date</FormLabel>
                    <FormControl>
                      <Input type="date" className="rounded-xl bg-muted/50" {...field} />
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
                    <FormLabel className="font-bold">End Date</FormLabel>
                    <FormControl>
                      <Input type="date" className="rounded-xl bg-muted/50" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="pt-4 border-t space-y-4">
              <h3 className="font-serif text-xl font-bold">Payment Details</h3>
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="feePerPerson"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="font-bold">Fee ($)</FormLabel>
                      <FormControl>
                        <Input type="number" className="rounded-xl bg-muted/50" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="paymentHandle"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="font-bold">Handle</FormLabel>
                      <FormControl>
                        <Input className="rounded-xl bg-muted/50" {...field} />
                      </FormControl>
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
                    <FormLabel className="font-bold">Payment Link</FormLabel>
                    <FormControl>
                      <Input className="rounded-xl bg-muted/50" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <Button type="submit" disabled={updateMutation.isPending} className="rounded-full w-full py-6 mt-4 font-bold text-lg shadow-md">
              Save Changes
            </Button>
          </form>
        </Form>
      </div>
    </OrganizerLayout>
  );
}
