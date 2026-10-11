import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useAdminSaveHomeContent,
  useRequestUploadUrl,
  useCreateReunionImage,
  getAdminListReunionsQueryKey,
  getGetReunionByCodeQueryKey,
  getGetReunionQueryKey,
  getListReunionImagesQueryKey,
  type ReunionSummary,
} from "@workspace/api-client-react";
import { Home, ImageIcon, Upload, Trash2, RotateCcw, Loader2 } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Switch } from "./ui/switch";
import { ImageLibraryDialog } from "./ImageLibraryDialog";
import {
  DEFAULT_WELCOME_HEADING,
  defaultWelcomeDescription,
  draftFrom,
  draftToPayload,
  draftsEqual,
  homeContentFrom,
  validateDraft,
  type HomeContentDraft,
} from "../lib/homeContent";

const API_BASE = `${import.meta.env.BASE_URL}api`;

type Feedback = { kind: "success" | "error" | "info"; message: string } | null;

function errorMessage(err: unknown, fallback: string): string {
  const e = err as { data?: { error?: string }; message?: string };
  return e?.data?.error || e?.message || fallback;
}

export function HomeContentEditor({ reunions, fixedEvent = false }: { reunions: ReunionSummary[]; fixedEvent?: boolean }) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(reunions[0]?.reunion.id ?? null);
  const selected = reunions.find((r) => r.reunion.id === selectedId) ?? null;

  const [draft, setDraft] = useState<HomeContentDraft | null>(null);
  const [baseline, setBaseline] = useState<HomeContentDraft | null>(null);
  const initializedFor = useRef<number | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<Feedback>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Tracks which event is "live" so late upload/save results for a previous event are ignored.
  const activeIdRef = useRef<number | null>(selectedId);
  activeIdRef.current = selectedId;

  const saveMutation = useAdminSaveHomeContent();
  const requestUrlMutation = useRequestUploadUrl();
  const registerImageMutation = useCreateReunionImage();

  // Keep a valid selection if the list changes.
  useEffect(() => {
    if (selectedId == null || !reunions.some((r) => r.reunion.id === selectedId)) {
      setSelectedId(reunions[0]?.reunion.id ?? null);
    }
  }, [reunions, selectedId]);

  // Initialize once per selected event; background refetches never overwrite edits.
  useEffect(() => {
    if (!selected || initializedFor.current === selected.reunion.id) return;
    initializedFor.current = selected.reunion.id;
    const d = draftFrom(homeContentFrom(selected.reunion));
    setDraft(d);
    setBaseline(d);
    setFeedback(null);
    setUploadStatus(null);
    setShowErrors(false);
  }, [selected]);

  const dirty = !!draft && !!baseline && !draftsEqual(draft, baseline);

  const switchEvent = (id: number) => {
    if (id === selectedId) return;
    if (dirty && !confirm("You have unsaved home page changes for this event. Discard them?")) return;
    initializedFor.current = null;
    setDraft(null);
    setBaseline(null);
    setSelectedId(id);
  };

  if (reunions.length === 0) {
    return (
      <div className="bg-card border shadow-sm rounded-3xl p-6 text-sm text-muted-foreground">
        Create an event first to edit its home page content.
      </div>
    );
  }

  const update = (patch: Partial<HomeContentDraft>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d));
    setFeedback(null);
  };

  const errors = draft ? validateDraft(draft) : {};
  const hasErrors = Object.keys(errors).length > 0;
  const busy = saveMutation.isPending || isUploading;

  const handleSave = () => {
    if (!draft || !selected) return;
    setShowErrors(true);
    if (hasErrors) {
      setFeedback({ kind: "error", message: "Please fix the highlighted fields before saving." });
      return;
    }
    const reunionId = selected.reunion.id;
    const code = selected.reunion.code;
    const sent = draft;
    setFeedback({ kind: "info", message: "Saving..." });
    saveMutation.mutate(
      { reunionId, data: draftToPayload(sent) },
      {
        onSuccess: (saved) => {
          queryClient.invalidateQueries({ queryKey: getAdminListReunionsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetReunionByCodeQueryKey(code) });
          queryClient.invalidateQueries({ queryKey: getGetReunionQueryKey(reunionId) });
          if (activeIdRef.current !== reunionId) return;
          const next = draftFrom(saved);
          setBaseline(next);
          // Only replace the form if the admin hasn't kept typing since the save started.
          setDraft((cur) => (cur && draftsEqual(cur, sent) ? next : cur));
          setShowErrors(false);
          setFeedback({ kind: "success", message: "Home page content saved." });
        },
        onError: (err) => {
          if (activeIdRef.current !== reunionId) return;
          setFeedback({ kind: "error", message: errorMessage(err, "Could not save home page content. Please try again.") });
        },
      },
    );
  };

  const onFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !selected) return;
    if (!file.type.startsWith("image/")) {
      setUploadStatus({ kind: "error", message: "Please choose an image file." });
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setUploadStatus({ kind: "error", message: "Please keep the image under 10MB." });
      return;
    }
    const reunionId = selected.reunion.id;
    setIsUploading(true);
    setUploadStatus({ kind: "info", message: "Uploading photo..." });
    try {
      const { uploadURL, objectPath } = await requestUrlMutation.mutateAsync({
        data: { name: file.name, size: file.size, contentType: file.type },
      });
      const putRes = await fetch(uploadURL, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
      if (!putRes.ok) throw new Error(`Upload failed (${putRes.status})`);
      // Must be registered in this event's library: the server only accepts library images.
      await registerImageMutation.mutateAsync({ reunionId, data: { fileName: file.name, objectPath } });
      queryClient.invalidateQueries({ queryKey: getListReunionImagesQueryKey(reunionId) });
      if (activeIdRef.current !== reunionId) return;
      update({ hotelImageUrl: objectPath });
      setUploadStatus({ kind: "success", message: "Photo uploaded. Save to publish it." });
    } catch (err) {
      if (activeIdRef.current === reunionId) {
        setUploadStatus({ kind: "error", message: errorMessage(err, "Upload failed. Please try again.") });
      }
    } finally {
      setIsUploading(false);
    }
  };

  const field = "rounded-xl bg-muted/50";
  const area = "w-full min-h-[110px] rounded-xl border border-input bg-muted/50 px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const err = (msg?: string, id?: string) =>
    showErrors && msg ? <p data-testid={id} className="text-xs font-medium text-destructive mt-1">{msg}</p> : null;

  return (
    <section data-testid="section-home-content-editor">
      <h2 className="font-serif text-2xl font-bold mb-4 flex items-center">
        <Home className="w-6 h-6 mr-2 text-primary" /> Event Home Page
      </h2>
      <div className="bg-card border shadow-sm rounded-3xl p-6 space-y-6">
        {!fixedEvent && <div>
          <label htmlFor="home-content-event" className="font-bold text-sm block mb-1.5">Event</label>
          <select
            id="home-content-event"
            data-testid="select-home-content-event"
            value={selectedId ?? ""}
            disabled={busy}
            onChange={(e) => switchEvent(parseInt(e.target.value, 10))}
            className="w-full rounded-xl border bg-muted/50 px-3 py-2 text-sm font-medium"
          >
            {reunions.map((r) => (
              <option key={r.reunion.id} value={r.reunion.id}>
                {r.reunion.name} ({r.reunion.code})
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground mt-1">Content is saved per event and shown on that event's hub only.</p>
        </div>}

        {!draft || !selected ? (
          <div className="space-y-3" aria-busy="true">
            <div className="h-10 rounded-xl bg-muted animate-pulse" />
            <div className="h-28 rounded-xl bg-muted animate-pulse" />
          </div>
        ) : (
          <>
            <div className="space-y-4 border-t pt-5">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-bold text-lg">Welcome card</h3>
                <Button
                  type="button" variant="ghost" size="sm" disabled={busy}
                  data-testid="button-reset-welcome"
                  onClick={() => update({ welcomeHeading: "", welcomeDescription: "" })}
                  className="rounded-full gap-1.5"
                >
                  <RotateCcw className="w-3.5 h-3.5" /> Reset to default
                </Button>
              </div>
              <div>
                <label htmlFor="welcome-heading" className="font-bold text-sm block mb-1.5">Heading</label>
                <Input
                  id="welcome-heading" data-testid="input-welcome-heading" className={field}
                  placeholder={DEFAULT_WELCOME_HEADING} maxLength={160}
                  value={draft.welcomeHeading} onChange={(e) => update({ welcomeHeading: e.target.value })}
                />
                {err(errors.welcomeHeading, "error-welcome-heading")}
              </div>
              <div>
                <label htmlFor="welcome-description" className="font-bold text-sm block mb-1.5">Description</label>
                <textarea
                  id="welcome-description" data-testid="input-welcome-description" className={area}
                  placeholder={defaultWelcomeDescription(selected.reunion.name, selected.reunion.registrationsOpen)}
                  value={draft.welcomeDescription} onChange={(e) => update({ welcomeDescription: e.target.value })}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Leave blank to use the default text, which updates automatically when registration opens or closes. Blank lines start a new paragraph.
                </p>
                {err(errors.welcomeDescription, "error-welcome-description")}
              </div>
            </div>

            <div className="space-y-4 border-t pt-5">
              <div className="flex items-center justify-between gap-3 rounded-xl border p-4">
                <div>
                  <div className="font-bold">Show hotel section</div>
                  <div className="text-xs text-muted-foreground">Appears above the registration button, even after registration closes.</div>
                </div>
                <Switch
                  data-testid="switch-hotel-enabled" aria-label="Show hotel section"
                  checked={draft.hotelEnabled} disabled={busy}
                  onCheckedChange={(v) => update({ hotelEnabled: v })}
                />
              </div>
              <div>
                <label htmlFor="hotel-description" className="font-bold text-sm block mb-1.5">Hotel description</label>
                <textarea
                  id="hotel-description" data-testid="input-hotel-description" className={area}
                  placeholder="Room block details, group rate, cutoff date..."
                  value={draft.hotelDescription} onChange={(e) => update({ hotelDescription: e.target.value })}
                />
                {err(errors.hotelDescription, "error-hotel-description")}
              </div>
              <div>
                <label htmlFor="hotel-url" className="font-bold text-sm block mb-1.5">Booking link</label>
                <Input
                  id="hotel-url" data-testid="input-hotel-url" type="url" inputMode="url" className={field}
                  placeholder="https://"
                  value={draft.hotelBookingUrl} onChange={(e) => update({ hotelBookingUrl: e.target.value })}
                />
                {err(errors.hotelBookingUrl, "error-hotel-url")}
              </div>
              <div>
                <div className="font-bold text-sm mb-1.5">Hotel photo (optional)</div>
                {draft.hotelImageUrl ? (
                  <img
                    data-testid="img-hotel-preview"
                    src={`${API_BASE}/storage${draft.hotelImageUrl}`}
                    alt="Hotel preview"
                    className="w-full h-36 object-cover rounded-2xl border mb-3"
                  />
                ) : (
                  <p className="text-xs text-muted-foreground mb-3">No photo. The hotel section shows without one.</p>
                )}
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onFileChosen} data-testid="input-hotel-file" />
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" disabled={busy} onClick={() => fileInputRef.current?.click()} className="rounded-full gap-2" data-testid="button-upload-hotel-photo">
                    {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    {isUploading ? "Uploading..." : draft.hotelImageUrl ? "Replace" : "Upload"}
                  </Button>
                  <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setLibraryOpen(true)} className="rounded-full gap-2" data-testid="button-library-hotel-photo">
                    <ImageIcon className="w-4 h-4" /> Library
                  </Button>
                  {draft.hotelImageUrl && (
                    <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => update({ hotelImageUrl: null })} className="rounded-full gap-2 text-destructive hover:text-destructive" data-testid="button-remove-hotel-photo">
                      <Trash2 className="w-4 h-4" /> Remove
                    </Button>
                  )}
                  <ImageLibraryDialog
                    reunionId={selected.reunion.id}
                    open={libraryOpen}
                    onOpenChange={setLibraryOpen}
                    currentObjectPath={draft.hotelImageUrl}
                    onSelect={(objectPath) => update({ hotelImageUrl: objectPath })}
                  />
                </div>
                {uploadStatus && (
                  <p
                    data-testid="status-hotel-upload" role={uploadStatus.kind === "error" ? "alert" : "status"}
                    className={`text-xs font-medium mt-2 ${uploadStatus.kind === "error" ? "text-destructive" : "text-muted-foreground"}`}
                  >
                    {uploadStatus.message}
                  </p>
                )}
              </div>
              <Button
                type="button" variant="ghost" size="sm" disabled={busy}
                data-testid="button-clear-hotel"
                onClick={() => update({ hotelEnabled: false, hotelDescription: "", hotelBookingUrl: "", hotelImageUrl: null })}
                className="rounded-full gap-1.5 text-destructive hover:text-destructive"
              >
                <Trash2 className="w-3.5 h-3.5" /> Clear hotel information
              </Button>
            </div>

            {feedback && (
              <div
                data-testid="status-home-content-save"
                role={feedback.kind === "error" ? "alert" : "status"}
                aria-live="polite"
                className={
                  feedback.kind === "error"
                    ? "rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm font-medium text-destructive"
                    : feedback.kind === "success"
                      ? "rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm font-medium text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-100"
                      : "rounded-xl border bg-muted/50 p-3 text-sm font-medium text-muted-foreground"
                }
              >
                {feedback.message}
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-2">
              <Button type="button" onClick={handleSave} disabled={busy || !dirty} className="rounded-full font-bold flex-1" data-testid="button-save-home-content">
                {saveMutation.isPending ? "Saving..." : dirty ? "Save Home Page" : "Saved"}
              </Button>
              {dirty && (
                <Button type="button" variant="outline" disabled={busy} onClick={() => { setDraft(baseline); setShowErrors(false); setFeedback(null); }} className="rounded-full" data-testid="button-discard-home-content">
                  Discard changes
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
