import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkFrontmatter from "remark-frontmatter";
import { visit } from "unist-util-visit";
import { parseMarkdownDocument } from "./frontmatter";
import { getDictionary, type Locale } from "./i18n";
import { isSupportedImageFile } from "./image-processing";

export type UnresolvedAssetSource = "body" | "frontmatter";

export interface UnresolvedAssetRef {
  /** Full asset key as written in Markdown, e.g. "asset:diagram.png" or "asset:img_1732..." */
  assetKey: string;
  /** Raw suffix after "asset:", e.g. "diagram.png" or "img_1732..." */
  rawName: string;
  /** Human-readable display name shown in placeholders and dialogs */
  displayName: string;
  /** First non-empty alt text seen for this asset key (if any) */
  alt: string;
  /** Number of occurrences in the document */
  occurrences: number;
  /** Whether the reference comes from document body or frontmatter */
  source: UnresolvedAssetSource;
}

export interface ExtractUnresolvedAssetsOptions {
  /** Include unresolved frontmatter asset: references (logo, cover_image, back_cover_image). Default: false. */
  includeFrontmatter?: boolean;
  /** Locale for frontmatter field labels. Default: "ja". */
  locale?: Locale;
}

export interface MatchedAssetDrop {
  file: File;
  assetKeys: string[];
}

export interface AssetDropMatchResult {
  matched: MatchedAssetDrop[];
  unmatchedFiles: File[];
  nonImageFiles: File[];
}

const AUTO_GENERATED_ASSET_ID_REGEX = /^img_\d+(?:_[a-z0-9]+)?$/i;
const SAFE_NUMBER_DIM_REGEX = /^\d+(?:\.\d+)?$/;
const SAFE_UNIT_DIM_REGEX = /^\d+(?:\.\d+)?(?:px|mm|cm|in|pt|em|rem|%)$/i;
const HTML_COMMENT_REGEX = /<!--[\s\S]*?-->/g;
const HTML_IMG_TAG_REGEX = /<img\b([^>]*?)>/gi;
const HTML_ATTR_REGEX =
  /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;

const markdownParser = unified()
  .use(remarkParse)
  .use(remarkFrontmatter, ["yaml"]);

function normalizeFilename(value: string): string {
  return value.normalize("NFC").trim().toLowerCase();
}

function getBasename(pathLike: string): string {
  const normalized = pathLike.replaceAll("\\", "/").replace(/\/+$/, "");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || normalized;
}

function stripExtension(filename: string): string {
  return filename.replace(/\.[^./\\]+$/, "");
}

function hasFileExtension(filename: string): boolean {
  return /\.[^./\\]+$/.test(filename);
}

/**
 * Checks whether an `asset:` key has a non-empty, non-script value in the provided asset map.
 */
export function isAssetKeyResolved(
  assetKey: string,
  assets: Record<string, string>
): boolean {
  const trimmedKey = assetKey.trim();
  if (!trimmedKey.startsWith("asset:")) return false;
  const val = assets[trimmedKey]?.trim();
  if (!val) return false;
  if (/^(?:javascript|vbscript|data\s*:\s*text\/html)\s*:/i.test(val)) {
    return false;
  }
  return true;
}

/**
 * Formats a human-readable display label for an unresolved `asset:` key.
 * For auto-generated keys like `asset:img_1732589123456`, includes the alt text when available.
 */
export function getAssetDisplayName(assetKey: string, alt = ""): string {
  const trimmedKey = assetKey.trim();
  const rawName = trimmedKey.startsWith("asset:")
    ? trimmedKey.slice(6).trim()
    : trimmedKey;
  const trimmedAlt = alt.trim();

  if (!rawName) return trimmedAlt || trimmedKey;
  if (AUTO_GENERATED_ASSET_ID_REGEX.test(rawName) && trimmedAlt) {
    return `${trimmedAlt} (${rawName})`;
  }
  return rawName;
}

/**
 * Validates and normalizes `width` / `height` HTML attributes from `<img>`
 * into a safe CSS length/percentage value for placeholder sizing.
 */
export function sanitizePlaceholderDimension(raw: unknown): string | null {
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw <= 0) return null;
    return `${raw}px`;
  }
  if (typeof raw !== "string") return null;

  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (SAFE_NUMBER_DIM_REGEX.test(trimmed)) {
    const num = Number(trimmed);
    return Number.isFinite(num) && num > 0 ? `${trimmed}px` : null;
  }
  if (SAFE_UNIT_DIM_REGEX.test(trimmed)) {
    const num = Number.parseFloat(trimmed);
    return Number.isFinite(num) && num > 0 ? trimmed.toLowerCase() : null;
  }
  return null;
}

function extractHtmlImgAssetRefs(
  html: string
): Array<{ src: string; alt: string }> {
  const stripped = html.replace(HTML_COMMENT_REGEX, "");
  const results: Array<{ src: string; alt: string }> = [];

  HTML_IMG_TAG_REGEX.lastIndex = 0;
  let tagMatch: RegExpExecArray | null;
  while ((tagMatch = HTML_IMG_TAG_REGEX.exec(stripped)) !== null) {
    const attrStr = tagMatch[1] ?? "";
    let src = "";
    let alt = "";

    HTML_ATTR_REGEX.lastIndex = 0;
    let attrMatch: RegExpExecArray | null;
    while ((attrMatch = HTML_ATTR_REGEX.exec(attrStr)) !== null) {
      const name = attrMatch[1].toLowerCase();
      const value = attrMatch[2] ?? attrMatch[3] ?? attrMatch[4] ?? "";
      if (name === "src") {
        src = value.trim();
      } else if (name === "alt") {
        alt = value.trim();
      }
    }

    if (src.startsWith("asset:")) {
      results.push({ src, alt });
    }
  }

  return results;
}

type MdastNode = {
  type: string;
  url?: string;
  alt?: string | null;
  identifier?: string;
  value?: string;
};

/**
 * Extracts unresolved `asset:` references from a Markdown document.
 * Ignores fenced code blocks, inline code, and HTML comments.
 * Designed to be shared between #25 (preview placeholders / D&D / PDF warning)
 * and future #9 (preflight checks).
 */
export function extractUnresolvedAssetRefs(
  markdown: string,
  assets: Record<string, string>,
  options: ExtractUnresolvedAssetsOptions = {}
): UnresolvedAssetRef[] {
  if (!markdown) return [];

  const refsByKey = new Map<string, UnresolvedAssetRef>();

  const recordRef = (
    rawSrc: string,
    alt: string,
    source: UnresolvedAssetSource
  ) => {
    const assetKey = rawSrc.trim();
    if (!assetKey.startsWith("asset:")) return;
    if (isAssetKeyResolved(assetKey, assets)) return;

    const existing = refsByKey.get(assetKey);
    if (existing) {
      existing.occurrences += 1;
      if (!existing.alt && alt.trim()) {
        existing.alt = alt.trim();
        existing.displayName = getAssetDisplayName(assetKey, existing.alt);
      }
      return;
    }

    const cleanAlt = alt.trim();
    const rawName = assetKey.slice(6).trim();
    refsByKey.set(assetKey, {
      assetKey,
      rawName,
      displayName: getAssetDisplayName(assetKey, cleanAlt),
      alt: cleanAlt,
      occurrences: 1,
      source,
    });
  };

  if (options.includeFrontmatter) {
    const { frontmatter } = parseMarkdownDocument(markdown);
    const pf = getDictionary(options.locale ?? "ja").preflight;
    for (const [label, key] of [
      [pf.frontmatterLogo, frontmatter.logo],
      [pf.frontmatterCoverImage, frontmatter.cover_image],
      [pf.frontmatterBackCoverImage, frontmatter.back_cover_image],
    ] as const) {
      if (key && key.trim().startsWith("asset:")) {
        recordRef(key, label, "frontmatter");
      }
    }
  }

  const tree = markdownParser.parse(markdown);
  const definitions = new Map<string, string>();

  visit(tree, "definition", (node: MdastNode) => {
    if (typeof node.identifier === "string" && typeof node.url === "string") {
      definitions.set(node.identifier.toLowerCase(), node.url);
    }
  });

  visit(tree, (node: MdastNode) => {
    if (node.type === "image" && typeof node.url === "string") {
      recordRef(node.url, node.alt ?? "", "body");
      return;
    }

    if (node.type === "imageReference" && typeof node.identifier === "string") {
      const defUrl = definitions.get(node.identifier.toLowerCase());
      if (defUrl) {
        recordRef(defUrl, node.alt ?? "", "body");
      }
      return;
    }

    if (node.type === "html" && typeof node.value === "string") {
      const htmlImgs = extractHtmlImgAssetRefs(node.value);
      for (const img of htmlImgs) {
        recordRef(img.src, img.alt, "body");
      }
    }
  });

  return Array.from(refsByKey.values());
}

/**
 * Matches dropped files against unresolved `asset:` references by filename.
 * Priority:
 *  1. Exact match against `rawName` or basename of `rawName` (case-insensitive, NFC-normalized)
 *  2. Stem match when `rawName` has no file extension (e.g. `asset:fig1` <-> `fig1.png`)
 *  3. Fallback match against `alt` text (filename or stem) for auto-generated keys (`asset:img_...`)
 */
export function matchDroppedFilesToUnresolvedAssets(
  files: File[],
  unresolved: UnresolvedAssetRef[]
): AssetDropMatchResult {
  const matched: MatchedAssetDrop[] = [];
  const unmatchedFiles: File[] = [];
  const nonImageFiles: File[] = [];

  if (files.length === 0) {
    return { matched, unmatchedFiles, nonImageFiles };
  }

  const indexedRefs = unresolved.map((ref) => {
    const rawNameNorm = normalizeFilename(ref.rawName);
    const baseName = getBasename(ref.rawName);
    const baseNameNorm = normalizeFilename(baseName);
    const altNorm = normalizeFilename(ref.alt);
    return {
      ref,
      rawNameNorm,
      baseNameNorm,
      baseHasExt: hasFileExtension(baseName),
      altNorm,
    };
  });

  const claimedKeys = new Set<string>();

  for (const file of files) {
    if (!isSupportedImageFile(file)) {
      nonImageFiles.push(file);
      continue;
    }

    const fileBase = getBasename(file.name);
    const fileNameNorm = normalizeFilename(fileBase);
    const fileStemNorm = normalizeFilename(stripExtension(fileBase));

    const tier1: string[] = [];
    const tier2: string[] = [];
    const tier3: string[] = [];

    for (const item of indexedRefs) {
      if (claimedKeys.has(item.ref.assetKey)) continue;

      if (
        item.rawNameNorm === fileNameNorm ||
        item.baseNameNorm === fileNameNorm
      ) {
        tier1.push(item.ref.assetKey);
      } else if (
        !item.baseHasExt &&
        item.baseNameNorm &&
        item.baseNameNorm === fileStemNorm
      ) {
        tier2.push(item.ref.assetKey);
      } else if (
        item.altNorm &&
        (item.altNorm === fileNameNorm || item.altNorm === fileStemNorm)
      ) {
        tier3.push(item.ref.assetKey);
      }
    }

    const selectedKeys =
      tier1.length > 0 ? tier1 : tier2.length > 0 ? tier2 : tier3;

    if (selectedKeys.length > 0) {
      for (const key of selectedKeys) {
        claimedKeys.add(key);
      }
      matched.push({ file, assetKeys: selectedKeys });
    } else {
      unmatchedFiles.push(file);
    }
  }

  return { matched, unmatchedFiles, nonImageFiles };
}
