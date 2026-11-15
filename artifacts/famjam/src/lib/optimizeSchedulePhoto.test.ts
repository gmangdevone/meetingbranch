import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { optimizeSchedulePhoto } from "./optimizeSchedulePhoto";

let close: ReturnType<typeof vi.fn>;
let draw: ReturnType<typeof vi.fn>;
let encode: ReturnType<typeof vi.spyOn>;
const file = (type = "image/jpeg", size = 1000) => new File([new Uint8Array(size)], "family.jpg", { type });

beforeEach(() => {
  close = vi.fn();
  draw = vi.fn();
  vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 1600, height: 1200, close })));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: draw, getImageData: () => ({ data: new Uint8ClampedArray([0, 0, 0, 255]) }),
  } as unknown as CanvasRenderingContext2D);
  encode = vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (callback, type) {
    callback(new Blob([new Uint8Array(100)], { type }));
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("schedule photo optimization", () => {
  it("resizes proportionally, requests EXIF orientation and matches output metadata", async () => {
    const original = file();
    const result = await optimizeSchedulePhoto(original);
    expect(createImageBitmap).toHaveBeenCalledWith(original, { imageOrientation: "from-image" });
    expect(draw).toHaveBeenCalledWith(expect.anything(), 0, 0, 800, 600);
    expect(result).toMatchObject({ originalBytes: 1000, outcome: "optimized" });
    expect(result.file.name).toBe("family.webp");
    expect(result.file.type).toBe("image/webp");
    expect(result.file.size).toBe(100);
    expect(close).toHaveBeenCalledOnce();
    expect(encode.mock.instances[0].width).toBe(0);
  });

  it("never upscales smaller images", async () => {
    vi.mocked(createImageBitmap).mockResolvedValue({ width: 200, height: 400, close } as unknown as ImageBitmap);
    await optimizeSchedulePhoto(file());
    expect(draw).toHaveBeenCalledWith(expect.anything(), 0, 0, 200, 400);
  });

  it("keeps the original bytes when encoding would be larger", async () => {
    const original = file("image/png", 50);
    const result = await optimizeSchedulePhoto(original);
    expect(result.file).toBe(original);
    expect(result.outcome).toBe("original-smaller");
  });

  it("passes GIFs through without decoding or changing animation", async () => {
    const original = file("image/gif");
    expect(await optimizeSchedulePhoto(original)).toEqual({ file: original, originalBytes: 1000, outcome: "gif" });
    expect(createImageBitmap).not.toHaveBeenCalled();
  });

  it.each([true, false])("uses a transparency-safe fallback when WebP is unavailable (alpha=%s)", async transparent => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: draw, getImageData: () => ({ data: new Uint8ClampedArray([0, 0, 0, transparent ? 0 : 255]) }),
    } as unknown as CanvasRenderingContext2D);
    encode.mockImplementation((callback: BlobCallback, type?: string) => callback(new Blob([new Uint8Array(100)], {
      type: type === "image/webp" ? "image/png" : type,
    })));
    const result = await optimizeSchedulePhoto(file("image/png"));
    expect(result.file.type).toBe(transparent ? "image/png" : "image/jpeg");
    expect(result.file.name).toBe(transparent ? "family.png" : "family.jpg");
  });

  it("rejects decoding failures without uploading the original silently", async () => {
    vi.mocked(createImageBitmap).mockRejectedValue(new Error("corrupt"));
    await expect(optimizeSchedulePhoto(file())).rejects.toThrow("corrupt");
    expect(encode).not.toHaveBeenCalled();
  });

  it("releases resources when encoding fails", async () => {
    encode.mockImplementation((callback: BlobCallback) => callback(null));
    await expect(optimizeSchedulePhoto(file())).rejects.toThrow("encoding failed");
    expect(close).toHaveBeenCalledOnce();
  });

  it.each([file("image/svg+xml"), file("image/jpeg", 0), file("image/png", 10 * 1024 * 1024 + 1)])("validates before decoding", async original => {
    await expect(optimizeSchedulePhoto(original)).rejects.toThrow();
    expect(createImageBitmap).not.toHaveBeenCalled();
  });
});
