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

export interface LoadedImageLike {
  naturalWidth: number;
  naturalHeight: number;
  source: CanvasImageSource;
}

export interface ProcessImageOptions {
  readAsDataUrl?: (file: File) => Promise<string>;
  loadImage?: (dataUrl: string) => Promise<LoadedImageLike | null>;
  createCanvas?: () => ImageCanvasLike | null;
  quality?: number;
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

export function validateImageFile(
  file: Pick<File, "name" | "type" | "size">,
  purpose: ImageUploadPurpose
): void {
  if (!isSupportedImageFile(file)) {
    throw new ImageValidationError(
      "UNSUPPORTED_TYPE",
      `「${file.name}」はサポート対象外のファイル形式です（画像ファイルのみ読み込み可能です）。`
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
    const kindLabel = isSvg ? "SVG 画像" : limit.label;
    throw new ImageValidationError(
      "FILE_TOO_LARGE",
      `「${file.name}」（${actualMb} MB）は ${kindLabel} の上限（${limitLabel}）を超えているため読み込めません。`
    );
  }
}

function defaultReadFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(
          new ImageValidationError(
            "READ_FAILED",
            `「${file.name}」の読み込みに失敗しました。`
          )
        );
      }
    };
    reader.onerror = () =>
      reject(
        new ImageValidationError(
          "READ_FAILED",
          `「${file.name}」の読み込みに失敗しました。`
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
  validateImageFile(file, purpose);

  const readAsDataUrl = options.readAsDataUrl ?? defaultReadFileAsDataUrl;
  const rawDataUrl = await readAsDataUrl(file);
  const originalBytes = file.size || estimateDataUrlBytes(rawDataUrl);

  // SVG: skip raster Canvas resizing, enforce strict SVG sanitization
  if (isSvgImageFile(file)) {
    const sanitized = sanitizeImageUrl(rawDataUrl);
    if (!sanitized) {
      throw new ImageValidationError(
        "UNSAFE_SVG",
        `「${file.name}」には安全でない SVG 要素（スクリプト等）が含まれているため読み込めません。`
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

  const loadImage = options.loadImage ?? defaultLoadImage;
  const createCanvas = options.createCanvas ?? defaultCreateCanvas;
  const quality = options.quality ?? DEFAULT_RESIZE_QUALITY;
  const { maxDimension } = IMAGE_LIMITS[purpose];

  const loaded = await loadImage(rawDataUrl);
  if (!loaded) {
    return {
      dataUrl: rawDataUrl,
      resized: false,
      originalBytes,
      finalBytes: estimateDataUrlBytes(rawDataUrl),
    };
  }

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
}
