import { parseMarkdownDocument } from "./frontmatter";
import { parseSafeYamlRecord } from "./yaml-safe";

export const FALLBACK_PRINT_TITLE = "無題のドキュメント";

export interface ResolvePrintTitleOptions {
  fallbackFilename?: string | null;
}

export function normalizeSingleLineTitle(title: string): string {
  return title
    .replace(
      /([A-Za-z0-9])\s*(?:\\n|\r?\n|<br\s*\/?>)\s*([A-Za-z0-9])/gi,
      "$1 $2"
    )
    .replace(/\s*(?:\\n|\r?\n|<br\s*\/?>)\s*/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractExplicitFrontmatterTitle(
  hasFrontmatter: boolean,
  rawYaml: string
): string | null {
  if (!hasFrontmatter || !rawYaml.trim()) return null;

  const record = parseSafeYamlRecord(rawYaml);
  if (!record || !Object.prototype.hasOwnProperty.call(record, "title")) {
    return null;
  }

  const rawTitle = record.title;
  if (
    typeof rawTitle !== "string" &&
    typeof rawTitle !== "number" &&
    typeof rawTitle !== "boolean"
  ) {
    return null;
  }

  const normalized = normalizeSingleLineTitle(String(rawTitle));
  return normalized || null;
}

function stripInlineMarkdown(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/(\*\*\*|___)(.+?)\1/g, "$2")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(\*|_)(.+?)\1/g, "$2")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractFirstHeading(markdownBody: string): string | null {
  const lines = markdownBody.split(/\r?\n/);
  let activeFenceChar: "`" | "~" | null = null;
  let activeFenceLen = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fenceMatch) {
      const token = fenceMatch[1];
      const char = token[0] as "`" | "~";
      if (!activeFenceChar) {
        activeFenceChar = char;
        activeFenceLen = token.length;
        continue;
      }
      if (
        char === activeFenceChar &&
        token.length >= activeFenceLen &&
        line.trim().length === token.length
      ) {
        activeFenceChar = null;
        activeFenceLen = 0;
        continue;
      }
    }

    if (activeFenceChar) continue;

    const atxMatch = line.match(/^\s{0,3}#{1,6}[ \t]+(.+?)(?:[ \t]+#+[ \t]*)?$/);
    if (atxMatch) {
      const cleaned = stripInlineMarkdown(atxMatch[1]);
      if (cleaned) return cleaned;
      continue;
    }

    const trimmed = line.trim();
    const nextLine = i + 1 < lines.length ? lines[i + 1] : "";
    if (
      trimmed &&
      !trimmed.startsWith(">") &&
      !trimmed.startsWith("<!--") &&
      !/^([-*_]\s*){3,}$/.test(trimmed) &&
      /^\s{0,3}(=+|-+)[ \t]*$/.test(nextLine)
    ) {
      const cleaned = stripInlineMarkdown(trimmed);
      if (cleaned) return cleaned;
    }
  }

  return null;
}

export function normalizeFilenameTitle(
  filename: string | null | undefined
): string | null {
  if (!filename) return null;
  const segments = filename.replaceAll("\\", "/").split("/");
  const baseName = segments[segments.length - 1] || "";
  const withoutExt = baseName.replace(/\.(md|markdown|txt)$/i, "");
  const normalized = normalizeSingleLineTitle(withoutExt);
  return normalized || null;
}

export function resolvePrintDocumentTitle(
  markdown: string,
  options: ResolvePrintTitleOptions = {}
): string {
  const parsed = parseMarkdownDocument(markdown);

  const explicitTitle = extractExplicitFrontmatterTitle(
    parsed.hasFrontmatter,
    parsed.rawYaml
  );
  if (explicitTitle) {
    return explicitTitle;
  }

  const firstHeading = extractFirstHeading(parsed.body);
  if (firstHeading) {
    return firstHeading;
  }

  const filenameTitle = normalizeFilenameTitle(options.fallbackFilename);
  if (filenameTitle) {
    return filenameTitle;
  }

  return FALLBACK_PRINT_TITLE;
}
