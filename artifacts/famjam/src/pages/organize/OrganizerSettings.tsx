import { useEffect, useState } from "react";
import {
  useGetReunion,
  useUpdateReunion,
  getGetReunionQueryKey,
  useListReunionOrganizers,
  useAddReunionOrganizer,
  useRemoveReunionOrganizer,
  getListReunionOrganizersQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Crown, Trash2, UserPlus } from "lucide-react";
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

        <CoOrganizers reunionId={reunionId} />
      </div>
    </OrganizerLayout>
  );
}

function fullName(o: { firstName?: string | null; lastName?: string | null; email: string }) {
  const name = [o.firstName, o.lastName].filter(Boolean).join(" ").trim();
  return name || o.email;
}

function CoOrganizers({ reunionId }: { reunionId: number }) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data: organizers, isLoading } = useListReunionOrganizers(reunionId, {
    query: { enabled: !isNaN(reunionId), queryKey: getListReunionOrganizersQueryKey(reunionId) },
  });

  const addMutation = useAddReunionOrganizer();
  const removeMutation = useRemoveReunionOrganizer();

  const refetch = () =>
    queryClient.invalidateQueries({ queryKey: getListReunionOrganizersQueryKey(reunionId) });

  const onAdd = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const value = email.trim();
    if (!value) return;
    addMutation.mutate(
      { reunionId, data: { email: value } },
      {
        onSuccess: () => {
          setEmail("");
          refetch();
        },
        onError: (err: unknown) => {
          const anyErr = err as { data?: { error?: string } };
          setError(anyErr?.data?.error ?? "Could not add that co-organizer. Please try again.");
        },
      },
    );
  };

  const onRemove = (userId: string) => {
    setError(null);
    removeMutation.mutate(
      { reunionId, userId },
      {
        onSuccess: refetch,
        onError: () => setError("Could not remove that co-organizer. Please try again."),
      },
    );
  };

  return (
    <div className="bg-card border shadow-sm rounded-3xl p-6 md:p-8 space-y-5">
      <div>
        <h2 className="font-serif text-2xl font-bold">Organizers</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Co-organizers can manage registrations, the schedule, announcements, and payments — the
          same as you. Only the owner can be changed by transferring the reunion.
        </p>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading organizers…</p>
      ) : (
        <ul className="divide-y rounded-2xl border bg-muted/30">
          {(organizers ?? []).map((o) => (
            <li key={o.userId} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="font-medium truncate flex items-center gap-2">
                  {fullName(o)}
                  {o.isOwner && (
                    <span className="inline-flex items-center gap-1 text-xs font-bold text-primary bg-primary/10 rounded-full px-2 py-0.5">
                      <Crown className="w-3 h-3" /> Owner
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground truncate">{o.email}</div>
              </div>
              {!o.isOwner && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-destructive hover:text-destructive hover:bg-destructive/10 rounded-full shrink-0"
                  disabled={removeMutation.isPending}
                  onClick={() => onRemove(o.userId)}
                  aria-label={`Remove ${fullName(o)}`}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={onAdd} className="flex flex-col sm:flex-row gap-3 pt-1">
        <Input
          type="email"
          placeholder="co-organizer@email.com"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (error) setError(null);
          }}
          className="rounded-xl bg-muted/50"
        />
        <Button
          type="submit"
          disabled={addMutation.isPending || !email.trim()}
          className="rounded-full font-bold shrink-0 gap-2"
        >
          <UserPlus className="w-4 h-4" />
          Add co-organizer
        </Button>
      </form>
      {error && <p className="text-sm text-destructive font-medium">{error}</p>}
      <p className="text-xs text-muted-foreground">
        They need a FamJam account already — ask them to sign in once, then add them by the email on
        their account.
      </p>
    </div>
  );
}
