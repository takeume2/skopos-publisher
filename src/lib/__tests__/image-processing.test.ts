import { describe, it, expect, vi } from "vitest";
import {
  IMAGE_LIMITS,
  ImageValidationError,
  MAX_SVG_FILE_BYTES,
  computeResizedDimensions,
  processUploadedImageFile,
  validateImageFile,
} from "@/lib/image-processing";

function createSizedFile(name: string, type: string, sizeBytes: number): File {
  const file = new File(["x"], name, { type });
  Object.defineProperty(file, "size", { value: sizeBytes });
  return file;
}

describe("image-processing (#16)", () => {
  it("computes resized dimensions preserving aspect ratio only when exceeding maxDimension", () => {
    expect(computeResizedDimensions(4000, 2000, 1600)).toEqual({
      width: 1600,
      height: 800,
      resized: true,
    });
    expect(computeResizedDimensions(1200, 2400, 800)).toEqual({
      width: 400,
      height: 800,
      resized: true,
    });
    expect(computeResizedDimensions(1200, 900, 1600)).toEqual({
      width: 1200,
      height: 900,
      resized: false,
    });
  });

  it("enforces file size limits per upload purpose and rejects non-image files", () => {
    const oversizedLogo = createSizedFile(
      "logo.png",
      "image/png",
      IMAGE_LIMITS.logo.maxFileBytes + 1
    );
    expect(() => validateImageFile(oversizedLogo, "logo")).toThrowError(
      ImageValidationError
    );

    const okInline = createSizedFile(
      "photo.jpg",
      "image/jpeg",
      IMAGE_LIMITS.inline.maxFileBytes
    );
    expect(() => validateImageFile(okInline, "inline")).not.toThrow();

    const oversizedInline = createSizedFile(
      "huge.jpg",
      "image/jpeg",
      IMAGE_LIMITS.inline.maxFileBytes + 1024
    );
    expect(() => validateImageFile(oversizedInline, "inline")).toThrow(
      /上限（10 MB）を超えている/
    );

    const oversizedSvg = createSizedFile(
      "vector.svg",
      "image/svg+xml",
      MAX_SVG_FILE_BYTES + 1
    );
    expect(() => validateImageFile(oversizedSvg, "inline")).toThrow(
      /SVG 画像 の上限（2 MB）/
    );

    const nonImage = createSizedFile("doc.pdf", "application/pdf", 1024);
    expect(() => validateImageFile(nonImage, "inline")).toThrow(
      /サポート対象外のファイル形式/
    );
  });

  it("downscales oversized raster images via Canvas while keeping small images untouched", async () => {
    const drawImage = vi.fn();
    const toDataURL = vi.fn(() => "data:image/jpeg;base64,RESIZED_DATA");
    const mockCanvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage }),
      toDataURL,
    };

    const bigJpeg = createSizedFile("photo.jpg", "image/jpeg", 2 * 1024 * 1024);
    const resizedResult = await processUploadedImageFile(bigJpeg, "inline", {
      readAsDataUrl: async () => "data:image/jpeg;base64,RAW_HUGE",
      loadImage: async () => ({
        naturalWidth: 3200,
        naturalHeight: 2400,
        source: {} as CanvasImageSource,
      }),
      createCanvas: () => mockCanvas,
    });

    expect(resizedResult.resized).toBe(true);
    expect(resizedResult.width).toBe(1600);
    expect(resizedResult.height).toBe(1200);
    expect(resizedResult.dataUrl).toBe("data:image/jpeg;base64,RESIZED_DATA");
    expect(mockCanvas.width).toBe(1600);
    expect(mockCanvas.height).toBe(1200);
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1600, 1200);
    expect(toDataURL).toHaveBeenCalledWith("image/jpeg", 0.85);

    // 上限内の解像度はリサイズせずに元データを維持
    const smallPng = createSizedFile("icon.png", "image/png", 50 * 1024);
    const untouched = await processUploadedImageFile(smallPng, "logo", {
      readAsDataUrl: async () => "data:image/png;base64,SMALL",
      loadImage: async () => ({
        naturalWidth: 400,
        naturalHeight: 200,
        source: {} as CanvasImageSource,
      }),
      createCanvas: () => mockCanvas,
    });
    expect(untouched.resized).toBe(false);
    expect(untouched.dataUrl).toBe("data:image/png;base64,SMALL");
  });

  it("preserves safe SVG/GIF without Canvas resizing and blocks unsafe SVG payloads", async () => {
    const safeSvg = createSizedFile("mark.svg", "image/svg+xml", 2048);
    const safeSvgUrl =
      "data:image/svg+xml;base64," +
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><circle r="5"/></svg>').toString("base64");
    const svgRes = await processUploadedImageFile(safeSvg, "logo", {
      readAsDataUrl: async () => safeSvgUrl,
    });
    expect(svgRes.resized).toBe(false);
    expect(svgRes.dataUrl).toBe(safeSvgUrl);

    const maliciousSvg = createSizedFile("xss.svg", "image/svg+xml", 2048);
    const maliciousSvgUrl =
      "data:image/svg+xml;base64," +
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString("base64");
    await expect(
      processUploadedImageFile(maliciousSvg, "logo", {
        readAsDataUrl: async () => maliciousSvgUrl,
      })
    ).rejects.toThrow(/安全でない SVG/);

    const gif = createSizedFile("anim.gif", "image/gif", 500 * 1024);
    const gifRes = await processUploadedImageFile(gif, "inline", {
      readAsDataUrl: async () => "data:image/gif;base64,GIFDATA",
    });
    expect(gifRes.resized).toBe(false);
    expect(gifRes.dataUrl).toBe("data:image/gif;base64,GIFDATA");
  });

  it("prefers createImageBitmap for off-thread decoding and always closes the bitmap (#55)", async () => {
    const drawImage = vi.fn();
    const toDataURL = vi.fn(() => "data:image/webp;base64,RESIZED_BITMAP");
    const mockCanvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage }),
      toDataURL,
    };

    const bigClose = vi.fn();
    const bigBitmap = { width: 3200, height: 1600, close: bigClose };
    const loadImageSpy = vi.fn();
    const bigWebp = createSizedFile("hero.webp", "image/webp", 1024 * 1024);

    const resized = await processUploadedImageFile(bigWebp, "inline", {
      readAsDataUrl: async () => "data:image/webp;base64,RAW_BIG",
      createImageBitmap: async () => bigBitmap,
      loadImage: loadImageSpy,
      createCanvas: () => mockCanvas,
    });

    expect(resized.resized).toBe(true);
    expect(resized.width).toBe(1600);
    expect(resized.height).toBe(800);
    expect(resized.dataUrl).toBe("data:image/webp;base64,RESIZED_BITMAP");
    expect(drawImage).toHaveBeenCalledWith(bigBitmap, 0, 0, 1600, 800);
    expect(bigClose).toHaveBeenCalledTimes(1);
    expect(loadImageSpy).not.toHaveBeenCalled();

    // リサイズ不要な画像でも bitmap.close() が確実に呼ばれる
    const smallClose = vi.fn();
    const smallBitmap = { width: 400, height: 300, close: smallClose };
    const smallPng = createSizedFile("thumb.png", "image/png", 64 * 1024);

    const untouched = await processUploadedImageFile(smallPng, "logo", {
      readAsDataUrl: async () => "data:image/png;base64,SMALL_PNG",
      createImageBitmap: async () => smallBitmap,
      createCanvas: () => mockCanvas,
    });

    expect(untouched.resized).toBe(false);
    expect(untouched.dataUrl).toBe("data:image/png;base64,SMALL_PNG");
    expect(smallClose).toHaveBeenCalledTimes(1);
  });

  it("falls back to loadImage when createImageBitmap rejects (#55)", async () => {
    const drawImage = vi.fn();
    const toDataURL = vi.fn(() => "data:image/png;base64,FALLBACK_RESIZED");
    const mockCanvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage }),
      toDataURL,
    };

    const cleanupSpy = vi.fn();
    const fallbackSource = {} as CanvasImageSource;
    const loadImage = vi.fn(async () => ({
      naturalWidth: 1600,
      naturalHeight: 1600,
      source: fallbackSource,
      cleanup: cleanupSpy,
    }));

    const logoPng = createSizedFile("brand.png", "image/png", 512 * 1024);
    const result = await processUploadedImageFile(logoPng, "logo", {
      readAsDataUrl: async () => "data:image/png;base64,RAW_LOGO",
      createImageBitmap: async () => {
        throw new Error("decode failed");
      },
      loadImage,
      createCanvas: () => mockCanvas,
    });

    expect(loadImage).toHaveBeenCalledWith("data:image/png;base64,RAW_LOGO");
    expect(result.resized).toBe(true);
    expect(result.width).toBe(800);
    expect(result.height).toBe(800);
    expect(result.dataUrl).toBe("data:image/png;base64,FALLBACK_RESIZED");
    expect(drawImage).toHaveBeenCalledWith(fallbackSource, 0, 0, 800, 800);
    expect(cleanupSpy).toHaveBeenCalledTimes(1);
  });
});
