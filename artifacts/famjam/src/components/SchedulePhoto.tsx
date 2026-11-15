import { useRef, useState } from "react";
import { requestUploadUrl } from "@workspace/api-client-react";
import { Button } from "./ui/button";
import { Label } from "./ui/label";
import { optimizeSchedulePhoto, photoSize, validateSchedulePhoto } from "../lib/optimizeSchedulePhoto";

const photoUrl = (path: string) => `${import.meta.env.BASE_URL}api/storage${path}`;

export function ScheduleThumbnail({ path, title }: { path?: string | null; title: string }) {
  const [failedPath, setFailedPath] = useState<string | null>(null);
  if (!path || failedPath === path) return null;
  return <img src={photoUrl(path)} alt={`${title} photo`} loading="lazy"
    className="h-20 w-20 sm:h-24 sm:w-24 shrink-0 rounded-xl object-cover"
    onError={() => setFailedPath(path)} />;
}

export function SchedulePhotoEditor({ value, onChange, busy, onUploading }: {
  value: string | null; onChange: (path: string | null) => void;
  busy: boolean; onUploading: (uploading: boolean) => void;
}) {
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState("");
  const active = useRef(false);

  const upload = async (file?: File) => {
    if (!file || active.current || busy) return;
    setError("");
    setStatus("");
    try {
      validateSchedulePhoto(file);
    } catch (error) {
      setError((error as Error).message); return;
    }
    active.current = true;
    setUploading(true);
    onUploading(true);
    let phase: "optimization" | "upload" = "optimization";
    try {
      setStatus("Optimizing photo…");
      const result = await optimizeSchedulePhoto(file);
      const uploadFile = result.file;
      const sizes = `Original: ${photoSize(file.size)} → Upload: ${photoSize(uploadFile.size)}.`;
      const explanation = result.outcome === "gif" ? "GIF kept unchanged to preserve animation."
        : result.outcome === "original-smaller" ? "Original kept because it is already smaller; it may exceed 800 pixels."
        : `${Math.round((1 - uploadFile.size / file.size) * 100)}% smaller.`;
      phase = "upload";
      setStatus(`Uploading photo… ${sizes} ${explanation}`);
      const { uploadURL, objectPath } = await requestUploadUrl({ name: uploadFile.name, size: uploadFile.size, contentType: uploadFile.type });
      const response = await fetch(uploadURL, { method: "PUT", headers: { "Content-Type": uploadFile.type }, body: uploadFile });
      if (!response.ok) throw new Error("Upload failed");
      onChange(objectPath);
      setStatus(`Photo uploaded. ${sizes} ${explanation} Save the event to apply it.`);
    } catch {
      setStatus("");
      setError(phase === "optimization"
        ? "Could not optimize this photo. Try a different image or export it as a JPG or PNG. Your previous photo has not changed."
        : "Could not upload the photo. Please try again. Your previous photo has not changed.");
    } finally {
      active.current = false;
      setUploading(false);
      onUploading(false);
    }
  };

  return <div className="space-y-2">
    <Label htmlFor="schedule-photo">Event photo (optional)</Label>
    {value && <div className="flex items-center gap-3">
      <ScheduleThumbnail path={value} title="Selected event" />
      <Button type="button" variant="outline" disabled={busy || uploading} onClick={() => { onChange(null); setError(""); setStatus(""); }}>Remove photo</Button>
    </div>}
    <input id="schedule-photo" type="file" accept="image/jpeg,image/png,image/webp,image/gif"
      className="block w-full min-w-0 text-sm" disabled={busy || uploading}
      onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; void upload(file); }} />
    <p className="text-xs text-muted-foreground">JPG, PNG, WebP, or GIF, up to 10 MB. Photos are optimized to 800 pixels unless the original is smaller in file size. GIFs stay unchanged.</p>
    {status && <p role="status" className="text-xs text-muted-foreground">{status}</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>;
}
