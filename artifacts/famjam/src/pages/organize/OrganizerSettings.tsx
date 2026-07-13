import { useEffect, useState } from "react";
import {
  useGetReunion,
  useUpdateReunion,
  getGetReunionQueryKey,
  useListReunionOrganizers,
  useAddReunionOrganizer,
  useRemoveReunionOrganizer,
  useUpdateOrganizerRoles,
  useTransferReunionOwnership,
  useCreateFee,
  useUpdateFee,
  useDeleteFee,
  getListReunionOrganizersQueryKey,
  type ReunionFee,
  type FeeInput,
  type ReunionRole,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Crown, Trash2, UserPlus, Plus, Pencil, X, Check } from "lucide-react";
import { OrganizerLayout } from "./OrganizerLayout";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "../../components/ui/form";
import { Checkbox } from "../../components/ui/checkbox";
import { useToast } from "../../hooks/use-toast";
import { describeFee } from "../../lib/fees";
import { ROLE_OPTIONS, ROLE_LABELS } from "../../lib/roles";

const formSchema = z.object({
  name: z.string().min(1, "Required"),
  startDate: z.string().min(1, "Required"),
  endDate: z.string().min(1, "Required"),
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
    <OrganizerLayout reunionId={reunionId} requiredRole="power_user">
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
              <FormField
                control={form.control}
                name="paymentHandle"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-bold">Handle</FormLabel>
                    <FormControl>
                      <Input className="rounded-xl bg-muted/50" placeholder="@venmo-handle or Cash App $tag" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
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

        <FeesManager reunionId={reunionId} fees={summary.reunion.fees} />

        {summary.viewer?.canManageOrganizers && <CoOrganizers reunionId={reunionId} />}
        {/* CoOrganizers is only shown to owner/admin (canManageOrganizers), so all
            roster controls inside are available to whoever can see it. */}
      </div>
    </OrganizerLayout>
  );
}

type FeeFormState = {
  label: string;
  chargeType: "per_person" | "flat";
  isOptional: boolean;
  amount: string;
  hasAgeTier: boolean;
  ageThreshold: string;
  amountUnderThreshold: string;
};

const EMPTY_FEE: FeeFormState = {
  label: "",
  chargeType: "per_person",
  isOptional: false,
  amount: "",
  hasAgeTier: false,
  ageThreshold: "",
  amountUnderThreshold: "",
};

function feeToFormState(fee: ReunionFee): FeeFormState {
  return {
    label: fee.label,
    chargeType: fee.chargeType,
    isOptional: fee.isOptional,
    amount: String(fee.amount),
    hasAgeTier: fee.ageThreshold != null && fee.amountUnderThreshold != null,
    ageThreshold: fee.ageThreshold != null ? String(fee.ageThreshold) : "",
    amountUnderThreshold: fee.amountUnderThreshold != null ? String(fee.amountUnderThreshold) : "",
  };
}

function FeesManager({ reunionId, fees }: { reunionId: number; fees: ReunionFee[] }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [editingId, setEditingId] = useState<number | "new" | null>(null);
  const [draft, setDraft] = useState<FeeFormState>(EMPTY_FEE);
  const [error, setError] = useState<string | null>(null);

  const createMutation = useCreateFee();
  const updateMutation = useUpdateFee();
  const deleteMutation = useDeleteFee();
  const busy = createMutation.isPending || updateMutation.isPending || deleteMutation.isPending;

  const refetch = () =>
    queryClient.invalidateQueries({ queryKey: getGetReunionQueryKey(reunionId) });

  const startAdd = () => {
    setError(null);
    setDraft(EMPTY_FEE);
    setEditingId("new");
  };
  const startEdit = (fee: ReunionFee) => {
    setError(null);
    setDraft(feeToFormState(fee));
    setEditingId(fee.id);
  };
  const cancel = () => {
    setEditingId(null);
    setError(null);
  };

  const buildPayload = (): FeeInput | null => {
    const label = draft.label.trim();
    const amount = Number(draft.amount);
    if (!label) {
      setError("Please give this fee a label.");
      return null;
    }
    if (!Number.isFinite(amount) || amount < 0) {
      setError("Enter a valid amount.");
      return null;
    }
    const useTier = draft.chargeType === "per_person" && draft.hasAgeTier;
    const ageThreshold = Number(draft.ageThreshold);
    const amountUnder = Number(draft.amountUnderThreshold);
    if (useTier) {
      if (!Number.isInteger(ageThreshold) || ageThreshold < 1) {
        setError("Enter a valid age threshold (1 or higher).");
        return null;
      }
      if (!Number.isFinite(amountUnder) || amountUnder < 0) {
        setError("Enter a valid under-threshold amount.");
        return null;
      }
    }
    return {
      label,
      chargeType: draft.chargeType,
      isOptional: draft.isOptional,
      amount,
      ageThreshold: useTier ? ageThreshold : null,
      amountUnderThreshold: useTier ? amountUnder : null,
    };
  };

  const save = () => {
    const data = buildPayload();
    if (!data) return;
    const onDone = {
      onSuccess: () => {
        refetch();
        setEditingId(null);
        toast({ title: "Fees updated" });
      },
      onError: () => setError("Could not save that fee. Please try again."),
    };
    if (editingId === "new") {
      createMutation.mutate({ reunionId, data }, onDone);
    } else if (typeof editingId === "number") {
      updateMutation.mutate({ reunionId, feeId: editingId, data }, onDone);
    }
  };

  const remove = (fee: ReunionFee) => {
    if (!window.confirm(`Remove "${fee.label}"? Families will no longer be charged this fee.`)) return;
    deleteMutation.mutate(
      { reunionId, feeId: fee.id },
      {
        onSuccess: () => {
          refetch();
          if (editingId === fee.id) setEditingId(null);
        },
        onError: () => setError("Could not remove that fee. Please try again."),
      },
    );
  };

  return (
    <div className="bg-card border shadow-sm rounded-3xl p-6 md:p-8 space-y-5">
      <div>
        <h2 className="font-serif text-2xl font-bold">Fees &amp; Dues</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Add every charge for this reunion — registration fees, dues, T-shirts, and more. Choose how
          each is charged, whether it's optional, and set an age-based price if you like.
        </p>
      </div>

      {fees.length === 0 ? (
        <p className="text-sm text-muted-foreground">No fees yet — this reunion is free to attend.</p>
      ) : (
        <ul className="divide-y rounded-2xl border bg-muted/30">
          {fees.map((fee) => (
            <li key={fee.id}>
              {editingId === fee.id ? (
                <FeeEditor
                  draft={draft}
                  setDraft={setDraft}
                  onSave={save}
                  onCancel={cancel}
                  busy={busy}
                  error={error}
                />
              ) : (
                <div className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="font-medium truncate flex items-center gap-2">
                      {fee.label}
                      {fee.isOptional && (
                        <span className="text-xs font-bold text-secondary-foreground bg-secondary/30 rounded-full px-2 py-0.5">
                          Optional
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">{describeFee(fee)}</div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="rounded-full text-muted-foreground hover:text-foreground"
                      disabled={busy}
                      onClick={() => startEdit(fee)}
                      aria-label={`Edit ${fee.label}`}
                    >
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="rounded-full text-destructive hover:text-destructive hover:bg-destructive/10"
                      disabled={busy}
                      onClick={() => remove(fee)}
                      aria-label={`Remove ${fee.label}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {editingId === "new" ? (
        <div className="rounded-2xl border bg-muted/30">
          <FeeEditor
            draft={draft}
            setDraft={setDraft}
            onSave={save}
            onCancel={cancel}
            busy={busy}
            error={error}
          />
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          onClick={startAdd}
          disabled={busy}
          className="rounded-full font-bold gap-2"
        >
          <Plus className="w-4 h-4" /> Add a fee or dues item
        </Button>
      )}
    </div>
  );
}

function FeeEditor({
  draft,
  setDraft,
  onSave,
  onCancel,
  busy,
  error,
}: {
  draft: FeeFormState;
  setDraft: React.Dispatch<React.SetStateAction<FeeFormState>>;
  onSave: () => void;
  onCancel: () => void;
  busy: boolean;
  error: string | null;
}) {
  const set = <K extends keyof FeeFormState>(key: K, value: FeeFormState[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  return (
    <div className="p-4 space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2">
          <label className="text-sm font-bold block mb-1">Label</label>
          <Input
            className="rounded-xl bg-background"
            placeholder="e.g. Registration Fee, T-Shirt, Facility Dues"
            value={draft.label}
            onChange={(e) => set("label", e.target.value)}
          />
        </div>

        <div>
          <label className="text-sm font-bold block mb-1">How is it charged?</label>
          <div className="flex rounded-xl border overflow-hidden">
            <button
              type="button"
              onClick={() => set("chargeType", "per_person")}
              className={`flex-1 px-3 py-2 text-sm font-medium ${draft.chargeType === "per_person" ? "bg-primary text-primary-foreground" : "bg-background"}`}
            >
              Per person
            </button>
            <button
              type="button"
              onClick={() => set("chargeType", "flat")}
              className={`flex-1 px-3 py-2 text-sm font-medium ${draft.chargeType === "flat" ? "bg-primary text-primary-foreground" : "bg-background"}`}
            >
              Flat / household
            </button>
          </div>
        </div>

        <div>
          <label className="text-sm font-bold block mb-1">
            {draft.chargeType === "per_person" && draft.hasAgeTier ? "Amount (age & up)" : "Amount ($)"}
          </label>
          <Input
            type="number"
            min={0}
            className="rounded-xl bg-background"
            placeholder="0"
            value={draft.amount}
            onChange={(e) => set("amount", e.target.value)}
          />
        </div>
      </div>

      <label className="flex items-center gap-3 cursor-pointer">
        <Checkbox
          checked={draft.isOptional}
          onCheckedChange={(v) => set("isOptional", v === true)}
        />
        <span className="text-sm">
          <span className="font-medium">Optional</span>
          <span className="text-muted-foreground"> — families choose whether to add this</span>
        </span>
      </label>

      {draft.chargeType === "per_person" && (
        <div className="space-y-3">
          <label className="flex items-center gap-3 cursor-pointer">
            <Checkbox
              checked={draft.hasAgeTier}
              onCheckedChange={(v) => set("hasAgeTier", v === true)}
            />
            <span className="text-sm">
              <span className="font-medium">Age-based pricing</span>
              <span className="text-muted-foreground"> — charge a different amount for younger attendees</span>
            </span>
          </label>
          {draft.hasAgeTier && (
            <div className="grid grid-cols-2 gap-4 pl-7">
              <div>
                <label className="text-sm font-bold block mb-1">Under age…</label>
                <Input
                  type="number"
                  min={1}
                  className="rounded-xl bg-background"
                  placeholder="e.g. 12"
                  value={draft.ageThreshold}
                  onChange={(e) => set("ageThreshold", e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm font-bold block mb-1">…pays ($)</label>
                <Input
                  type="number"
                  min={0}
                  className="rounded-xl bg-background"
                  placeholder="0"
                  value={draft.amountUnderThreshold}
                  onChange={(e) => set("amountUnderThreshold", e.target.value)}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {error && <p className="text-sm text-destructive font-medium">{error}</p>}

      <div className="flex gap-2">
        <Button type="button" onClick={onSave} disabled={busy} className="rounded-full font-bold gap-2">
          <Check className="w-4 h-4" /> Save fee
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={onCancel}
          disabled={busy}
          className="rounded-full gap-2"
        >
          <X className="w-4 h-4" /> Cancel
        </Button>
      </div>
    </div>
  );
}

function fullName(o: { firstName?: string | null; lastName?: string | null; email: string }) {
  const name = [o.firstName, o.lastName].filter(Boolean).join(" ").trim();
  return name || o.email;
}

function RolePicker({
  selected,
  onToggle,
  disabled,
  idPrefix,
}: {
  selected: ReunionRole[];
  onToggle: (role: ReunionRole, checked: boolean) => void;
  disabled?: boolean;
  idPrefix: string;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {ROLE_OPTIONS.map((role) => {
        const id = `${idPrefix}-${role.value}`;
        return (
          <label
            key={role.value}
            htmlFor={id}
            className="flex items-start gap-3 rounded-xl border bg-background p-3 cursor-pointer hover:border-primary/40"
          >
            <Checkbox
              id={id}
              checked={selected.includes(role.value)}
              disabled={disabled}
              onCheckedChange={(v) => onToggle(role.value, v === true)}
              className="mt-0.5"
            />
            <span className="text-sm leading-tight">
              <span className="font-bold block">{role.label}</span>
              <span className="text-muted-foreground text-xs">{role.description}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

function CoOrganizers({ reunionId }: { reunionId: number }) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [newRoles, setNewRoles] = useState<ReunionRole[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRoles, setEditRoles] = useState<ReunionRole[]>([]);

  const { data: organizers, isLoading } = useListReunionOrganizers(reunionId, {
    query: { enabled: !isNaN(reunionId), queryKey: getListReunionOrganizersQueryKey(reunionId) },
  });

  const addMutation = useAddReunionOrganizer();
  const removeMutation = useRemoveReunionOrganizer();
  const rolesMutation = useUpdateOrganizerRoles();
  const transferMutation = useTransferReunionOwnership();

  const refetch = () =>
    queryClient.invalidateQueries({ queryKey: getListReunionOrganizersQueryKey(reunionId) });

  const toggle = (
    setter: React.Dispatch<React.SetStateAction<ReunionRole[]>>,
    role: ReunionRole,
    checked: boolean,
  ) => setter((prev) => (checked ? [...new Set([...prev, role])] : prev.filter((r) => r !== role)));

  const onAdd = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const value = email.trim();
    if (!value) return;
    addMutation.mutate(
      { reunionId, data: { email: value, roles: newRoles } },
      {
        onSuccess: () => {
          setEmail("");
          setNewRoles([]);
          refetch();
        },
        onError: (err: unknown) => {
          const anyErr = err as { data?: { error?: string } };
          setError(anyErr?.data?.error ?? "Could not add that co-organizer. Please try again.");
        },
      },
    );
  };

  const startEdit = (member: { userId: string; roles: ReunionRole[] }) => {
    setError(null);
    setEditingId(member.userId);
    setEditRoles(member.roles ?? []);
  };

  const onSaveRoles = (memberId: string) => {
    setError(null);
    rolesMutation.mutate(
      { reunionId, userId: memberId, data: { roles: editRoles } },
      {
        onSuccess: () => {
          setEditingId(null);
          refetch();
        },
        onError: (err: unknown) => {
          const anyErr = err as { data?: { error?: string } };
          setError(anyErr?.data?.error ?? "Could not update roles. Please try again.");
        },
      },
    );
  };

  const onRemove = (memberId: string) => {
    setError(null);
    removeMutation.mutate(
      { reunionId, userId: memberId },
      {
        onSuccess: refetch,
        onError: () => setError("Could not remove that co-organizer. Please try again."),
      },
    );
  };

  const onTransfer = (member: { userId: string; email: string; firstName?: string | null; lastName?: string | null }) => {
    setError(null);
    const label = fullName(member);
    if (
      !window.confirm(
        `Make ${label} the new owner of this reunion? You'll stay on as a co-organizer, but only the new owner will be able to transfer ownership or manage organizers.`,
      )
    ) {
      return;
    }
    transferMutation.mutate(
      { reunionId, data: { userId: member.userId } },
      {
        onSuccess: refetch,
        onError: (err: unknown) => {
          const anyErr = err as { data?: { error?: string } };
          setError(anyErr?.data?.error ?? "Could not transfer ownership. Please try again.");
        },
      },
    );
  };

  const busy =
    addMutation.isPending ||
    removeMutation.isPending ||
    transferMutation.isPending ||
    rolesMutation.isPending;

  return (
    <div className="bg-card border shadow-sm rounded-3xl p-6 md:p-8 space-y-5">
      <div>
        <h2 className="font-serif text-2xl font-bold">Organizers</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Give each co-organizer only the areas they should manage — registrations, announcements,
          schedule, branches, reports, or Power User access to reunion details and fees. As the
          owner you always have full access, and you can hand off ownership with "Make owner"
          (you'll stay on as a co-organizer afterward).
        </p>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading organizers…</p>
      ) : (
        <ul className="divide-y rounded-2xl border bg-muted/30">
          {(organizers ?? []).map((o) => (
            <li key={o.userId} className="px-4 py-3 space-y-3">
              <div className="flex items-center justify-between gap-3">
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
                  <div className="flex items-center gap-1 shrink-0">
                    {editingId !== o.userId && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="rounded-full gap-1.5"
                        disabled={busy}
                        onClick={() => startEdit(o)}
                        aria-label={`Edit roles for ${fullName(o)}`}
                      >
                        <Pencil className="w-4 h-4" />
                        Roles
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-primary hover:text-primary hover:bg-primary/10 rounded-full gap-1.5"
                      disabled={busy}
                      onClick={() => onTransfer(o)}
                      aria-label={`Make ${fullName(o)} the owner`}
                    >
                      <Crown className="w-4 h-4" />
                      Make owner
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:text-destructive hover:bg-destructive/10 rounded-full"
                      disabled={busy}
                      onClick={() => onRemove(o.userId)}
                      aria-label={`Remove ${fullName(o)}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                )}
              </div>

              {!o.isOwner && editingId === o.userId ? (
                <div className="space-y-3 rounded-2xl border bg-background p-3">
                  <RolePicker
                    selected={editRoles}
                    onToggle={(role, checked) => toggle(setEditRoles, role, checked)}
                    disabled={rolesMutation.isPending}
                    idPrefix={`edit-${o.userId}`}
                  />
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      className="rounded-full font-bold gap-1.5"
                      disabled={rolesMutation.isPending}
                      onClick={() => onSaveRoles(o.userId)}
                    >
                      <Check className="w-4 h-4" /> Save roles
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="rounded-full gap-1.5"
                      disabled={rolesMutation.isPending}
                      onClick={() => setEditingId(null)}
                    >
                      <X className="w-4 h-4" /> Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                !o.isOwner && (
                  <div className="flex flex-wrap gap-1.5">
                    {o.roles.length === 0 ? (
                      <span className="text-xs text-muted-foreground italic">
                        No areas assigned yet
                      </span>
                    ) : (
                      o.roles.map((r) => (
                        <span
                          key={r}
                          className="text-xs font-bold bg-secondary text-secondary-foreground rounded-full px-2.5 py-0.5"
                        >
                          {ROLE_LABELS[r]}
                        </span>
                      ))
                    )}
                  </div>
                )
              )}
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={onAdd} className="space-y-3 pt-1">
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
        <div>
          <p className="text-sm font-bold mb-2">Which areas should they manage?</p>
          <RolePicker
            selected={newRoles}
            onToggle={(role, checked) => toggle(setNewRoles, role, checked)}
            disabled={addMutation.isPending}
            idPrefix="new"
          />
        </div>
        <Button
          type="submit"
          disabled={addMutation.isPending || !email.trim()}
          className="rounded-full font-bold gap-2"
        >
          <UserPlus className="w-4 h-4" />
          Add co-organizer
        </Button>
      </form>
      {error && <p className="text-sm text-destructive font-medium">{error}</p>}
      <p className="text-xs text-muted-foreground">
        They need a FamJam account already — ask them to sign in once, then add them by the email on
        their account. You can change their areas any time.
      </p>
    </div>
  );
}
