import { formatMessage, getDictionary, type Locale } from "./i18n";
import { sanitizeImageUrl } from "./markdown";

export type ImageUploadPurpose = "inline" | "logo" | "cover" | "shared";

export interface ImageLimitSpec {
  maxFileBytes: number;
  maxDimension: number;
  label: string;
}

export const IMAGE_LIMITS: Record<ImageUploadPurpose, ImageLimitSpec> = {
  logo: {
    maxFileBytes: 5 * 1024 * 1024,
    maxDimension: 800,
    label: "ロゴ画像",
  },
  inline: {
    maxFileBytes: 10 * 1024 * 1024,
    maxDimension: 1600,
    label: "インライン画像",
  },
  shared: {
    maxFileBytes: 10 * 1024 * 1024,
    maxDimension: 1600,
    label: "共通画像",
  },
  cover: {
    maxFileBytes: 10 * 1024 * 1024,
    maxDimension: 2000,
    label: "背景画像",
  },
};

export const MAX_SVG_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_FOLDER_TOTAL_IMAGE_BYTES = 30 * 1024 * 1024;
export const DEFAULT_RESIZE_QUALITY = 0.85;

const IMAGE_EXTENSION_REGEX = /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i;

export type ImageValidationErrorCode =
  | "UNSUPPORTED_TYPE"
  | "FILE_TOO_LARGE"
  | "UNSAFE_SVG"
  | "READ_FAILED";

export class ImageValidationError extends Error {
  readonly code: ImageValidationErrorCode;

  constructor(code: ImageValidationErrorCode, message: string) {
    super(message);
    this.name = "ImageValidationError";
    this.code = code;
  }
}

export interface ProcessedImageResult {
  dataUrl: string;
  resized: boolean;
  originalWidth?: number;
  originalHeight?: number;
  width?: number;
  height?: number;
  originalBytes: number;
  finalBytes: number;
}

export interface ImageCanvasLike {
  width: number;
  height: number;
  getContext(contextId: "2d"): {
    drawImage: (
      image: CanvasImageSource,
      dx: number,
      dy: number,
      dWidth: number,
      dHeight: number
    ) => void;
  } | null;
  toDataURL(type?: string, quality?: number): string;
}

export interface ImageBitmapLike {
  readonly width: number;
  readonly height: number;
  close(): void;
}

export interface LoadedImageLike {
  naturalWidth: number;
  naturalHeight: number;
  source: CanvasImageSource;
  cleanup?: () => void;
}

export interface ProcessImageOptions {
  readAsDataUrl?: (file: File) => Promise<string>;
  loadImage?: (dataUrl: string) => Promise<LoadedImageLike | null>;
  createImageBitmap?: (source: Blob) => Promise<ImageBitmapLike>;
  createCanvas?: () => ImageCanvasLike | null;
  quality?: number;
  locale?: Locale;
}

export function formatImageLimitMb(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return Number.isInteger(mb) ? `${mb} MB` : `${mb.toFixed(1)} MB`;
}

export function isSvgImageFile(file: Pick<File, "name" | "type">): boolean {
  return (
    file.type.toLowerCase() === "image/svg+xml" || /\.svg$/i.test(file.name)
  );
}

export function isGifImageFile(file: Pick<File, "name" | "type">): boolean {
  return file.type.toLowerCase() === "image/gif" || /\.gif$/i.test(file.name);
}

export function isSupportedImageFile(
  file: Pick<File, "name" | "type">
): boolean {
  return (
    file.type.toLowerCase().startsWith("image/") ||
    IMAGE_EXTENSION_REGEX.test(file.name)
  );
}

export function computeResizedDimensions(
  width: number,
  height: number,
  maxDimension: number
): { width: number; height: number; resized: boolean } {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    maxDimension <= 0
  ) {
    return { width, height, resized: false };
  }

  const longest = Math.max(width, height);
  if (longest <= maxDimension) {
    return { width, height, resized: false };
  }

  const scale = maxDimension / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    resized: true,
  };
}

function getLocalizedPurposeLabel(
  purpose: ImageUploadPurpose,
  locale: Locale
): string {
  const dict = getDictionary(locale).imageError;
  switch (purpose) {
    case "logo":
      return dict.purposeLogo;
    case "inline":
      return dict.purposeInline;
    case "shared":
      return dict.purposeShared;
    case "cover":
      return dict.purposeCover;
  }
}

export function validateImageFile(
  file: Pick<File, "name" | "type" | "size">,
  purpose: ImageUploadPurpose,
  locale: Locale = "ja"
): void {
  const errDict = getDictionary(locale).imageError;
  if (!isSupportedImageFile(file)) {
    throw new ImageValidationError(
      "UNSUPPORTED_TYPE",
      formatMessage(errDict.unsupportedType, { name: file.name })
    );
  }

  const isSvg = isSvgImageFile(file);
  const limit = IMAGE_LIMITS[purpose];
  const maxBytes = isSvg
    ? Math.min(MAX_SVG_FILE_BYTES, limit.maxFileBytes)
    : limit.maxFileBytes;

  if (file.size > maxBytes) {
    const actualMb = (file.size / (1024 * 1024)).toFixed(1);
    const limitLabel = formatImageLimitMb(maxBytes);
    const kindLabel = isSvg
      ? errDict.svgLabel
      : getLocalizedPurposeLabel(purpose, locale);
    throw new ImageValidationError(
      "FILE_TOO_LARGE",
      formatMessage(errDict.fileTooLarge, {
        name: file.name,
        actual: actualMb,
        kind: kindLabel,
        limit: limitLabel,
      })
    );
  }
}

function defaultReadFileAsDataUrl(
  file: File,
  locale: Locale = "ja"
): Promise<string> {
  const errDict = getDictionary(locale).imageError;
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(
          new ImageValidationError(
            "READ_FAILED",
            formatMessage(errDict.readFailed, { name: file.name })
          )
        );
      }
    };
    reader.onerror = () =>
      reject(
        new ImageValidationError(
          "READ_FAILED",
          formatMessage(errDict.readFailed, { name: file.name })
        )
      );
    reader.readAsDataURL(file);
  });
}

function defaultLoadImage(dataUrl: string): Promise<LoadedImageLike | null> {
  if (typeof Image === "undefined") {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        resolve({
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
          source: img,
        });
      } else {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

function defaultCreateCanvas(): ImageCanvasLike | null {
  if (typeof document === "undefined") return null;
  return document.createElement("canvas") as unknown as ImageCanvasLike;
}

async function loadImageForResize(
  file: File,
  dataUrl: string,
  options: ProcessImageOptions
): Promise<LoadedImageLike | null> {
  const fallbackLoadImage = options.loadImage ?? defaultLoadImage;

  // 既存テスト・呼び出し元が loadImage のみを明示指定した場合はそのまま優先する
  if (options.loadImage && !options.createImageBitmap) {
    return fallbackLoadImage(dataUrl);
  }

  const createBitmap =
    options.createImageBitmap ??
    (typeof globalThis.createImageBitmap === "function"
      ? (blob: Blob) => globalThis.createImageBitmap(blob)
      : undefined);

  if (createBitmap) {
    try {
      const bitmap = await createBitmap(file);
      if (bitmap.width > 0 && bitmap.height > 0) {
        return {
          naturalWidth: bitmap.width,
          naturalHeight: bitmap.height,
          source: bitmap as unknown as CanvasImageSource,
          cleanup: () => bitmap.close(),
        };
      }
      bitmap.close();
    } catch {
      // createImageBitmap 非対応形式・失敗時は従来の Image 経路へフォールバック
    }
  }

  return fallbackLoadImage(dataUrl);
}

function resolveResizeOutputMime(file: Pick<File, "name" | "type">): string {
  const mime = file.type.toLowerCase();
  if (mime === "image/jpeg" || /\.jpe?g$/i.test(file.name)) {
    return "image/jpeg";
  }
  if (mime === "image/webp" || /\.webp$/i.test(file.name)) {
    return "image/webp";
  }
  return "image/png";
}

function estimateDataUrlBytes(dataUrl: string): number {
  return new Blob([dataUrl]).size;
}

/**
 * Validates an uploaded image file against DoS size limits and automatically
 * downscales oversized raster images via HTMLCanvasElement while preserving aspect ratio.
 */
export async function processUploadedImageFile(
  file: File,
  purpose: ImageUploadPurpose,
  options: ProcessImageOptions = {}
): Promise<ProcessedImageResult> {
  const locale = options.locale ?? "ja";
  validateImageFile(file, purpose, locale);

  const readAsDataUrl =
    options.readAsDataUrl ?? ((f: File) => defaultReadFileAsDataUrl(f, locale));
  const rawDataUrl = await readAsDataUrl(file);
  const originalBytes = file.size || estimateDataUrlBytes(rawDataUrl);

  // SVG: skip raster Canvas resizing, enforce strict SVG sanitization
  if (isSvgImageFile(file)) {
    const sanitized = sanitizeImageUrl(rawDataUrl);
    if (!sanitized) {
      throw new ImageValidationError(
        "UNSAFE_SVG",
        formatMessage(getDictionary(locale).imageError.unsafeSvg, {
          name: file.name,
        })
      );
    }
    return {
      dataUrl: sanitized,
      resized: false,
      originalBytes,
      finalBytes: estimateDataUrlBytes(sanitized),
    };
  }

  // GIF: preserve potential animations (already guarded by file size limit)
  if (isGifImageFile(file)) {
    return {
      dataUrl: rawDataUrl,
      resized: false,
      originalBytes,
      finalBytes: estimateDataUrlBytes(rawDataUrl),
    };
  }

  const createCanvas = options.createCanvas ?? defaultCreateCanvas;
  const quality = options.quality ?? DEFAULT_RESIZE_QUALITY;
  const { maxDimension } = IMAGE_LIMITS[purpose];

  const loaded = await loadImageForResize(file, rawDataUrl, options);
  if (!loaded) {
    return {
      dataUrl: rawDataUrl,
      resized: false,
      originalBytes,
      finalBytes: estimateDataUrlBytes(rawDataUrl),
    };
  }

  try {
    const target = computeResizedDimensions(
      loaded.naturalWidth,
      loaded.naturalHeight,
      maxDimension
    );

    if (!target.resized) {
      return {
        dataUrl: rawDataUrl,
        resized: false,
        originalWidth: loaded.naturalWidth,
        originalHeight: loaded.naturalHeight,
        width: loaded.naturalWidth,
        height: loaded.naturalHeight,
        originalBytes,
        finalBytes: estimateDataUrlBytes(rawDataUrl),
      };
    }

    const canvas = createCanvas();
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) {
      return {
        dataUrl: rawDataUrl,
        resized: false,
        originalWidth: loaded.naturalWidth,
        originalHeight: loaded.naturalHeight,
        width: loaded.naturalWidth,
        height: loaded.naturalHeight,
        originalBytes,
        finalBytes: estimateDataUrlBytes(rawDataUrl),
      };
    }

    try {
      canvas.width = target.width;
      canvas.height = target.height;
      ctx.drawImage(loaded.source, 0, 0, target.width, target.height);

      const outputMime = resolveResizeOutputMime(file);
      const resizedDataUrl =
        outputMime === "image/png"
          ? canvas.toDataURL("image/png")
          : canvas.toDataURL(outputMime, quality);

      if (!resizedDataUrl || !resizedDataUrl.startsWith("data:image/")) {
        return {
          dataUrl: rawDataUrl,
          resized: false,
          originalWidth: loaded.naturalWidth,
          originalHeight: loaded.naturalHeight,
          width: loaded.naturalWidth,
          height: loaded.naturalHeight,
          originalBytes,
          finalBytes: estimateDataUrlBytes(rawDataUrl),
        };
      }

      return {
        dataUrl: resizedDataUrl,
        resized: true,
        originalWidth: loaded.naturalWidth,
        originalHeight: loaded.naturalHeight,
        width: target.width,
        height: target.height,
        originalBytes,
        finalBytes: estimateDataUrlBytes(resizedDataUrl),
      };
    } catch {
      return {
        dataUrl: rawDataUrl,
        resized: false,
        originalWidth: loaded.naturalWidth,
        originalHeight: loaded.naturalHeight,
        width: loaded.naturalWidth,
        height: loaded.naturalHeight,
        originalBytes,
        finalBytes: estimateDataUrlBytes(rawDataUrl),
      };
    }
  } finally {
    loaded.cleanup?.();
  }
}
