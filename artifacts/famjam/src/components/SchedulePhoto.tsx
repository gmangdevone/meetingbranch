import { useState } from "react";
import { requestUploadUrl } from "@workspace/api-client-react";
import { Button } from "./ui/button";
import { Label } from "./ui/label";

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

  const upload = async (file?: File) => {
    if (!file) return;
    setError("");
    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type)) {
      setError("Choose a JPG, PNG, WebP, or GIF photo."); return;
    }
    if (file.size > 10 * 1024 * 1024 || file.size === 0) {
      setError("Choose a photo smaller than 10 MB that is not empty."); return;
    }
    setUploading(true);
    onUploading(true);
    try {
      const { uploadURL, objectPath } = await requestUploadUrl({ name: file.name, size: file.size, contentType: file.type });
      const response = await fetch(uploadURL, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
      if (!response.ok) throw new Error("Upload failed");
      onChange(objectPath);
    } catch {
      setError("Could not upload the photo. Please try again. Your previous photo has not changed.");
    } finally {
      setUploading(false);
      onUploading(false);
    }
  };

  return <div className="space-y-2">
    <Label htmlFor="schedule-photo">Event photo (optional)</Label>
    {value && <div className="flex items-center gap-3">
      <ScheduleThumbnail path={value} title="Selected event" />
      <Button type="button" variant="outline" disabled={busy || uploading} onClick={() => { onChange(null); setError(""); }}>Remove photo</Button>
    </div>}
    <input id="schedule-photo" type="file" accept="image/jpeg,image/png,image/webp,image/gif"
      className="block w-full min-w-0 text-sm" disabled={busy || uploading}
      onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; void upload(file); }} />
    <p className="text-xs text-muted-foreground">{uploading ? "Uploading photo…" : "JPG, PNG, WebP, or GIF, up to 10 MB. Save the event to apply photo changes."}</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>;
}
