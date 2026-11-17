import yaml from "js-yaml";
import {
  ConfidentialMode,
  CoverOverlayMode,
  DEFAULT_FRONTMATTER,
  DocumentFrontmatter,
  DocumentTheme,
  FontFamilyOption,
  HeadingHighlightMode,
  LogoPosition,
  PageOrientation,
  PageSize,
  ParsedDocument,
  TocDepth,
} from "@/types/document";

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const HEX_COLOR_REGEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const VALID_PAGE_SIZES: PageSize[] = ["A4", "A5", "B5", "Letter"];
const VALID_ORIENTATIONS: PageOrientation[] = ["portrait", "landscape"];
const VALID_THEMES: DocumentTheme[] = ["business", "technical", "minimal"];
const VALID_FONT_FAMILIES: FontFamilyOption[] = ["theme", "sans", "serif"];
const VALID_HEADING_HIGHLIGHT_MODES: HeadingHighlightMode[] = [
  "none",
  "tinted",
  "solid",
];
const VALID_COVER_OVERLAY_MODES: CoverOverlayMode[] = [
  "light-fade",
  "dark-fade",
  "none",
];
const VALID_CONFIDENTIAL_MODES: ConfidentialMode[] = [
  "none",
  "standard",
  "strict",
];
const VALID_LOGO_POSITIONS: LogoPosition[] = [
  "cover-only",
  "header-only",
  "cover-and-header",
];

function asString(value: unknown, fallback: string): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

function asHexColor(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (!trimmed) return "";
  return HEX_COLOR_REGEX.test(trimmed) ? trimmed : fallback;
}

function asClampedNumber(
  value: unknown,
  min: number,
  max: number,
  fallback: number
): number {
  if (value === undefined || value === null || value === "") return fallback;
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  const clamped = Math.min(max, Math.max(min, num));
  return Math.round(clamped * 10) / 10;
}

function normalizeFrontmatter(raw: Record<string, unknown>): DocumentFrontmatter {
  const pageSize = VALID_PAGE_SIZES.includes(raw.page_size as PageSize)
    ? (raw.page_size as PageSize)
    : DEFAULT_FRONTMATTER.page_size;

  const orientation = VALID_ORIENTATIONS.includes(
    raw.orientation as PageOrientation
  )
    ? (raw.orientation as PageOrientation)
    : DEFAULT_FRONTMATTER.orientation;

  const theme = VALID_THEMES.includes(raw.theme as DocumentTheme)
    ? (raw.theme as DocumentTheme)
    : DEFAULT_FRONTMATTER.theme;

  const headingHighlight = VALID_HEADING_HIGHLIGHT_MODES.includes(
    raw.heading_highlight as HeadingHighlightMode
  )
    ? (raw.heading_highlight as HeadingHighlightMode)
    : DEFAULT_FRONTMATTER.heading_highlight;

  const fontFamily = VALID_FONT_FAMILIES.includes(
    raw.font_family as FontFamilyOption
  )
    ? (raw.font_family as FontFamilyOption)
    : DEFAULT_FRONTMATTER.font_family;

  const coverOverlay = VALID_COVER_OVERLAY_MODES.includes(
    raw.cover_overlay as CoverOverlayMode
  )
    ? (raw.cover_overlay as CoverOverlayMode)
    : DEFAULT_FRONTMATTER.cover_overlay;

  const confidentialMode = VALID_CONFIDENTIAL_MODES.includes(
    raw.confidential_mode as ConfidentialMode
  )
    ? (raw.confidential_mode as ConfidentialMode)
    : DEFAULT_FRONTMATTER.confidential_mode;

  const logoPosition = VALID_LOGO_POSITIONS.includes(
    raw.logo_position as LogoPosition
  )
    ? (raw.logo_position as LogoPosition)
    : DEFAULT_FRONTMATTER.logo_position;

  const rawTocDepth = Number(raw.toc_depth);
  const tocDepth: TocDepth =
    rawTocDepth === 1 || rawTocDepth === 2 || rawTocDepth === 3
      ? rawTocDepth
      : DEFAULT_FRONTMATTER.toc_depth;

  return {
    title: asString(raw.title, DEFAULT_FRONTMATTER.title),
    subtitle: asString(raw.subtitle, DEFAULT_FRONTMATTER.subtitle),
    author: asString(raw.author, DEFAULT_FRONTMATTER.author),
    recipient: asString(raw.recipient, DEFAULT_FRONTMATTER.recipient),
    date: asString(raw.date, DEFAULT_FRONTMATTER.date),
    page_size: pageSize,
    orientation,
    cover: asBoolean(raw.cover, DEFAULT_FRONTMATTER.cover),
    cover_image: asString(raw.cover_image, DEFAULT_FRONTMATTER.cover_image),
    cover_overlay: coverOverlay,
    back_cover: asBoolean(raw.back_cover, DEFAULT_FRONTMATTER.back_cover),
    back_cover_image: asString(
      raw.back_cover_image,
      DEFAULT_FRONTMATTER.back_cover_image
    ),
    back_cover_text: asString(
      raw.back_cover_text,
      DEFAULT_FRONTMATTER.back_cover_text
    ),
    toc: asBoolean(raw.toc, DEFAULT_FRONTMATTER.toc),
    toc_depth: tocDepth,
    theme,
    primary_color: asHexColor(
      raw.primary_color,
      DEFAULT_FRONTMATTER.primary_color
    ),
    accent_color: asHexColor(
      raw.accent_color,
      DEFAULT_FRONTMATTER.accent_color
    ),
    heading_highlight: headingHighlight,
    font_family: fontFamily,
    font_size: asClampedNumber(
      raw.font_size,
      9,
      12,
      DEFAULT_FRONTMATTER.font_size
    ),
    line_height: asClampedNumber(
      raw.line_height,
      1.4,
      2.0,
      DEFAULT_FRONTMATTER.line_height
    ),
    confidential_mode: confidentialMode,
    confidential_label: asString(
      raw.confidential_label,
      DEFAULT_FRONTMATTER.confidential_label
    ),
    logo: asString(raw.logo, DEFAULT_FRONTMATTER.logo),
    logo_position: logoPosition,
    header_left: asString(raw.header_left, DEFAULT_FRONTMATTER.header_left),
    header_right: asString(raw.header_right, DEFAULT_FRONTMATTER.header_right),
    footer_left: asString(raw.footer_left, DEFAULT_FRONTMATTER.footer_left),
    footer_right: asString(raw.footer_right, DEFAULT_FRONTMATTER.footer_right),
  };
}

export function parseMarkdownDocument(markdown: string): ParsedDocument {
  const match = markdown.match(FRONTMATTER_REGEX);
  if (!match) {
    return {
      frontmatter: { ...DEFAULT_FRONTMATTER },
      body: markdown,
      rawYaml: "",
      hasFrontmatter: false,
    };
  }

  const rawYaml = match[1];
  const body = markdown.slice(match[0].length);

  try {
    const parsed = yaml.load(rawYaml);
    const record =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    return {
      frontmatter: normalizeFrontmatter(record),
      body,
      rawYaml,
      hasFrontmatter: true,
    };
  } catch {
    return {
      frontmatter: { ...DEFAULT_FRONTMATTER },
      body,
      rawYaml,
      hasFrontmatter: true,
    };
  }
}

export function serializeFrontmatter(frontmatter: DocumentFrontmatter): string {
  const ordered: DocumentFrontmatter = {
    title: frontmatter.title,
    subtitle: frontmatter.subtitle,
    author: frontmatter.author,
    recipient: frontmatter.recipient,
    date: frontmatter.date,
    page_size: frontmatter.page_size,
    orientation: frontmatter.orientation,
    cover: frontmatter.cover,
    cover_image: frontmatter.cover_image,
    cover_overlay: frontmatter.cover_overlay,
    back_cover: frontmatter.back_cover,
    back_cover_image: frontmatter.back_cover_image,
    back_cover_text: frontmatter.back_cover_text,
    toc: frontmatter.toc,
    toc_depth: frontmatter.toc_depth,
    theme: frontmatter.theme,
    primary_color: frontmatter.primary_color,
    accent_color: frontmatter.accent_color,
    heading_highlight: frontmatter.heading_highlight,
    font_family: frontmatter.font_family,
    font_size: frontmatter.font_size,
    line_height: frontmatter.line_height,
    confidential_mode: frontmatter.confidential_mode,
    confidential_label: frontmatter.confidential_label,
    logo: frontmatter.logo,
    logo_position: frontmatter.logo_position,
    header_left: frontmatter.header_left,
    header_right: frontmatter.header_right,
    footer_left: frontmatter.footer_left,
    footer_right: frontmatter.footer_right,
  };

  const dumped = yaml.dump(ordered, {
    lineWidth: -1,
    quotingType: '"',
    forceQuotes: false,
  });

  return `---\n${dumped.trimEnd()}\n---\n`;
}

export function updateMarkdownFrontmatter(
  markdown: string,
  nextFrontmatter: DocumentFrontmatter
): string {
  const parsed = parseMarkdownDocument(markdown);
  const yamlBlock = serializeFrontmatter(nextFrontmatter);
  const cleanBody = parsed.body.replace(/^\r?\n/, "");
  return `${yamlBlock}\n${cleanBody}`;
}
