import { useRef, useState } from "react";
import {
  useListReunionImages,
  useCreateReunionImage,
  useDeleteReunionImage,
  useRequestUploadUrl,
  getListReunionImagesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { ImageIcon, Trash2, Upload, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Button } from "./ui/button";

const API_BASE = `${import.meta.env.BASE_URL}api`;

export const imageStorageUrl = (objectPath: string) => `${API_BASE}/storage${objectPath}`;

/**
 * The reunion's image library: every image uploaded anywhere on the site is
 * saved here for reuse. Organizers can browse, upload new images directly
 * into the library, pick one for the spot they're editing, or remove entries
 * (removal only takes the image out of the library — spots already using it
 * keep working).
 */
export function ImageLibraryDialog({
  reunionId,
  open,
  onOpenChange,
  onSelect,
  currentObjectPath,
}: {
  reunionId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the chosen image's objectPath. Omit to browse/manage only. */
  onSelect?: (objectPath: string) => void;
  /** Highlights the image currently in use, if any. */
  currentObjectPath?: string | null;
}) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useListReunionImages(reunionId, {
    query: { enabled: open, queryKey: getListReunionImagesQueryKey(reunionId) },
  });
  const requestUrlMutation = useRequestUploadUrl();
  const createMutation = useCreateReunionImage();
  const deleteMutation = useDeleteReunionImage();

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListReunionImagesQueryKey(reunionId) });

  const uploadIntoLibrary = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("Please keep images under 10MB.");
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
      await createMutation.mutateAsync({
        reunionId,
        data: { fileName: file.name, objectPath },
      });
      invalidate();
    } catch {
      setError("Upload failed. Please try again.");
    } finally {
      setIsUploading(false);
    }
  };

  const removeFromLibrary = (imageId: number) => {
    setError(null);
    deleteMutation.mutate(
      { reunionId, imageId },
      {
        onSuccess: invalidate,
        onError: () => setError("Could not remove that image. Please try again."),
      },
    );
  };

  const images = data?.images ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Image Library</DialogTitle>
          <DialogDescription>
            {onSelect
              ? "Pick a previously uploaded image, or add a new one to the library."
              : "Every image you upload is saved here for reuse across the site."}
          </DialogDescription>
        </DialogHeader>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={uploadIntoLibrary}
        />

        {isLoading ? (
          <p className="text-sm text-muted-foreground py-8 text-center">Loading your images…</p>
        ) : images.length === 0 ? (
          <div className="rounded-2xl border border-dashed bg-muted/30 py-10 flex flex-col items-center gap-2 text-muted-foreground">
            <ImageIcon className="w-8 h-8" />
            <p className="text-sm font-medium">No images in the library yet</p>
            <p className="text-xs">Upload one below — it'll be saved here for reuse.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-[50vh] overflow-y-auto pr-1">
            {images.map((img) => {
              const inUse = currentObjectPath != null && img.objectPath === currentObjectPath;
              return (
                <div
                  key={img.id}
                  className={`group relative rounded-xl overflow-hidden border ${inUse ? "ring-2 ring-primary" : ""}`}
                >
                  <button
                    type="button"
                    className="block w-full"
                    onClick={() => {
                      if (onSelect) {
                        onSelect(img.objectPath);
                        onOpenChange(false);
                      }
                    }}
                    title={onSelect ? `Use ${img.fileName}` : img.fileName}
                  >
                    <img
                      src={imageStorageUrl(img.objectPath)}
                      alt={img.fileName}
                      loading="lazy"
                      className="h-28 w-full object-cover transition group-hover:scale-[1.03]"
                    />
                  </button>
                  {inUse && (
                    <span className="absolute top-1.5 left-1.5 rounded-full bg-primary text-primary-foreground p-1">
                      <Check className="w-3 h-3" />
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => removeFromLibrary(img.id)}
                    className="absolute top-1.5 right-1.5 rounded-full bg-black/60 text-white p-1.5 opacity-0 group-hover:opacity-100 focus:opacity-100 transition"
                    title="Remove from library"
                    aria-label={`Remove ${img.fileName} from library`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                  <p className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent text-white text-[11px] px-2 py-1 truncate pointer-events-none">
                    {img.fileName}
                  </p>
                </div>
              );
            })}
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter className="sm:justify-between gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="rounded-full font-bold gap-2"
          >
            <Upload className="w-4 h-4" />
            {isUploading ? "Uploading…" : "Upload to Library"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} className="rounded-full">
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
