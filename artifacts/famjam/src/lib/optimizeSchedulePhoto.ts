const MAX_BYTES = 10 * 1024 * 1024;
const MAX_SIDE = 800;
const QUALITY = 0.82;

export interface OptimizedPhoto {
  file: File;
  originalBytes: number;
  outcome: "optimized" | "original-smaller" | "gif";
}

export function validateSchedulePhoto(file: File): void {
  if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type)) {
    throw new Error("Choose a JPG, PNG, WebP, or GIF photo.");
  }
  if (!file.size || file.size > MAX_BYTES) {
    throw new Error("Choose a photo up to 10 MB that is not empty.");
  }
}

async function decode(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; release: () => void }> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
  }
  // Modern browsers apply EXIF orientation when decoding HTML images too.
  const url = URL.createObjectURL(file);
  const image = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error("Image decoding timed out.")), 20000);
      image.onload = () => { clearTimeout(timer); resolve(); };
      image.onerror = () => { clearTimeout(timer); reject(new Error("Image could not be decoded.")); };
      image.src = url;
    });
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, release: () => URL.revokeObjectURL(url) };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  } finally {
    image.onload = image.onerror = null;
  }
}

function encode(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob?.size ? resolve(blob) : reject(new Error("Image encoding failed.")), type, QUALITY);
  });
}

export async function optimizeSchedulePhoto(file: File): Promise<OptimizedPhoto> {
  validateSchedulePhoto(file);
  if (file.type === "image/gif") return { file, originalBytes: file.size, outcome: "gif" };

  const image = await decode(file);
  const canvas = document.createElement("canvas");
  try {
    if (!image.width || !image.height) throw new Error("Image has invalid dimensions.");
    const scale = Math.min(1, MAX_SIDE / Math.max(image.width, image.height));
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image processing is unavailable.");
    context.drawImage(image.source, 0, 0, canvas.width, canvas.height);
    let blob = await encode(canvas, "image/webp");
    if (blob.type !== "image/webp") {
      // Unsupported encoders generally return PNG. Choose JPEG only if opaque.
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let transparent = false;
      for (let i = 3; i < pixels.length; i += 4) {
        if (pixels[i] !== 255) { transparent = true; break; }
      }
      blob = await encode(canvas, transparent ? "image/png" : "image/jpeg");
    }
    if (!["image/webp", "image/jpeg", "image/png"].includes(blob.type)) throw new Error("Unsupported image encoding.");
    if (blob.size >= file.size) return { file, originalBytes: file.size, outcome: "original-smaller" };
    const extension = { "image/webp": "webp", "image/jpeg": "jpg", "image/png": "png" }[blob.type]!;
    const name = `${file.name.replace(/\.[^.]*$/, "") || "schedule-photo"}.${extension}`;
    return {
      file: new File([blob], name, { type: blob.type, lastModified: file.lastModified }),
      originalBytes: file.size,
      outcome: "optimized",
    };
  } finally {
    image.release();
    canvas.width = canvas.height = 0;
  }
}

export function photoSize(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
