export interface MinimalDataTransferItem {
  kind: string;
  type: string;
  getAsFile?: () => File | null;
}

export interface MinimalDataTransfer {
  files?: ArrayLike<File> | null;
  types?: ArrayLike<string> | null;
  items?: ArrayLike<MinimalDataTransferItem> | null;
}

export type EditorDropClassification =
  | { kind: "text-drag" }
  | { kind: "image"; file: File }
  | { kind: "rejected-file"; fileNames: string[] };

export interface DropPositionView {
  posAtCoords?: (coords: { x: number; y: number }) => number | null;
}

export interface MinimalPointerCoords {
  clientX?: number;
  clientY?: number;
}

export function resolveDropInsertPosition(
  view: DropPositionView | null | undefined,
  coords: MinimalPointerCoords | null | undefined
): number | null {
  if (
    !view ||
    typeof view.posAtCoords !== "function" ||
    !coords ||
    typeof coords.clientX !== "number" ||
    typeof coords.clientY !== "number" ||
    !Number.isFinite(coords.clientX) ||
    !Number.isFinite(coords.clientY)
  ) {
    return null;
  }

  const pos = view.posAtCoords({ x: coords.clientX, y: coords.clientY });
  return typeof pos === "number" && Number.isFinite(pos) && pos >= 0
    ? pos
    : null;
}

export function isFileDragEvent(
  dataTransfer: MinimalDataTransfer | null | undefined
): boolean {
  if (!dataTransfer) return false;
  if (dataTransfer.files && dataTransfer.files.length > 0) {
    return true;
  }
  if (
    dataTransfer.types &&
    Array.from(dataTransfer.types).includes("Files")
  ) {
    return true;
  }
  if (
    dataTransfer.items &&
    Array.from(dataTransfer.items).some((item) => item.kind === "file")
  ) {
    return true;
  }
  return false;
}

export function extractDropImageFile(
  dataTransfer: MinimalDataTransfer | null | undefined
): File | null {
  if (!dataTransfer) return null;

  if (dataTransfer.files && dataTransfer.files.length > 0) {
    const matched = Array.from(dataTransfer.files).find((f) =>
      f.type.startsWith("image/")
    );
    if (matched) return matched;
  }

  if (dataTransfer.items && dataTransfer.items.length > 0) {
    for (const item of Array.from(dataTransfer.items)) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const file = item.getAsFile?.();
        if (file) return file;
      }
    }
  }

  return null;
}

export function classifyEditorDrop(
  dataTransfer: MinimalDataTransfer | null | undefined
): EditorDropClassification {
  if (!isFileDragEvent(dataTransfer)) {
    return { kind: "text-drag" };
  }

  const imageFile = extractDropImageFile(dataTransfer);
  if (imageFile) {
    return { kind: "image", file: imageFile };
  }

  const fileNames = dataTransfer?.files
    ? Array.from(dataTransfer.files)
        .map((f) => f.name)
        .filter(Boolean)
    : [];

  return { kind: "rejected-file", fileNames };
}
