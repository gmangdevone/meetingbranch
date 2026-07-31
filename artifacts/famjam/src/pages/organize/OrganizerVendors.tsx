import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListVendors,
  getListVendorsQueryKey,
  useCreateVendor,
  useUpdateVendor,
  useDeleteVendor,
  useCreateVendorContract,
  useDeleteVendorContract,
  useRequestUploadUrl,
} from "@workspace/api-client-react";
import type { Vendor, VendorCategory, VendorInput } from "@workspace/api-client-react";
import { OrganizerLayout } from "./OrganizerLayout";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { Badge } from "../../components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../../components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import {
  Briefcase,
  Plus,
  Pencil,
  Trash2,
  FileText,
  Upload,
  CheckCircle2,
  XCircle,
  RotateCcw,
  Phone,
  Mail,
  Globe,
  MapPin,
  CalendarDays,
  Loader2,
} from "lucide-react";

const API_BASE = `${import.meta.env.BASE_URL}api`;

const CATEGORIES: { value: VendorCategory; label: string }[] = [
  { value: "venue", label: "Venue" },
  { value: "park", label: "Park" },
  { value: "caterer", label: "Caterer" },
  { value: "supplier", label: "Supplier" },
  { value: "entertainment", label: "Entertainment" },
  { value: "other", label: "Other" },
];

const categoryLabel = (c: VendorCategory) =>
  CATEGORIES.find((x) => x.value === c)?.label ?? c;

const formatMoney = (n: number) => `$${n.toLocaleString()}`;

function formatServiceWindow(v: Vendor): string | null {
  if (!v.serviceDate) return null;
  const fmtDate = (s: string) => {
    const d = new Date(`${s}T00:00:00`);
    return isNaN(d.getTime())
      ? s
      : d.toLocaleDateString(undefined, {
          weekday: "short",
          month: "short",
          day: "numeric",
          year: "numeric",
        });
  };
  const dateStr =
    v.serviceEndDate && v.serviceEndDate !== v.serviceDate
      ? `${fmtDate(v.serviceDate)} – ${fmtDate(v.serviceEndDate)}`
      : fmtDate(v.serviceDate);
  const fmtTime = (t?: string | null) => {
    if (!t) return null;
    const d = new Date(`2000-01-01T${t}:00`);
    return isNaN(d.getTime())
      ? t
      : d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  };
  const start = fmtTime(v.serviceStartTime);
  const end = fmtTime(v.serviceEndTime);
  if (start && end) return `${dateStr}, ${start} – ${end}`;
  if (start) return `${dateStr}, starting ${start}`;
  return dateStr;
}

type VendorFormState = {
  name: string;
  category: VendorCategory;
  contactName: string;
  phone: string;
  email: string;
  website: string;
  address: string;
  quotedCost: string;
  notes: string;
  serviceDate: string;
  serviceEndDate: string;
  serviceStartTime: string;
  serviceEndTime: string;
};

const emptyForm: VendorFormState = {
  name: "",
  category: "venue",
  contactName: "",
  phone: "",
  email: "",
  website: "",
  address: "",
  quotedCost: "",
  notes: "",
  serviceDate: "",
  serviceEndDate: "",
  serviceStartTime: "",
  serviceEndTime: "",
};

function vendorToForm(v: Vendor): VendorFormState {
  return {
    name: v.name,
    category: v.category,
    contactName: v.contactName ?? "",
    phone: v.phone ?? "",
    email: v.email ?? "",
    website: v.website ?? "",
    address: v.address ?? "",
    quotedCost: v.quotedCost != null ? String(v.quotedCost) : "",
    notes: v.notes ?? "",
    serviceDate: v.serviceDate ?? "",
    serviceEndDate: v.serviceEndDate ?? "",
    serviceStartTime: v.serviceStartTime ?? "",
    serviceEndTime: v.serviceEndTime ?? "",
  };
}

function formToInput(f: VendorFormState): VendorInput {
  const opt = (s: string) => (s.trim() === "" ? null : s.trim());
  return {
    name: f.name.trim(),
    category: f.category,
    contactName: opt(f.contactName),
    phone: opt(f.phone),
    email: opt(f.email),
    website: opt(f.website),
    address: opt(f.address),
    quotedCost: f.quotedCost.trim() === "" ? null : Math.max(0, Math.round(Number(f.quotedCost))),
    notes: opt(f.notes),
    serviceDate: opt(f.serviceDate),
    serviceEndDate: opt(f.serviceEndDate),
    serviceStartTime: opt(f.serviceStartTime),
    serviceEndTime: opt(f.serviceEndTime),
  };
}

export function OrganizerVendors({ params }: { params: { reunionId: string } }) {
  const reunionId = Number(params.reunionId);
  return (
    <OrganizerLayout reunionId={reunionId} requiredRole="power_user">
      <VendorsContent reunionId={reunionId} />
    </OrganizerLayout>
  );
}

function VendorsContent({ reunionId }: { reunionId: number }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useListVendors(reunionId, {
    query: { queryKey: getListVendorsQueryKey(reunionId) },
  });

  const createMutation = useCreateVendor();
  const updateMutation = useUpdateVendor();
  const deleteMutation = useDeleteVendor();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Vendor | null>(null);
  const [form, setForm] = useState<VendorFormState>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [confirmDelete, setConfirmDelete] = useState<Vendor | null>(null);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListVendorsQueryKey(reunionId) });

  const vendors = data?.vendors ?? [];
  const approved = vendors.filter((v) => v.status === "approved");
  const evaluating = useMemo(() => {
    const rest = vendors.filter((v) => v.status !== "approved");
    const filtered =
      categoryFilter === "all" ? rest : rest.filter((v) => v.category === categoryFilter);
    // Cheapest first so costs are easy to compare; vendors without a quote last.
    return [...filtered].sort((a, b) => {
      if (a.status !== b.status) return a.status === "rejected" ? 1 : -1;
      const ac = a.quotedCost ?? Number.MAX_SAFE_INTEGER;
      const bc = b.quotedCost ?? Number.MAX_SAFE_INTEGER;
      return ac - bc;
    });
  }, [vendors, categoryFilter]);

  const openAdd = () => {
    setEditing(null);
    setForm(emptyForm);
    setFormError(null);
    setDialogOpen(true);
  };
  const openEdit = (v: Vendor) => {
    setEditing(v);
    setForm(vendorToForm(v));
    setFormError(null);
    setDialogOpen(true);
  };

  const saveVendor = () => {
    if (form.name.trim() === "") {
      setFormError("Please give the vendor a name.");
      return;
    }
    if (form.quotedCost.trim() !== "" && (isNaN(Number(form.quotedCost)) || Number(form.quotedCost) < 0)) {
      setFormError("Quoted cost must be a positive number of dollars.");
      return;
    }
    if (form.serviceEndDate !== "" && form.serviceDate === "") {
      setFormError("Please pick a start date before setting an end date.");
      return;
    }
    if (form.serviceEndDate !== "" && form.serviceEndDate < form.serviceDate) {
      setFormError("The end date can't be before the start date.");
      return;
    }
    const input = formToInput(form);
    const opts = {
      onSuccess: () => {
        setDialogOpen(false);
        invalidate();
      },
      onError: () => setFormError("Something went wrong saving this vendor. Please try again."),
    };
    if (editing) {
      updateMutation.mutate({ reunionId, vendorId: editing.id, data: input }, opts);
    } else {
      createMutation.mutate({ reunionId, data: input }, opts);
    }
  };

  const setStatus = (v: Vendor, status: "prospect" | "approved" | "rejected") => {
    updateMutation.mutate(
      { reunionId, vendorId: v.id, data: { status } },
      { onSuccess: invalidate },
    );
  };

  const saving = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl font-bold flex items-center gap-3">
            <Briefcase className="w-7 h-7 text-primary" /> Vendors
          </h1>
          <p className="text-muted-foreground mt-1">
            Evaluate venues, parks, caterers, and suppliers — compare costs, keep contracts, and
            approve your vendors of choice.
          </p>
        </div>
        <Button onClick={openAdd}>
          <Plus className="w-4 h-4 mr-2" /> Add vendor
        </Button>
      </div>

      {/* Approved vendors */}
      <section className="flex flex-col gap-4">
        <h2 className="font-serif text-xl font-bold flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 text-green-600" /> Approved vendors
        </h2>
        {approved.length === 0 ? (
          <div className="bg-card border rounded-3xl p-8 text-center text-muted-foreground">
            No approved vendors yet. When you pick a vendor of choice below, they'll appear here
            with their contracted dates and contact details.
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {approved.map((v) => (
              <div key={v.id} className="bg-card border shadow-sm rounded-3xl p-6 flex flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-bold text-lg">{v.name}</div>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant="secondary">{categoryLabel(v.category)}</Badge>
                      <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Approved</Badge>
                    </div>
                  </div>
                  {v.quotedCost != null && (
                    <div className="text-right">
                      <div className="text-xl font-bold">{formatMoney(v.quotedCost)}</div>
                      <div className="text-xs text-muted-foreground">contracted cost</div>
                    </div>
                  )}
                </div>

                {formatServiceWindow(v) && (
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <CalendarDays className="w-4 h-4 text-primary" />
                    {formatServiceWindow(v)}
                  </div>
                )}

                <div className="flex flex-col gap-1.5 text-sm text-muted-foreground">
                  {v.contactName && <div className="font-medium text-foreground">{v.contactName}</div>}
                  {v.phone && (
                    <a href={`tel:${v.phone}`} className="flex items-center gap-2 hover:text-foreground">
                      <Phone className="w-3.5 h-3.5" /> {v.phone}
                    </a>
                  )}
                  {v.email && (
                    <a href={`mailto:${v.email}`} className="flex items-center gap-2 hover:text-foreground">
                      <Mail className="w-3.5 h-3.5" /> {v.email}
                    </a>
                  )}
                  {v.website && (
                    <a
                      href={v.website.startsWith("http") ? v.website : `https://${v.website}`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-2 hover:text-foreground"
                    >
                      <Globe className="w-3.5 h-3.5" /> {v.website}
                    </a>
                  )}
                  {v.address && (
                    <div className="flex items-center gap-2">
                      <MapPin className="w-3.5 h-3.5" /> {v.address}
                    </div>
                  )}
                </div>

                {v.notes && <p className="text-sm text-muted-foreground whitespace-pre-wrap">{v.notes}</p>}

                <ContractsRow vendor={v} reunionId={reunionId} onChanged={invalidate} />

                <div className="flex flex-wrap gap-2 pt-2 border-t mt-auto">
                  <Button size="sm" variant="outline" onClick={() => openEdit(v)}>
                    <Pencil className="w-3.5 h-3.5 mr-1.5" /> Edit
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setStatus(v, "prospect")}>
                    <RotateCcw className="w-3.5 h-3.5 mr-1.5" /> Move back to evaluating
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Evaluating / comparison */}
      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-serif text-xl font-bold">Evaluating</h2>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="All categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {CATEGORIES.map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="bg-card border rounded-3xl p-8 text-center text-muted-foreground">
            Loading vendors…
          </div>
        ) : evaluating.length === 0 ? (
          <div className="bg-card border rounded-3xl p-8 text-center text-muted-foreground">
            {vendors.length === 0
              ? "Add the venues, caterers, and suppliers you're considering to compare their costs side by side."
              : "No vendors match this filter."}
          </div>
        ) : (
          <div className="bg-card border shadow-sm rounded-3xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50 text-left">
                    <th className="px-5 py-3 font-semibold">Vendor</th>
                    <th className="px-5 py-3 font-semibold">Category</th>
                    <th className="px-5 py-3 font-semibold">Quoted cost</th>
                    <th className="px-5 py-3 font-semibold">Contact</th>
                    <th className="px-5 py-3 font-semibold">Contracts</th>
                    <th className="px-5 py-3 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {evaluating.map((v) => (
                    <tr key={v.id} className={`border-b last:border-0 ${v.status === "rejected" ? "opacity-60" : ""}`}>
                      <td className="px-5 py-4">
                        <div className="font-medium">{v.name}</div>
                        {v.status === "rejected" && (
                          <Badge variant="outline" className="mt-1 text-destructive border-destructive/40">
                            Passed on
                          </Badge>
                        )}
                        {v.notes && (
                          <div className="text-xs text-muted-foreground mt-1 max-w-xs truncate" title={v.notes}>
                            {v.notes}
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        <Badge variant="secondary">{categoryLabel(v.category)}</Badge>
                      </td>
                      <td className="px-5 py-4 font-semibold">
                        {v.quotedCost != null ? formatMoney(v.quotedCost) : <span className="text-muted-foreground font-normal">No quote yet</span>}
                      </td>
                      <td className="px-5 py-4 text-muted-foreground">
                        <div className="flex flex-col gap-0.5">
                          {v.contactName && <span className="text-foreground">{v.contactName}</span>}
                          {v.phone && <span>{v.phone}</span>}
                          {v.email && <span>{v.email}</span>}
                          {!v.contactName && !v.phone && !v.email && <span>—</span>}
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <ContractsRow vendor={v} reunionId={reunionId} onChanged={invalidate} compact />
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex justify-end gap-1.5 flex-wrap">
                          {v.status !== "rejected" ? (
                            <>
                              <Button size="sm" onClick={() => setStatus(v, "approved")}>
                                <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" /> Approve
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => setStatus(v, "rejected")}>
                                <XCircle className="w-3.5 h-3.5 mr-1.5" /> Pass
                              </Button>
                            </>
                          ) : (
                            <Button size="sm" variant="outline" onClick={() => setStatus(v, "prospect")}>
                              <RotateCcw className="w-3.5 h-3.5 mr-1.5" /> Reconsider
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" onClick={() => openEdit(v)}>
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setConfirmDelete(v)}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* Add / edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${editing.name}` : "Add a vendor"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "Update this vendor's details, quote, or contracted service window."
                : "Add a venue, park, caterer, or supplier you're considering."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 text-sm font-medium sm:col-span-2">
              Vendor name *
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Lakeside Pavilion" />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Category
              <Select value={form.category} onValueChange={(val) => setForm({ ...form, category: val as VendorCategory })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Quoted cost ($)
              <Input type="number" min={0} value={form.quotedCost} onChange={(e) => setForm({ ...form, quotedCost: e.target.value })} placeholder="e.g. 1500" />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Contact name
              <Input value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Phone
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Email
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Website
              <Input value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} placeholder="example.com" />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium sm:col-span-2">
              Address
              <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                Service start date
                <Input type="date" value={form.serviceDate} onChange={(e) => setForm({ ...form, serviceDate: e.target.value })} />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                End date
                <Input
                  type="date"
                  min={form.serviceDate || undefined}
                  value={form.serviceEndDate}
                  onChange={(e) => setForm({ ...form, serviceEndDate: e.target.value })}
                />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                Start time
                <Input type="time" value={form.serviceStartTime} onChange={(e) => setForm({ ...form, serviceStartTime: e.target.value })} />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                End time
                <Input type="time" value={form.serviceEndTime} onChange={(e) => setForm({ ...form, serviceEndTime: e.target.value })} />
              </label>
            </div>
            <label className="flex flex-col gap-1.5 text-sm font-medium sm:col-span-2">
              Notes
              <Textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="What's included, comparison notes, follow-ups…" />
            </label>
          </div>

          {formError && <p className="text-sm text-destructive">{formError}</p>}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveVendor} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {editing ? "Save changes" : "Add vendor"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={!!confirmDelete} onOpenChange={(open) => !open && setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {confirmDelete?.name}?</DialogTitle>
            <DialogDescription>
              This removes the vendor and its uploaded contracts from the list. This can't be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => {
                if (!confirmDelete) return;
                deleteMutation.mutate(
                  { reunionId, vendorId: confirmDelete.id },
                  {
                    onSuccess: () => {
                      setConfirmDelete(null);
                      invalidate();
                    },
                  },
                );
              }}
            >
              {deleteMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Remove vendor
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Contract list + upload button for one vendor. */
function ContractsRow({
  vendor,
  reunionId,
  onChanged,
  compact,
}: {
  vendor: Vendor;
  reunionId: number;
  onChanged: () => void;
  compact?: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const requestUrlMutation = useRequestUploadUrl();
  const createContract = useCreateVendorContract();
  const deleteContract = useDeleteVendorContract();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    setError(null);
    if (file.size > 10 * 1024 * 1024) {
      setError("File must be under 10MB.");
      return;
    }
    const contentType = file.type || "application/pdf";
    if (!(contentType === "application/pdf" || contentType.startsWith("image/"))) {
      setError("Please upload a PDF or an image of the contract.");
      return;
    }
    setUploading(true);
    try {
      const { uploadURL, objectPath } = await requestUrlMutation.mutateAsync({
        data: { name: file.name, size: file.size, contentType },
      });
      const putRes = await fetch(uploadURL, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": contentType },
      });
      if (!putRes.ok) throw new Error("Upload failed");
      await createContract.mutateAsync({
        reunionId,
        vendorId: vendor.id,
        data: { fileName: file.name, objectPath },
      });
      onChanged();
    } catch {
      setError("Upload didn't go through. Please try again.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className={`flex flex-col gap-1.5 ${compact ? "" : "pt-1"}`}>
      {vendor.contracts.map((c) => (
        <div key={c.id} className="flex items-center gap-1.5 text-sm">
          <a
            href={`${API_BASE}/storage${c.objectPath}`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 text-primary hover:underline min-w-0"
            title={c.fileName}
          >
            <FileText className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate max-w-[10rem]">{c.fileName}</span>
          </a>
          <button
            type="button"
            aria-label={`Remove ${c.fileName}`}
            className="text-muted-foreground hover:text-destructive"
            onClick={() =>
              deleteContract.mutate(
                { reunionId, vendorId: vendor.id, contractId: c.id },
                { onSuccess: onChanged },
              )
            }
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
        }}
      />
      <Button
        size="sm"
        variant={compact ? "ghost" : "outline"}
        className="self-start"
        disabled={uploading}
        onClick={() => fileInputRef.current?.click()}
      >
        {uploading ? (
          <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
        ) : (
          <Upload className="w-3.5 h-3.5 mr-1.5" />
        )}
        {vendor.contracts.length ? "Add contract" : "Upload contract"}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
