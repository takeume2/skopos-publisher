import { parseMarkdownDocument } from "./frontmatter";
import { formatMessage, getDictionary, type Locale } from "./i18n";
import {
  extractUnresolvedAssetRefs,
  isAssetKeyResolved,
} from "./unresolved-assets";
import type { DocumentFrontmatter } from "@/types/document";

export type PreflightCategory =
  | "incomplete"
  | "unresolved-asset"
  | "metadata"
  | "ng-word";

export interface PreflightIssue {
  id: string;
  category: PreflightCategory;
  label: string;
  message: string;
  /** 1-based line number in the full Markdown document, if applicable */
  line?: number;
  snippet?: string;
}

export interface PreflightSummary {
  cover: boolean;
  backCover: boolean;
  toc: boolean;
  logoStatus: "none" | "configured" | "missing";
  coverImageStatus: "none" | "configured" | "missing";
  confidentialLabel: string | null;
  pageLabel: string;
}

export interface PreflightReport {
  issues: PreflightIssue[];
  summary: PreflightSummary;
}

export interface PreflightOptions {
  ngWords?: string | string[];
  locale?: Locale;
}

const DEFAULT_UNTITLED_TITLES = new Set([
  "無題のドキュメント",
  "新規ドキュメント",
  "Untitled Document",
  "New Document",
]);

const SAMPLE_PLACEHOLDER_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /株式会社サンプル/g, label: "株式会社サンプル" },
  { pattern: /Sample Technology Inc\./gi, label: "Sample Technology Inc." },
  { pattern: /Sample Enterprise Ltd\./gi, label: "Sample Enterprise Ltd." },
];

const INCOMPLETE_ASCII_REGEX =
  /(?<![A-Za-z0-9_])(TBD|TODO|FIXME|XXX)(?![A-Za-z0-9_])/gi;
const INCOMPLETE_JA_REGEX = /(要確認|未記入|（仮）|\(仮\)|【仮】|仮値)/g;

const FENCE_LINE_REGEX = /^[ \t]*(`{3,}|~{3,})/;
const FRONTMATTER_TEXT_KEYS = new Set([
  "title",
  "subtitle",
  "recipient",
  "author",
  "date",
  "back_cover_text",
]);

const MAX_ISSUES_PER_CATEGORY = 50;

/**
 * Splits a newline / comma / Japanese-comma separated NG word list into deduplicated terms.
 */
export function parseNgWordsList(
  input: string | string[] | undefined
): string[] {
  if (!input) return [];
  const rawItems = Array.isArray(input)
    ? input
    : input.split(/[\r\n,、，]+/);

  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of rawItems) {
    const trimmed = item.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }

  return result;
}

function buildSnippet(line: string, maxLength = 56): string {
  const compact = line.trim().replace(/\s+/g, " ");
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength - 1)}…`;
}

/**
 * Masks inline code spans (`...`, ``...``) with spaces so code examples are not falsely flagged.
 */
function maskInlineCode(text: string): string {
  let out = "";
  let i = 0;
  const len = text.length;

  while (i < len) {
    if (text[i] === "`") {
      let tickCount = 1;
      while (i + tickCount < len && text[i + tickCount] === "`") {
        tickCount += 1;
      }
      const closingMarker = "`".repeat(tickCount);
      const closeIdx = text.indexOf(closingMarker, i + tickCount);
      if (closeIdx !== -1) {
        const spanLen = closeIdx + tickCount - i;
        out += " ".repeat(spanLen);
        i = closeIdx + tickCount;
        continue;
      }
      out += "`".repeat(tickCount);
      i += tickCount;
      continue;
    }
    out += text[i];
    i += 1;
  }

  return out;
}

interface ScannedLine {
  /** 1-based line number */
  lineNumber: number;
  /** Original raw line for snippet display */
  rawLine: string;
  /** Cleaned text (HTML comments & inline code masked) for matching */
  text: string;
}

function collectScannableLines(markdown: string): {
  lines: ScannedLine[];
  frontmatterFieldLines: Map<string, number>;
} {
  const rawLines = markdown.split(/\r?\n/);
  const totalLines = rawLines.length;
  const scannable: ScannedLine[] = [];
  const frontmatterFieldLines = new Map<string, number>();

  let bodyStartIdx = 0;

  // Scan YAML frontmatter display-text fields
  if (rawLines[0]?.trim() === "---") {
    let fmEndIdx = -1;
    for (let idx = 1; idx < totalLines; idx++) {
      if (rawLines[idx].trim() === "---") {
        fmEndIdx = idx;
        break;
      }
    }

    if (fmEndIdx > 0) {
      let activeMultilineKey: string | null = null;
      for (let idx = 1; idx < fmEndIdx; idx++) {
        const rawLine = rawLines[idx];
        const keyMatch = rawLine.match(/^([a-zA-Z0-9_]+)\s*:(.*)$/);
        if (keyMatch) {
          const key = keyMatch[1];
          const rest = keyMatch[2] ?? "";
          if (!frontmatterFieldLines.has(key)) {
            frontmatterFieldLines.set(key, idx + 1);
          }
          if (FRONTMATTER_TEXT_KEYS.has(key)) {
            const trimmedRest = rest.trim();
            if (/^[|>][+-]?$/.test(trimmedRest)) {
              activeMultilineKey = key;
            } else {
              activeMultilineKey = null;
              if (trimmedRest) {
                scannable.push({
                  lineNumber: idx + 1,
                  rawLine,
                  text: trimmedRest,
                });
              }
            }
          } else {
            activeMultilineKey = null;
          }
        } else if (activeMultilineKey && /^[ \t]+/.test(rawLine)) {
          scannable.push({
            lineNumber: idx + 1,
            rawLine,
            text: rawLine,
          });
        }
      }
      bodyStartIdx = fmEndIdx + 1;
    }
  }

  // Scan Markdown body while skipping fenced code blocks, HTML comments, and inline code
  let activeFence: { char: string; length: number } | null = null;
  let insideHtmlComment = false;

  for (let idx = bodyStartIdx; idx < totalLines; idx++) {
    const rawLine = rawLines[idx];
    const fenceMatch = rawLine.match(FENCE_LINE_REGEX);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (!activeFence) {
        activeFence = { char: marker[0], length: marker.length };
      } else if (
        marker[0] === activeFence.char &&
        marker.length >= activeFence.length &&
        rawLine.trim().length === marker.length
      ) {
        activeFence = null;
      }
      continue;
    }

    if (activeFence) {
      continue;
    }

    // Mask HTML comments (single-line and multi-line)
    let withoutComments = "";
    let cursor = 0;
    while (cursor < rawLine.length) {
      if (insideHtmlComment) {
        const endIdx = rawLine.indexOf("-->", cursor);
        if (endIdx === -1) {
          withoutComments += " ".repeat(rawLine.length - cursor);
          cursor = rawLine.length;
        } else {
          withoutComments += " ".repeat(endIdx + 3 - cursor);
          cursor = endIdx + 3;
          insideHtmlComment = false;
        }
      } else {
        const startIdx = rawLine.indexOf("<!--", cursor);
        if (startIdx === -1) {
          withoutComments += rawLine.slice(cursor);
          cursor = rawLine.length;
        } else {
          withoutComments += rawLine.slice(cursor, startIdx);
          cursor = startIdx;
          insideHtmlComment = true;
        }
      }
    }

    const cleaned = maskInlineCode(withoutComments);
    if (cleaned.trim()) {
      scannable.push({
        lineNumber: idx + 1,
        rawLine,
        text: cleaned,
      });
    }
  }

  return { lines: scannable, frontmatterFieldLines };
}

function resolveAssetStatus(
  rawValue: string,
  assets: Record<string, string>
): "none" | "configured" | "missing" {
  const trimmed = rawValue.trim();
  if (!trimmed) return "none";
  if (trimmed.startsWith("asset:") && !isAssetKeyResolved(trimmed, assets)) {
    return "missing";
  }
  return "configured";
}

export function buildPreflightSummary(
  frontmatter: DocumentFrontmatter,
  assets: Record<string, string>,
  locale: Locale = "ja"
): PreflightSummary {
  const pf = getDictionary(locale).preflight;
  const orientationLabel =
    frontmatter.orientation === "landscape"
      ? pf.orientationLandscape
      : pf.orientationPortrait;
  const confidentialLabel =
    frontmatter.confidential_mode !== "none"
      ? frontmatter.confidential_label.trim() || "CONFIDENTIAL"
      : null;

  return {
    cover: frontmatter.cover,
    backCover: frontmatter.back_cover,
    toc: frontmatter.toc,
    logoStatus: resolveAssetStatus(frontmatter.logo, assets),
    coverImageStatus: resolveAssetStatus(frontmatter.cover_image, assets),
    confidentialLabel,
    pageLabel: `${frontmatter.page_size} ${orientationLabel}`,
  };
}

/**
 * Runs pre-print preflight checks on a Markdown document.
 * Detects incomplete markers (TBD/TODO/etc.), unresolved frontmatter assets,
 * missing/default metadata or sample leftovers, and user-defined custom NG words.
 */
export function runPreflightCheck(
  markdown: string,
  assets: Record<string, string>,
  options: PreflightOptions = {}
): PreflightReport {
  const locale = options.locale ?? "ja";
  const pf = getDictionary(locale).preflight;
  const { frontmatter } = parseMarkdownDocument(markdown);
  const summary = buildPreflightSummary(frontmatter, assets, locale);
  const issues: PreflightIssue[] = [];
  const { lines, frontmatterFieldLines } = collectScannableLines(markdown);

  let seq = 0;
  const pushIssue = (issue: Omit<PreflightIssue, "id">) => {
    seq += 1;
    issues.push({ id: `preflight-${seq}`, ...issue });
  };

  // 1. Metadata missing / default title checks
  const normalizedTitle = frontmatter.title.replace(/\\n|\r?\n/g, " ").trim();
  if (!normalizedTitle || DEFAULT_UNTITLED_TITLES.has(normalizedTitle)) {
    pushIssue({
      category: "metadata",
      label: pf.titleUnsetLabel,
      message: !normalizedTitle
        ? pf.titleEmptyMessage
        : formatMessage(pf.titleDefaultMessage, { title: normalizedTitle }),
      line: frontmatterFieldLines.get("title") ?? 1,
    });
  }

  if (frontmatter.cover) {
    if (!frontmatter.author.trim()) {
      pushIssue({
        category: "metadata",
        label: pf.authorUnsetLabel,
        message: pf.authorEmptyMessage,
        line: frontmatterFieldLines.get("author") ?? 1,
      });
    }
    if (!frontmatter.date.trim()) {
      pushIssue({
        category: "metadata",
        label: pf.dateUnsetLabel,
        message: pf.dateEmptyMessage,
        line: frontmatterFieldLines.get("date") ?? 1,
      });
    }
  }

  // 2. Unresolved frontmatter assets (logo / cover_image / back_cover_image)
  const frontmatterUnresolved = extractUnresolvedAssetRefs(markdown, assets, {
    includeFrontmatter: true,
    locale,
  }).filter((ref) => ref.source === "frontmatter");

  for (const ref of frontmatterUnresolved) {
    const fieldName =
      ref.alt === pf.frontmatterLogo
        ? "logo"
        : ref.alt === pf.frontmatterCoverImage
          ? "cover_image"
          : "back_cover_image";
    const resolvedLabel = ref.alt || pf.assetConfigFallback;
    pushIssue({
      category: "unresolved-asset",
      label: resolvedLabel,
      message: formatMessage(pf.assetMissingMessage, {
        label: resolvedLabel,
        name: ref.displayName,
      }),
      line: frontmatterFieldLines.get(fieldName) ?? 1,
    });
  }

  // 3. Incomplete markers (TBD / TODO / FIXME / XXX / 要確認 / （仮） etc.)
  let incompleteCount = 0;
  for (const entry of lines) {
    if (incompleteCount >= MAX_ISSUES_PER_CATEGORY) break;
    const foundOnLine = new Set<string>();

    INCOMPLETE_ASCII_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = INCOMPLETE_ASCII_REGEX.exec(entry.text)) !== null) {
      foundOnLine.add(match[1].toUpperCase());
    }

    INCOMPLETE_JA_REGEX.lastIndex = 0;
    while ((match = INCOMPLETE_JA_REGEX.exec(entry.text)) !== null) {
      foundOnLine.add(match[1]);
    }

    for (const token of foundOnLine) {
      if (incompleteCount >= MAX_ISSUES_PER_CATEGORY) break;
      incompleteCount += 1;
      pushIssue({
        category: "incomplete",
        label: token,
        message: formatMessage(pf.incompleteMessage, { token }),
        line: entry.lineNumber,
        snippet: buildSnippet(entry.rawLine),
      });
    }
  }

  // 4. Sample placeholder leftovers
  let sampleCount = 0;
  for (const entry of lines) {
    if (sampleCount >= 10) break;
    for (const sample of SAMPLE_PLACEHOLDER_PATTERNS) {
      sample.pattern.lastIndex = 0;
      if (sample.pattern.test(entry.text)) {
        sampleCount += 1;
        pushIssue({
          category: "metadata",
          label: pf.samplePlaceholderLabel,
          message: formatMessage(pf.samplePlaceholderMessage, {
            label: sample.label,
          }),
          line: entry.lineNumber,
          snippet: buildSnippet(entry.rawLine),
        });
      }
    }
  }

  // 5. User-defined custom NG words
  const ngWords = parseNgWordsList(options.ngWords);
  if (ngWords.length > 0) {
    let ngCount = 0;
    for (const entry of lines) {
      if (ngCount >= MAX_ISSUES_PER_CATEGORY) break;
      const lowerText = entry.text.toLowerCase();
      for (const word of ngWords) {
        if (ngCount >= MAX_ISSUES_PER_CATEGORY) break;
        if (lowerText.includes(word.toLowerCase())) {
          ngCount += 1;
          pushIssue({
            category: "ng-word",
            label: word,
            message: formatMessage(pf.ngWordMessage, { word }),
            line: entry.lineNumber,
            snippet: buildSnippet(entry.rawLine),
          });
        }
      }
    }
  }

  return { issues, summary };
}
