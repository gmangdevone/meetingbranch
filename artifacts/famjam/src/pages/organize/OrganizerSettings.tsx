import { useEffect, useRef, useState } from "react";
import {
  useGetReunion,
  useUpdateReunion,
  useRequestUploadUrl,
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
import { Crown, Trash2, UserPlus, Plus, Pencil, X, Check, ImageIcon, Upload, ArrowUp, ArrowDown } from "lucide-react";
import { OrganizerLayout } from "./OrganizerLayout";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "../../components/ui/form";
import { Checkbox } from "../../components/ui/checkbox";
import { Switch } from "../../components/ui/switch";
import { useToast } from "../../hooks/use-toast";
import { ImageLibraryDialog } from "../../components/ImageLibraryDialog";
import { useCreateReunionImage, getListReunionImagesQueryKey } from "@workspace/api-client-react";
import { describeFee } from "../../lib/fees";
import { ROLE_OPTIONS, ROLE_LABELS } from "../../lib/roles";

const formSchema = z.object({
  name: z.string().min(1, "Required"),
  startDate: z.string().min(1, "Required"),
  endDate: z.string().min(1, "Required"),
  paymentHandle: z.string().min(1, "Required"),
  paymentUrl: z.string().optional(),
  cashAppTag: z.string().optional(),
  checkPayee: z.string().optional(),
  registrationsOpen: z.boolean().default(true),
  allowRegistrantEdits: z.boolean().default(false),
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
      cashAppTag: "",
      checkPayee: "",
      registrationsOpen: true,
      allowRegistrantEdits: false,
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
        cashAppTag: summary.reunion.cashAppTag || "",
        checkPayee: summary.reunion.checkPayee || "",
        registrationsOpen: summary.reunion.registrationsOpen,
        allowRegistrantEdits: summary.reunion.allowRegistrantEdits ?? false,
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
        cashAppTag: values.cashAppTag?.trim() || null,
        checkPayee: values.checkPayee?.trim() || null,
        registrationsOpen: values.registrationsOpen,
        allowRegistrantEdits: values.allowRegistrantEdits,
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
              <h3 className="font-serif text-xl font-bold">Registration Status</h3>
              <FormField
                control={form.control}
                name="registrationsOpen"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-xl border p-4">
                    <div className="space-y-0.5">
                      <FormLabel className="font-bold text-base">Registrations Open</FormLabel>
                      <div className="text-sm text-muted-foreground">
                        {field.value 
                          ? "Families can currently register and select fees." 
                          : "Registration is closed. New families cannot register, but existing ones keep their spot."}
                      </div>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="allowRegistrantEdits"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-xl border p-4">
                    <div className="space-y-0.5">
                      <FormLabel className="font-bold text-base">Allow Registrants to Edit</FormLabel>
                      <div className="text-sm text-muted-foreground">
                        {field.value
                          ? "Registrants can edit their own registration (attendees, branch, add-ons)."
                          : "Only organizers can edit registrations. Registrants must contact you for changes."}
                      </div>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
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
              <FormField
                control={form.control}
                name="cashAppTag"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-bold">Cash App $Cashtag</FormLabel>
                    <FormControl>
                      <Input className="rounded-xl bg-muted/50" placeholder="$YourCashtag" {...field} />
                    </FormControl>
                    <div className="text-xs text-muted-foreground">
                      The Cash App account that receives payments. Registrants get a "pay with Cash App"
                      option that opens the app with their total prefilled. Leave blank to hide the Cash App option.
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="checkPayee"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-bold">Checks Payable To</FormLabel>
                    <FormControl>
                      <Input className="rounded-xl bg-muted/50" placeholder="e.g. Lacey Family Reunion Fund" {...field} />
                    </FormControl>
                    <div className="text-xs text-muted-foreground">
                      Shown to registrants as "Make payment out to". Leave blank to hide the check option.
                    </div>
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

        <HubImagesManager reunionId={reunionId} reunion={summary.reunion} />

        <FeesManager reunionId={reunionId} fees={summary.reunion.fees} />

        {summary.viewer?.canManageOrganizers && <CoOrganizers reunionId={reunionId} />}
        {/* CoOrganizers is only shown to owner/admin (canManageOrganizers), so all
            roster controls inside are available to whoever can see it. */}
      </div>
    </OrganizerLayout>
  );
}

const API_BASE = `${import.meta.env.BASE_URL}api`;

/**
 * One uploadable image slot (hero banner or a hub card background).
 * Saves via a partial reunion update — only its own field is touched, so a
 * concurrent settings edit by another organizer can't be clobbered.
 */
function ImageSlot({
  reunionId,
  field,
  label,
  hint,
  imageUrl,
  previewClassName = "h-40 md:h-52",
}: {
  reunionId: number;
  field: "heroImageUrl" | "scheduleCardImageUrl" | "announcementsCardImageUrl" | "pollsCardImageUrl";
  label: string;
  hint: string;
  imageUrl: string | null;
  previewClassName?: string;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);

  const requestUrlMutation = useRequestUploadUrl();
  const updateMutation = useUpdateReunion();
  const registerImageMutation = useCreateReunionImage();
  const busy = isUploading || updateMutation.isPending;

  const saveImage = (objectPath: string | null) => {
    updateMutation.mutate(
      { reunionId, data: { [field]: objectPath } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetReunionQueryKey(reunionId) });
          toast({
            title: objectPath ? `${label} image updated` : `${label} image removed`,
            description: objectPath ? "The hub page now uses your custom image." : "Back to the default look.",
          });
        },
        onError: () => toast({ title: `Could not save the ${label} image`, variant: "destructive" }),
      },
    );
  };

  const onFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Please choose an image file", variant: "destructive" });
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast({ title: "Image too large", description: "Please keep the image under 10MB.", variant: "destructive" });
      return;
    }
    setIsUploading(true);
    try {
      const { uploadURL, objectPath } = await requestUrlMutation.mutateAsync({
        data: { name: file.name, size: file.size, contentType: file.type },
      });
      const putRes = await fetch(uploadURL, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!putRes.ok) throw new Error(`Upload failed (${putRes.status})`);
      // Save the upload into the image library so it can be reused later.
      // Best-effort: the slot still gets its image even if registration fails.
      try {
        await registerImageMutation.mutateAsync({
          reunionId,
          data: { fileName: file.name, objectPath },
        });
        queryClient.invalidateQueries({ queryKey: getListReunionImagesQueryKey(reunionId) });
      } catch {
        // ignore — image is still usable in this slot
      }
      saveImage(objectPath);
    } catch {
      toast({ title: "Upload failed", description: "Please try again.", variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <h3 className="font-bold text-lg">{label}</h3>
        <p className="text-sm text-muted-foreground">{hint}</p>
      </div>

      {imageUrl ? (
        <div className="relative rounded-2xl overflow-hidden border">
          <img
            src={`${API_BASE}/storage${imageUrl}`}
            alt={`Current ${label} background`}
            className={`w-full object-cover ${previewClassName}`}
          />
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed bg-muted/30 h-24 flex flex-col items-center justify-center gap-1.5 text-muted-foreground">
          <ImageIcon className="w-6 h-6" />
          <span className="text-sm font-medium">Using the default background</span>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onFileChosen}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
          className="rounded-full font-bold gap-2"
        >
          <Upload className="w-4 h-4" />
          {isUploading ? "Uploading..." : imageUrl ? "Replace Image" : "Upload Image"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => setLibraryOpen(true)}
          disabled={busy}
          className="rounded-full font-bold gap-2"
        >
          <ImageIcon className="w-4 h-4" /> Choose from Library
        </Button>
        <ImageLibraryDialog
          reunionId={reunionId}
          open={libraryOpen}
          onOpenChange={setLibraryOpen}
          currentObjectPath={imageUrl}
          onSelect={(objectPath) => saveImage(objectPath)}
        />
        {imageUrl && (
          <Button
            type="button"
            variant="outline"
            onClick={() => saveImage(null)}
            disabled={busy}
            className="rounded-full font-bold gap-2 text-destructive hover:text-destructive"
          >
            <Trash2 className="w-4 h-4" /> Remove (use default)
          </Button>
        )}
      </div>
    </div>
  );
}

const MAX_HERO_IMAGES = 5;

/**
 * Manages the hero banner slideshow: up to 5 ordered images (add from library
 * or upload, reorder, remove) plus the rotation speed (3–8 seconds).
 * Every change saves immediately via a partial reunion update.
 */
function HeroSlideshowManager({
  reunionId,
  heroImageUrls,
  rotationSeconds,
}: {
  reunionId: number;
  heroImageUrls: string[];
  rotationSeconds: number;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);

  const requestUrlMutation = useRequestUploadUrl();
  const updateMutation = useUpdateReunion();
  const registerImageMutation = useCreateReunionImage();
  const busy = isUploading || updateMutation.isPending;
  const atCap = heroImageUrls.length >= MAX_HERO_IMAGES;

  const save = (data: { heroImageUrls?: string[]; heroRotationSeconds?: number }, successTitle: string) => {
    updateMutation.mutate(
      { reunionId, data },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetReunionQueryKey(reunionId) });
          toast({ title: successTitle });
        },
        onError: () => toast({ title: "Could not save the hero banner", variant: "destructive" }),
      },
    );
  };

  const addImage = (objectPath: string) => {
    if (atCap) {
      toast({ title: `You can have up to ${MAX_HERO_IMAGES} hero images`, variant: "destructive" });
      return;
    }
    if (heroImageUrls.includes(objectPath)) {
      toast({ title: "That image is already in the slideshow" });
      return;
    }
    save({ heroImageUrls: [...heroImageUrls, objectPath] }, "Hero image added");
  };

  const removeImage = (index: number) => {
    save({ heroImageUrls: heroImageUrls.filter((_, i) => i !== index) }, "Hero image removed");
  };

  const moveImage = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= heroImageUrls.length) return;
    const next = [...heroImageUrls];
    [next[index], next[target]] = [next[target], next[index]];
    save({ heroImageUrls: next }, "Order updated");
  };

  const onFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Please choose an image file", variant: "destructive" });
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast({ title: "Image too large", description: "Please keep the image under 10MB.", variant: "destructive" });
      return;
    }
    setIsUploading(true);
    try {
      const { uploadURL, objectPath } = await requestUrlMutation.mutateAsync({
        data: { name: file.name, size: file.size, contentType: file.type },
      });
      const putRes = await fetch(uploadURL, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!putRes.ok) throw new Error(`Upload failed (${putRes.status})`);
      // Save into the image library for reuse (best-effort).
      try {
        await registerImageMutation.mutateAsync({
          reunionId,
          data: { fileName: file.name, objectPath },
        });
        queryClient.invalidateQueries({ queryKey: getListReunionImagesQueryKey(reunionId) });
      } catch {
        // ignore — image is still usable in the slideshow
      }
      addImage(objectPath);
    } catch {
      toast({ title: "Upload failed", description: "Please try again.", variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <h3 className="font-bold text-lg">Hero Banner</h3>
        <p className="text-sm text-muted-foreground">
          The big banner at the top of the hub. Add up to {MAX_HERO_IMAGES} wide images (around 2048×640) —
          with more than one, the banner rotates through them automatically.
        </p>
      </div>

      {heroImageUrls.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-muted/30 h-24 flex flex-col items-center justify-center gap-1.5 text-muted-foreground">
          <ImageIcon className="w-6 h-6" />
          <span className="text-sm font-medium">Using the default background</span>
        </div>
      ) : (
        <div className="space-y-2">
          {heroImageUrls.map((url, i) => (
            <div key={url} className="flex items-center gap-3 rounded-2xl border p-2">
              <img
                src={`${API_BASE}/storage${url}`}
                alt={`Hero slide ${i + 1}`}
                className="h-16 w-28 object-cover rounded-xl shrink-0"
              />
              <span className="text-sm font-medium text-muted-foreground flex-1">Slide {i + 1}</span>
              <div className="flex gap-1">
                <Button
                  type="button" variant="ghost" size="icon" disabled={busy || i === 0}
                  onClick={() => moveImage(i, -1)} aria-label={`Move slide ${i + 1} up`}
                >
                  <ArrowUp className="w-4 h-4" />
                </Button>
                <Button
                  type="button" variant="ghost" size="icon" disabled={busy || i === heroImageUrls.length - 1}
                  onClick={() => moveImage(i, 1)} aria-label={`Move slide ${i + 1} down`}
                >
                  <ArrowDown className="w-4 h-4" />
                </Button>
                <Button
                  type="button" variant="ghost" size="icon" disabled={busy}
                  onClick={() => removeImage(i)} aria-label={`Remove slide ${i + 1}`}
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onFileChosen} />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy || atCap}
          className="rounded-full font-bold gap-2"
        >
          <Upload className="w-4 h-4" />
          {isUploading ? "Uploading..." : "Upload Image"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => setLibraryOpen(true)}
          disabled={busy || atCap}
          className="rounded-full font-bold gap-2"
        >
          <ImageIcon className="w-4 h-4" /> Choose from Library
        </Button>
        <ImageLibraryDialog
          reunionId={reunionId}
          open={libraryOpen}
          onOpenChange={setLibraryOpen}
          onSelect={(objectPath) => addImage(objectPath)}
        />
      </div>
      {atCap && (
        <p className="text-xs text-muted-foreground">
          You've reached the {MAX_HERO_IMAGES}-image limit. Remove one to add another.
        </p>
      )}

      {heroImageUrls.length > 1 && (
        <div className="pt-2">
          <label htmlFor="hero-rotation-speed" className="font-bold text-sm block mb-1.5">
            Rotation speed
          </label>
          <select
            id="hero-rotation-speed"
            value={rotationSeconds}
            disabled={busy}
            onChange={(e) => save({ heroRotationSeconds: parseInt(e.target.value, 10) }, "Rotation speed updated")}
            className="rounded-xl border bg-muted/50 px-3 py-2 text-sm font-medium"
          >
            {[3, 4, 5, 6, 7, 8].map((s) => (
              <option key={s} value={s}>
                Every {s} seconds
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground mt-1">How long each image stays before fading to the next.</p>
        </div>
      )}
    </div>
  );
}

function HubImagesManager({
  reunionId,
  reunion,
}: {
  reunionId: number;
  reunion: {
    heroImageUrl?: string | null;
    heroImageUrls?: string[];
    heroRotationSeconds?: number;
    scheduleCardImageUrl?: string | null;
    announcementsCardImageUrl?: string | null;
    pollsCardImageUrl?: string | null;
  };
}) {
  return (
    <div className="bg-card border shadow-sm rounded-3xl p-6 md:p-8 space-y-8">
      <div>
        <h2 className="font-serif text-2xl font-bold">Hub Backgrounds</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Customize the hub page with your own photos. Each section falls back to its
          default look when no image is set.
        </p>
      </div>

      <HeroSlideshowManager
        reunionId={reunionId}
        heroImageUrls={
          (reunion.heroImageUrls?.length ?? 0) > 0
            ? reunion.heroImageUrls!
            : reunion.heroImageUrl
              ? [reunion.heroImageUrl]
              : []
        }
        rotationSeconds={reunion.heroRotationSeconds ?? 3}
      />
      <div className="border-t pt-6">
        <ImageSlot
          reunionId={reunionId}
          field="scheduleCardImageUrl"
          label="Schedule Card"
          hint="Background for the Schedule card. Roughly square images work well (around 1024×768)."
          imageUrl={reunion.scheduleCardImageUrl ?? null}
          previewClassName="h-32 md:h-40"
        />
      </div>
      <div className="border-t pt-6">
        <ImageSlot
          reunionId={reunionId}
          field="announcementsCardImageUrl"
          label="Announcements Card"
          hint="Background for the Announcements card. Roughly square images work well (around 1024×768)."
          imageUrl={reunion.announcementsCardImageUrl ?? null}
          previewClassName="h-32 md:h-40"
        />
      </div>
      <div className="border-t pt-6">
        <ImageSlot
          reunionId={reunionId}
          field="pollsCardImageUrl"
          label="Family Vote Card"
          hint="Background for the Family Vote card. It spans the full width, so a wide image works best (around 2048×768)."
          imageUrl={reunion.pollsCardImageUrl ?? null}
          previewClassName="h-32 md:h-40"
        />
      </div>
    </div>
  );
}

type TierKind = "below" | "range" | "above";

type TierFormRow = {
  kind: TierKind;
  minAge: string;
  maxAge: string;
  amount: string;
};

type FeeFormState = {
  label: string;
  chargeType: "per_person" | "flat";
  isOptional: boolean;
  amount: string;
  tiers: TierFormRow[];
};

const EMPTY_FEE: FeeFormState = {
  label: "",
  chargeType: "per_person",
  isOptional: false,
  amount: "",
  tiers: [],
};

function feeToFormState(fee: ReunionFee): FeeFormState {
  return {
    label: fee.label,
    chargeType: fee.chargeType,
    isOptional: fee.isOptional,
    amount: String(fee.amount),
    tiers: (fee.ageTiers ?? []).map((t) => ({
      kind: (t.maxAge == null ? "above" : t.minAge == null ? "below" : "range") as TierKind,
      minAge: t.minAge != null ? String(t.minAge) : "",
      maxAge: t.maxAge != null ? String(t.maxAge) : "",
      amount: String(t.amount),
    })),
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
    const useTiers = draft.chargeType === "per_person";
    const ageTiers: { minAge: number | null; maxAge: number | null; amount: number }[] = [];
    if (useTiers) {
      for (const row of draft.tiers) {
        const needsMin = row.kind !== "below";
        const needsMax = row.kind !== "above";
        const minAge = needsMin ? Number(row.minAge) : null;
        const maxAge = needsMax ? Number(row.maxAge) : null;
        const tierAmount = Number(row.amount);
        if (
          (needsMin && (row.minAge.trim() === "" || !Number.isInteger(minAge) || minAge! < 0)) ||
          (needsMax && (row.maxAge.trim() === "" || !Number.isInteger(maxAge) || maxAge! < 0))
        ) {
          setError("Each age rule needs a valid age (0 or higher).");
          return null;
        }
        if (minAge != null && maxAge != null && minAge > maxAge) {
          setError("An age range's \"from\" age can't be higher than its \"to\" age.");
          return null;
        }
        if (row.amount.trim() === "" || !Number.isFinite(tierAmount) || tierAmount < 0) {
          setError("Each age rule needs a price ($0 means free).");
          return null;
        }
        ageTiers.push({ minAge, maxAge, amount: tierAmount });
      }
      const sorted = [...ageTiers].sort(
        (a, b) => (a.minAge ?? Number.NEGATIVE_INFINITY) - (b.minAge ?? Number.NEGATIVE_INFINITY),
      );
      for (let i = 1; i < sorted.length; i++) {
        const prevMax = sorted[i - 1].maxAge ?? Number.POSITIVE_INFINITY;
        const curMin = sorted[i].minAge ?? Number.NEGATIVE_INFINITY;
        if (curMin <= prevMax) {
          setError("Age rules can't overlap — adjust them so each age falls in only one.");
          return null;
        }
      }
    }
    return {
      label,
      chargeType: draft.chargeType,
      isOptional: draft.isOptional,
      amount,
      ageTiers: useTiers ? ageTiers : [],
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
  const setTier = (index: number, key: keyof TierFormRow, value: string) =>
    setDraft((prev) => ({
      ...prev,
      tiers: prev.tiers.map((t, i) => (i === index ? { ...t, [key]: value } : t)),
    }));
  const addTier = () =>
    setDraft((prev) => ({
      ...prev,
      tiers: [...prev.tiers, { kind: "range" as TierKind, minAge: "", maxAge: "", amount: "" }],
    }));
  const removeTier = (index: number) =>
    setDraft((prev) => ({ ...prev, tiers: prev.tiers.filter((_, i) => i !== index) }));

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
            {draft.chargeType === "per_person" && draft.tiers.length > 0 ? "Standard amount ($)" : "Amount ($)"}
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
          <div>
            <p className="text-sm font-medium">Age-based pricing</p>
            <p className="text-sm text-muted-foreground">
              Add age ranges that pay a different rate. Anyone outside these ranges (or with no age on
              file) pays the standard amount. Set a range's price to $0 to make it free.
            </p>
          </div>
          {draft.tiers.map((tier, i) => (
            <div key={i} className="flex flex-wrap items-end gap-3 pl-1">
              <div className="w-36">
                <label className="text-sm font-bold block mb-1">Who</label>
                <select
                  className="w-full h-10 rounded-xl border bg-background px-3 text-sm"
                  value={tier.kind}
                  onChange={(e) => setTier(i, "kind", e.target.value as TierKind)}
                >
                  <option value="below">Below an age</option>
                  <option value="range">Age range</option>
                  <option value="above">Above an age</option>
                </select>
              </div>
              {tier.kind !== "below" && (
                <div className="w-24">
                  <label className="text-sm font-bold block mb-1">
                    {tier.kind === "above" ? "Age & up" : "Ages from"}
                  </label>
                  <Input
                    type="number"
                    min={0}
                    className="rounded-xl bg-background"
                    placeholder={tier.kind === "above" ? "e.g. 18" : "e.g. 10"}
                    value={tier.minAge}
                    onChange={(e) => setTier(i, "minAge", e.target.value)}
                  />
                </div>
              )}
              {tier.kind !== "above" && (
                <div className="w-24">
                  <label className="text-sm font-bold block mb-1">
                    {tier.kind === "below" ? "Age & under" : "to"}
                  </label>
                  <Input
                    type="number"
                    min={0}
                    className="rounded-xl bg-background"
                    placeholder={tier.kind === "below" ? "e.g. 9" : "e.g. 17"}
                    value={tier.maxAge}
                    onChange={(e) => setTier(i, "maxAge", e.target.value)}
                  />
                </div>
              )}
              <div className="w-28">
                <label className="text-sm font-bold block mb-1">pay ($)</label>
                <Input
                  type="number"
                  min={0}
                  className="rounded-xl bg-background"
                  placeholder="0 = free"
                  value={tier.amount}
                  onChange={(e) => setTier(i, "amount", e.target.value)}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="rounded-full text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={() => removeTier(i)}
                aria-label="Remove age range"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addTier}
            className="rounded-full font-bold gap-2"
          >
            <Plus className="w-4 h-4" /> Add age range
          </Button>
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
