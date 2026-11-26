import { parseMarkdownDocument } from "./frontmatter";
import {
  normalizeSingleLineTitle,
  resolvePrintDocumentTitle,
} from "./print-title";
import { parseSafeYamlRecord } from "./yaml-safe";

export const DEFAULT_FILENAME_TEMPLATE = "{date}_{title}_{confidential}";
export const FALLBACK_EXPORT_BASENAME = "document";
export const MAX_EXPORT_BASENAME_LENGTH = 120;

export type ExportArtifactExtension = "pdf" | "md";

export const FILENAME_TEMPLATE_PRESETS = [
  {
    id: "standard",
    label: "標準（日付_タイトル_機密区分）",
    template: "{date}_{title}_{confidential}",
  },
  {
    id: "date-title",
    label: "日付＋タイトル",
    template: "{date}_{title}",
  },
  {
    id: "title-only",
    label: "タイトルのみ",
    template: "{title}",
  },
] as const;

export type FilenamePresetId =
  | (typeof FILENAME_TEMPLATE_PRESETS)[number]["id"]
  | "custom";

export const FILENAME_VARIABLE_CHIPS = [
  "{date}",
  "{title}",
  "{confidential}",
  "{author}",
  "{recipient}",
] as const;

export interface BuildExportFilenameOptions {
  template?: string;
  fallbackFilename?: string | null;
  now?: Date;
}

const INVALID_FILENAME_CHARS_REGEX = /[\\/:*?"<>|]/g;
const CONTROL_CHARS_REGEX = /[\u0000-\u001F\u007F]/g;
const WINDOWS_RESERVED_NAME_REGEX = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
const SEPARATOR_ONLY_REGEX = /^[_\-\s.]+$/;
const VARIABLE_TOKEN_REGEX = /\{(date|title|confidential|author|recipient)\}/gi;

type TemplateToken =
  | { type: "literal"; text: string }
  | { type: "value"; text: string }
  | { type: "empty" };

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (year < 1000 || year > 9999) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day
  );
}

export function formatDateYYYYMMDD(date: Date): string {
  return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(
    date.getDate()
  )}`;
}

export function normalizeDateForFilename(
  rawDate: unknown,
  fallbackDate?: Date
): string {
  if (rawDate instanceof Date && !Number.isNaN(rawDate.getTime())) {
    return `${rawDate.getUTCFullYear()}${pad2(
      rawDate.getUTCMonth() + 1
    )}${pad2(rawDate.getUTCDate())}`;
  }

  if (typeof rawDate === "string" || typeof rawDate === "number") {
    const trimmed = String(rawDate).trim();
    if (trimmed) {
      const delimited = trimmed.match(
        /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:$|[\sT])/
      );
      if (delimited) {
        const y = Number(delimited[1]);
        const m = Number(delimited[2]);
        const d = Number(delimited[3]);
        if (isValidCalendarDate(y, m, d)) {
          return `${y}${pad2(m)}${pad2(d)}`;
        }
      }

      const jp = trimmed.match(/^(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/);
      if (jp) {
        const y = Number(jp[1]);
        const m = Number(jp[2]);
        const d = Number(jp[3]);
        if (isValidCalendarDate(y, m, d)) {
          return `${y}${pad2(m)}${pad2(d)}`;
        }
      }

      const compact = trimmed.match(/^(\d{4})(\d{2})(\d{2})$/);
      if (compact) {
        const y = Number(compact[1]);
        const m = Number(compact[2]);
        const d = Number(compact[3]);
        if (isValidCalendarDate(y, m, d)) {
          return `${y}${pad2(m)}${pad2(d)}`;
        }
      }
    }
  }

  return formatDateYYYYMMDD(fallbackDate ?? new Date());
}

function extractRawFrontmatterRecord(
  hasFrontmatter: boolean,
  rawYaml: string
): Record<string, unknown> {
  if (!hasFrontmatter || !rawYaml.trim()) return {};
  return parseSafeYamlRecord(rawYaml) ?? {};
}

function extractExplicitStringField(
  record: Record<string, unknown>,
  key: string
): string {
  if (!Object.prototype.hasOwnProperty.call(record, key)) return "";
  const val = record[key];
  if (
    typeof val !== "string" &&
    typeof val !== "number" &&
    typeof val !== "boolean"
  ) {
    return "";
  }
  return normalizeSingleLineTitle(String(val));
}

export function sanitizeFilenameSegment(raw: string): string {
  return raw
    .replace(CONTROL_CHARS_REGEX, "")
    .replace(INVALID_FILENAME_CHARS_REGEX, "_")
    .replace(/\s+/g, " ")
    .trim();
}

export function sanitizeFilenameBasename(
  raw: string,
  maxLength = MAX_EXPORT_BASENAME_LENGTH
): string {
  let cleaned = sanitizeFilenameSegment(raw)
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .trim();

  if (!cleaned) {
    return FALLBACK_EXPORT_BASENAME;
  }

  const chars = Array.from(cleaned);
  if (chars.length > maxLength) {
    cleaned = chars
      .slice(0, maxLength)
      .join("")
      .replace(/[.\s_-]+$/, "")
      .trim();
  }

  if (!cleaned) {
    return FALLBACK_EXPORT_BASENAME;
  }

  if (WINDOWS_RESERVED_NAME_REGEX.test(cleaned)) {
    cleaned = `${cleaned}_doc`;
  }

  return cleaned;
}

function isSeparatorLiteral(token: TemplateToken | undefined): boolean {
  return Boolean(
    token && token.type === "literal" && SEPARATOR_ONLY_REGEX.test(token.text)
  );
}

function renderFilenameTemplate(
  template: string,
  variables: Record<string, string>
): string {
  const tokens: TemplateToken[] = [];
  VARIABLE_TOKEN_REGEX.lastIndex = 0;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = VARIABLE_TOKEN_REGEX.exec(template)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({
        type: "literal",
        text: template.slice(lastIndex, match.index),
      });
    }

    const key = match[1].toLowerCase();
    const sanitized = sanitizeFilenameSegment(variables[key] ?? "");
    if (sanitized) {
      tokens.push({ type: "value", text: sanitized });
    } else {
      tokens.push({ type: "empty" });
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < template.length) {
    tokens.push({
      type: "literal",
      text: template.slice(lastIndex),
    });
  }

  // Collapse separators adjacent to omitted (empty) variable tokens
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type !== "empty") continue;

      const prev = tokens[i - 1];
      const next = tokens[i + 1];
      const prevIsSep = isSeparatorLiteral(prev);
      const nextIsSep = isSeparatorLiteral(next);

      if (prevIsSep && nextIsSep) {
        tokens.splice(i, 2);
        changed = true;
        break;
      }
      if (nextIsSep && (!prev || prev.type !== "value")) {
        tokens.splice(i, 2);
        changed = true;
        break;
      }
      if (prevIsSep && (!next || next.type !== "value")) {
        tokens.splice(i - 1, 2);
        changed = true;
        break;
      }
      tokens.splice(i, 1);
      changed = true;
      break;
    }
  }

  return tokens
    .map((token) => (token.type === "empty" ? "" : token.text))
    .join("");
}

export function resolveFilenamePresetId(template: string): FilenamePresetId {
  const trimmed = template.trim();
  const matched = FILENAME_TEMPLATE_PRESETS.find(
    (preset) => preset.template === trimmed
  );
  return matched ? matched.id : "custom";
}

export function buildExportFilenameBasename(
  markdown: string,
  options: BuildExportFilenameOptions = {}
): string {
  const parsed = parseMarkdownDocument(markdown);
  const rawRecord = extractRawFrontmatterRecord(
    parsed.hasFrontmatter,
    parsed.rawYaml
  );

  const dateValue = normalizeDateForFilename(rawRecord.date, options.now);
  const titleValue = resolvePrintDocumentTitle(markdown, {
    fallbackFilename: options.fallbackFilename,
  });
  const confidentialValue =
    parsed.frontmatter.confidential_mode !== "none"
      ? normalizeSingleLineTitle(
          parsed.frontmatter.confidential_label || "CONFIDENTIAL"
        ) || "CONFIDENTIAL"
      : "";
  const authorValue = extractExplicitStringField(rawRecord, "author");
  const recipientValue = extractExplicitStringField(rawRecord, "recipient");

  const rawTemplate =
    options.template !== undefined && options.template.trim() !== ""
      ? options.template
      : DEFAULT_FILENAME_TEMPLATE;

  const rendered = renderFilenameTemplate(rawTemplate, {
    date: dateValue,
    title: titleValue,
    confidential: confidentialValue,
    author: authorValue,
    recipient: recipientValue,
  });

  return sanitizeFilenameBasename(rendered);
}

export function buildExportFilename(
  markdown: string,
  extension: ExportArtifactExtension,
  options: BuildExportFilenameOptions = {}
): string {
  const basename = buildExportFilenameBasename(markdown, options);
  return `${basename}.${extension}`;
}
