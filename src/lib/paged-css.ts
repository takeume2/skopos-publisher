import type {
  DocumentFrontmatter,
  DocumentTheme,
  FontFamilyOption,
  PageOrientation,
  PageSize,
} from "@/types/document";
import { sanitizeImageUrl } from "./markdown";

const PAGE_SIZE_METRICS: Record<PageSize, { width: string; height: string }> = {
  A4: { width: "210mm", height: "297mm" },
  A5: { width: "148mm", height: "210mm" },
  B5: { width: "182mm", height: "257mm" },
  Letter: { width: "8.5in", height: "11in" },
};

const FONT_STACK_SANS =
  '"Noto Sans JP", "Hiragino Kaku Gothic ProN", "Yu Gothic", system-ui, sans-serif';
const FONT_STACK_SERIF =
  '"Noto Serif JP", "Hiragino Mincho ProN", "Yu Mincho", Georgia, serif';

function getPageDimensions(
  pageSize: PageSize,
  orientation: PageOrientation
): { cssSize: string; pageHeight: string } {
  const base = PAGE_SIZE_METRICS[pageSize];
  const pageHeight = orientation === "landscape" ? base.width : base.height;
  return {
    cssSize: `${base.width} ${base.height} ${orientation}`,
    pageHeight,
  };
}

function escapeCssString(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\r", " ")
    .replaceAll("\n", " ")
    .replace(/<\/style/gi, "<\\/style");
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function normalizeSingleLineTitle(title: string): string {
  return title
    .replace(/([A-Za-z0-9])\s*(?:\\n|\r?\n|<br\s*\/?>)\s*([A-Za-z0-9])/gi, "$1 $2")
    .replace(/\s*(?:\\n|\r?\n|<br\s*\/?>)\s*/gi, "");
}

function formatMarginContent(
  template: string,
  fm: DocumentFrontmatter
): string {
  if (!template || !template.trim()) {
    return "none";
  }

  const resolved = template
    .replaceAll("{title}", normalizeSingleLineTitle(fm.title))
    .replaceAll("{author}", fm.author)
    .replaceAll("{recipient}", fm.recipient)
    .replaceAll("{date}", fm.date)
    .replaceAll("{page}", "__MD_PAGE__")
    .replaceAll("{pages}", "__MD_PAGES__");

  return `"${escapeCssString(resolved)}"`;
}

function buildWatermarkSvgDataUri(label: string): string {
  const text = label.trim() || "CONFIDENTIAL";
  const fontSize = Math.max(
    26,
    Math.min(64, Math.floor(420 / Math.max(1, text.length)))
  );

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600"><g transform="translate(300,300) rotate(-35)"><text x="0" y="0" text-anchor="middle" dominant-baseline="central" font-family="sans-serif" font-size="${fontSize}" font-weight="700" letter-spacing="4" fill="#64748b" fill-opacity="0.14">${escapeXml(text)}</text></g></svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function getThemeVariables(
  theme: DocumentTheme,
  primaryOverride: string,
  accentOverride: string,
  fontFamilyOverride: FontFamilyOption
): string {
  let baseVars = "";

  switch (theme) {
    case "technical":
      baseVars = `
        --doc-primary: #0f172a;
        --doc-accent: #0284c7;
        --doc-accent-soft: #e0f2fe;
        --doc-text: #1e293b;
        --doc-muted: #64748b;
        --doc-border: #cbd5e1;
        --doc-bg-subtle: #f8fafc;
        --doc-cover-bg: #0f172a;
        --doc-cover-text: #f8fafc;
        --doc-cover-accent: #38bdf8;
        --doc-font-sans: "IBM Plex Sans JP", "Noto Sans JP", "Hiragino Sans", "Yu Gothic UI", system-ui, sans-serif;
        --doc-font-heading: "IBM Plex Sans JP", "Noto Sans JP", "Hiragino Sans", system-ui, sans-serif;
        --doc-font-mono: "JetBrains Mono", "Fira Code", "Consolas", monospace;
      `;
      break;
    case "minimal":
      baseVars = `
        --doc-primary: #18181b;
        --doc-accent: #52525b;
        --doc-accent-soft: #f4f4f5;
        --doc-text: #27272a;
        --doc-muted: #71717a;
        --doc-border: #e4e4e7;
        --doc-bg-subtle: #fafafa;
        --doc-cover-bg: #ffffff;
        --doc-cover-text: #18181b;
        --doc-cover-accent: #18181b;
        --doc-font-sans: ${FONT_STACK_SERIF};
        --doc-font-heading: "Noto Sans JP", "Hiragino Sans", system-ui, sans-serif;
        --doc-font-mono: "JetBrains Mono", "Consolas", monospace;
      `;
      break;
    case "business":
    default:
      baseVars = `
        --doc-primary: #1e3a5f;
        --doc-accent: #2563eb;
        --doc-accent-soft: #eff6ff;
        --doc-text: #1f2937;
        --doc-muted: #6b7280;
        --doc-border: #d1d5db;
        --doc-bg-subtle: #f9fafb;
        --doc-cover-bg: #1e3a5f;
        --doc-cover-text: #ffffff;
        --doc-cover-accent: #60a5fa;
        --doc-font-sans: ${FONT_STACK_SANS};
        --doc-font-heading: ${FONT_STACK_SANS};
        --doc-font-mono: "JetBrains Mono", "Consolas", monospace;
      `;
      break;
  }

  const overrides: string[] = [];

  if (primaryOverride) {
    overrides.push(`--doc-primary: ${primaryOverride};`);
    if (theme === "business" || theme === "technical") {
      overrides.push(`--doc-cover-bg: ${primaryOverride};`);
    } else if (theme === "minimal") {
      overrides.push(`--doc-cover-text: ${primaryOverride};`);
    }
  }

  if (accentOverride) {
    overrides.push(`--doc-accent: ${accentOverride};`);
    overrides.push(`--doc-cover-accent: ${accentOverride};`);
  }

  if (fontFamilyOverride === "sans") {
    overrides.push(`--doc-font-sans: ${FONT_STACK_SANS};`);
    overrides.push(`--doc-font-heading: ${FONT_STACK_SANS};`);
  } else if (fontFamilyOverride === "serif") {
    overrides.push(`--doc-font-sans: ${FONT_STACK_SERIF};`);
    overrides.push(`--doc-font-heading: ${FONT_STACK_SERIF};`);
  }

  return `${baseVars}\n${overrides.join("\n")}`;
}

export interface PagedMediaImageAssets {
  logoUrl?: string;
  coverImageUrl?: string;
  backCoverImageUrl?: string;
}

export function buildPagedMediaCss(
  fm: DocumentFrontmatter,
  imageAssets: PagedMediaImageAssets = {}
): string {
  const { cssSize, pageHeight } = getPageDimensions(
    fm.page_size,
    fm.orientation
  );
  const fullPageHeight = `calc(${pageHeight} - 0.3mm)`;
  const maxImageHeight = `calc(${pageHeight} - 52mm)`;

  const isConfidential =
    fm.confidential_mode === "standard" || fm.confidential_mode === "strict";
  const label = fm.confidential_label.trim() || "CONFIDENTIAL";

  const rawHeaderRight = fm.header_right.trim();
  const effectiveHeaderRight = isConfidential
    ? rawHeaderRight
      ? `${label} | ${rawHeaderRight}`
      : label
    : fm.header_right;

  const rawFooterLeft = fm.footer_left.trim();
  const effectiveFooterLeft = isConfidential
    ? rawFooterLeft
      ? `${rawFooterLeft} | ${label}`
      : label
    : fm.footer_left;

  const headerLeft = formatMarginContent(fm.header_left, fm);
  const headerRight = formatMarginContent(effectiveHeaderRight, fm);
  const footerLeft = formatMarginContent(effectiveFooterLeft, fm);
  const footerRight = formatMarginContent(fm.footer_right, fm);

  const logoSrc = sanitizeImageUrl(
    imageAssets.logoUrl || (fm.logo.startsWith("asset:") ? "" : fm.logo)
  );
  const hasCoverBg = Boolean(
    sanitizeImageUrl(
      imageAssets.coverImageUrl ||
        (fm.cover_image && !fm.cover_image.startsWith("asset:")
          ? fm.cover_image
          : "")
    )
  );
  const hasBackCoverBg = Boolean(
    sanitizeImageUrl(
      imageAssets.backCoverImageUrl ||
        (fm.back_cover_image && !fm.back_cover_image.startsWith("asset:")
          ? fm.back_cover_image
          : "")
    )
  );

  const showHeaderLogo =
    Boolean(logoSrc) &&
    (fm.logo_position === "header-only" ||
      fm.logo_position === "cover-and-header");

  const sharedTopBoxStyle = `
    height: 11mm;
    border-bottom: 0.5pt solid var(--doc-border);
    padding-bottom: 2.5mm;
    margin-bottom: 4mm;
    vertical-align: bottom;
  `;

  const topCenterRule = showHeaderLogo
    ? `
      @top-center {
        content: "";
        background-image: url("${escapeCssString(logoSrc)}");
        background-repeat: no-repeat;
        background-position: center bottom;
        background-origin: content-box;
        background-size: contain;
        width: 28mm;
        ${sharedTopBoxStyle}
      }
    `
    : `@top-center { content: none; }`;

  const strictWatermarkRule =
    fm.confidential_mode === "strict"
      ? `
        background-image: url("${buildWatermarkSvgDataUri(label)}");
        background-repeat: no-repeat;
        background-position: center;
        background-size: contain;
      `
      : "";

  const coverImageCss = `
      .doc-cover.has-cover-image {
        position: relative;
        background-color: transparent !important;
        border-left: none !important;
        padding: 24mm 22mm;
      }
      .doc-cover .cover-bg-img {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
        z-index: 0;
      }
      .doc-cover.has-cover-image .cover-inner {
        position: relative;
        z-index: 2;
        height: 100%;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        gap: 0;
      }
      .doc-cover.has-cover-image .cover-top {
        min-height: 14mm;
        display: flex;
        align-items: flex-start;
      }
      .doc-cover.has-cover-image .cover-center {
        display: flex;
        flex-direction: column;
        gap: 5mm;
        max-width: 78%;
        margin: auto 0;
        padding-top: 8mm;
      }
      .doc-cover.has-cover-image .cover-accent-bar {
        display: none;
      }
      .doc-cover.has-cover-image .cover-title {
        font-size: 22pt;
      }
      .doc-cover.has-cover-image .cover-recipient {
        margin-top: 6mm;
      }
      .doc-cover.has-cover-image .cover-meta {
        margin-top: 0;
        padding-top: 5mm;
        max-width: 65%;
      }
      .doc-cover.has-cover-image.cover-overlay-light-fade .cover-title {
        color: var(--doc-primary);
      }
      .doc-cover.has-cover-image.cover-overlay-light-fade .cover-subtitle {
        color: #334155;
        opacity: 1;
      }
      .doc-cover.has-cover-image.cover-overlay-light-fade .cover-recipient {
        color: #0f172a;
        opacity: 1;
      }
      .doc-cover.has-cover-image.cover-overlay-light-fade .cover-author {
        color: #1e293b;
        opacity: 1;
      }
      .doc-cover.has-cover-image.cover-overlay-light-fade .cover-date {
        color: #475569;
        opacity: 1;
      }
      .doc-cover.has-cover-image.cover-overlay-light-fade .cover-meta {
        border-top: 0.5pt solid rgba(15, 23, 42, 0.16);
      }
      .doc-cover.has-cover-image.cover-overlay-dark-fade .cover-title,
      .doc-cover.has-cover-image.cover-overlay-none .cover-title {
        color: #ffffff;
        text-shadow: 0 1px 4px rgba(0, 0, 0, 0.28);
      }
      .doc-cover.has-cover-image.cover-overlay-dark-fade .cover-subtitle,
      .doc-cover.has-cover-image.cover-overlay-dark-fade .cover-recipient,
      .doc-cover.has-cover-image.cover-overlay-dark-fade .cover-author,
      .doc-cover.has-cover-image.cover-overlay-dark-fade .cover-date,
      .doc-cover.has-cover-image.cover-overlay-none .cover-subtitle,
      .doc-cover.has-cover-image.cover-overlay-none .cover-recipient,
      .doc-cover.has-cover-image.cover-overlay-none .cover-author,
      .doc-cover.has-cover-image.cover-overlay-none .cover-date {
        color: #f8fafc;
        opacity: 0.95;
        text-shadow: 0 1px 3px rgba(0, 0, 0, 0.30);
      }
      .doc-cover.has-cover-image.cover-overlay-dark-fade .cover-meta,
      .doc-cover.has-cover-image.cover-overlay-none .cover-meta {
        border-top: 0.5pt solid rgba(255, 255, 255, 0.26);
      }
    `;

  const backCoverImageCss = `
      .doc-backcover.has-backcover-image {
        position: relative;
        background-color: transparent !important;
      }
      .doc-backcover .backcover-bg-img {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
        z-index: 0;
      }
      .doc-backcover .backcover-bg-overlay {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(255, 255, 255, 0.82);
        z-index: 1;
      }
      .doc-backcover.has-backcover-image .backcover-inner {
        position: relative;
        z-index: 2;
      }
    `;

  return `
    :root {
      ${getThemeVariables(
        fm.theme,
        fm.primary_color,
        fm.accent_color,
        fm.font_family
      )}
    }

    @page {
      size: ${cssSize};
      margin: 22mm 18mm 22mm 18mm;
      ${strictWatermarkRule}

      @top-left {
        content: ${headerLeft};
        font-family: var(--doc-font-sans);
        font-size: 8.5pt;
        color: var(--doc-muted);
        ${sharedTopBoxStyle}
      }

      ${topCenterRule}

      @top-right {
        content: ${headerRight};
        font-family: var(--doc-font-sans);
        font-size: 8.5pt;
        color: var(--doc-muted);
        ${sharedTopBoxStyle}
      }

      @bottom-left {
        content: ${footerLeft};
        font-family: var(--doc-font-sans);
        font-size: 8.5pt;
        color: var(--doc-muted);
        border-top: 0.5pt solid var(--doc-border);
        padding-top: 2.5mm;
        margin-top: 4mm;
        vertical-align: top;
      }

      @bottom-center {
        content: none;
      }

      @bottom-right {
        content: ${footerRight};
        font-family: var(--doc-font-sans);
        font-size: 8.5pt;
        font-variant-numeric: tabular-nums;
        color: var(--doc-muted);
        border-top: 0.5pt solid var(--doc-border);
        padding-top: 2.5mm;
        margin-top: 4mm;
        vertical-align: top;
      }
    }

    @page cover {
      margin: 0;
      background-color: ${hasCoverBg ? "transparent" : "var(--doc-cover-bg)"};
      background-image: none !important;
      @top-left { content: none; }
      @top-center { content: none; }
      @top-right { content: none; }
      @bottom-left { content: none; }
      @bottom-center { content: none; }
      @bottom-right { content: none; }
    }

    @page toc {
      ${strictWatermarkRule}
      @top-left { content: none; border: none; background-image: none; }
      @top-center { content: none; border: none; background-image: none; }
      @top-right { content: none; border: none; background-image: none; }
      @bottom-left { content: none; border: none; background-image: none; }
      @bottom-center { content: none; border: none; background-image: none; }
      @bottom-right { content: none; border: none; background-image: none; }
    }

    /* Paged.js 0.4.x の hasContent 継承による目次ページのヘッダー／フッター罫線・ロゴ漏れを抑止 */
    .pagedjs_toc_page .pagedjs_margin-top > .pagedjs_margin,
    .pagedjs_toc_page .pagedjs_margin-bottom > .pagedjs_margin {
      visibility: hidden !important;
      border: none !important;
      background-image: none !important;
    }

    @page chapter {
      margin: 0;
      background-color: var(--doc-bg-subtle);
      background-image: none !important;
      @top-left { content: none; }
      @top-center { content: none; }
      @top-right { content: none; }
      @bottom-left { content: none; }
      @bottom-center { content: none; }
      @bottom-right { content: none; }
    }

    @page backcover {
      margin: 0;
      background-color: ${hasBackCoverBg ? "transparent" : "var(--doc-bg-subtle)"};
      background-image: none !important;
      @top-left { content: none; }
      @top-center { content: none; }
      @top-right { content: none; }
      @bottom-left { content: none; }
      @bottom-center { content: none; }
      @bottom-right { content: none; }
    }

    .doc-root {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
      font-family: var(--doc-font-sans);
      font-size: ${fm.font_size}pt;
      line-height: ${fm.line_height};
      color: var(--doc-text);
    }

    .doc-root * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }

    .doc-cover {
      page: cover;
      break-after: page;
      width: 100%;
      height: ${fullPageHeight};
      overflow: hidden;
      background-color: var(--doc-cover-bg);
      color: var(--doc-cover-text);
      display: flex;
      flex-direction: column;
      justify-content: center;
      padding: 28mm 24mm;
    }

    .theme-minimal .doc-cover {
      border-left: 6mm solid var(--doc-primary);
    }

    ${coverImageCss}

    .cover-inner {
      display: flex;
      flex-direction: column;
      gap: 10mm;
    }

    .cover-center {
      display: flex;
      flex-direction: column;
      gap: 6mm;
    }

    .cover-logo img {
      max-height: 18mm;
      max-width: 60mm;
      object-fit: contain;
    }

    .cover-accent-bar {
      width: 24mm;
      height: 1.5mm;
      background-color: var(--doc-cover-accent);
    }

    .cover-title {
      font-family: var(--doc-font-heading);
      font-size: 26pt;
      font-weight: 700;
      line-height: 1.3;
      margin: 0;
      color: var(--doc-cover-text);
      overflow-wrap: break-word;
      line-break: strict;
      word-break: auto-phrase;
    }

    .cover-subtitle {
      font-size: 13pt;
      line-height: 1.5;
      margin: 0;
      opacity: 0.86;
      overflow-wrap: break-word;
      line-break: strict;
      word-break: auto-phrase;
    }

    .cover-recipient {
      margin-top: 10mm;
      font-size: 13pt;
      font-weight: 600;
      letter-spacing: 0.02em;
      color: var(--doc-cover-text);
      opacity: 0.95;
    }

    .cover-meta {
      margin-top: 18mm;
      padding-top: 6mm;
      border-top: 0.5pt solid rgba(255, 255, 255, 0.28);
      font-size: 10.5pt;
      line-height: 1.8;
    }

    .theme-minimal .cover-meta {
      border-top-color: var(--doc-border);
    }

    .cover-author {
      font-weight: 600;
    }

    .cover-date {
      opacity: 0.8;
    }

    .doc-chapter-cover {
      page: chapter;
      break-before: page;
      break-after: page;
      width: 100%;
      height: ${fullPageHeight};
      overflow: hidden;
      background-color: var(--doc-bg-subtle);
      border-left: 7mm solid var(--doc-primary);
      display: flex;
      flex-direction: column;
      justify-content: center;
      padding: 28mm 24mm;
    }

    .chapter-cover-inner {
      display: flex;
      flex-direction: column;
      gap: 6mm;
    }

    .chapter-cover-bar {
      width: 18mm;
      height: 1.5mm;
      background-color: var(--doc-accent);
    }

    .doc-chapter-cover h1 {
      font-family: var(--doc-font-heading);
      font-size: 24pt;
      font-weight: 700;
      line-height: 1.35;
      color: var(--doc-primary);
      margin: 0;
      padding: 0;
      border: none;
    }

    .doc-chapter-cover .chapter-cover-lead {
      font-size: 11.5pt;
      line-height: 1.75;
      color: var(--doc-muted);
      margin-top: 2mm;
    }

    .doc-chapter-cover .chapter-cover-lead p {
      margin: 0 0 3mm 0;
      text-align: left;
    }

    .doc-chapter-cover .chapter-cover-lead p:last-child {
      margin-bottom: 0;
    }

    .doc-toc {
      page: toc;
      break-after: page;
    }

    .toc-heading {
      font-family: var(--doc-font-heading);
      font-size: 18pt;
      font-weight: 700;
      color: var(--doc-primary);
      border-bottom: 1.5pt solid var(--doc-primary);
      padding-bottom: 3mm;
      margin: 0 0 8mm 0;
    }

    .toc-list {
      list-style: none;
      margin: 0;
      padding: 0;
    }

    .toc-item {
      margin: 2.2mm 0;
      break-inside: avoid;
    }

    .toc-level-1 {
      font-weight: 700;
      font-size: 10.5pt;
      margin-top: 4mm;
    }

    .toc-level-2 {
      padding-left: 6mm;
      font-size: 9.5pt;
    }

    .toc-level-3 {
      padding-left: 12mm;
      font-size: 9pt;
      color: var(--doc-muted);
    }

    .toc-link {
      display: flex;
      align-items: baseline;
      width: 100%;
      text-decoration: none;
      color: inherit;
    }

    .toc-text {
      flex-shrink: 1;
      padding-right: 1.5mm;
    }

    .toc-text .doc-badge {
      font-size: 6.8pt;
      padding: 0.2mm 1.4mm;
      margin: 0 1.2mm 0 0;
      vertical-align: 0.5pt;
    }

    .toc-dots {
      flex: 1;
      min-width: 8mm;
      border-bottom: 1pt dotted var(--doc-border);
      margin: 0 1.5mm;
      transform: translateY(-2pt);
    }

    .toc-page-num {
      flex-shrink: 0;
      font-variant-numeric: tabular-nums;
      color: var(--doc-muted);
      min-width: 1.5em;
      text-align: right;
    }

    .toc-empty {
      color: var(--doc-muted);
      font-size: 9.5pt;
    }

    .doc-backcover {
      page: backcover;
      break-before: page;
      width: 100%;
      height: ${fullPageHeight};
      overflow: hidden;
      background-color: var(--doc-bg-subtle);
      color: var(--doc-text);
      display: flex;
      flex-direction: column;
      justify-content: flex-end;
      padding: 26mm 24mm;
    }

    ${backCoverImageCss}

    .backcover-inner {
      border-top: 1pt solid var(--doc-border);
      padding-top: 6mm;
    }

    .backcover-title {
      font-family: var(--doc-font-heading);
      font-size: 12pt;
      font-weight: 700;
      color: var(--doc-primary);
      margin-bottom: 3mm;
    }

    .backcover-divider {
      width: 14mm;
      height: 1pt;
      background-color: var(--doc-accent);
      margin-bottom: 4mm;
    }

    .backcover-text {
      font-size: 9pt;
      line-height: 1.7;
      color: var(--doc-muted);
      margin-bottom: 5mm;
    }

    .backcover-meta {
      display: flex;
      justify-content: space-between;
      font-size: 8.5pt;
      color: var(--doc-muted);
    }

    /* 特定単語バッジ */
    .doc-badge {
      display: inline-block;
      padding: 0.4mm 2mm;
      margin: 0 0.8mm;
      border-radius: 1mm;
      font-family: var(--doc-font-heading);
      font-size: 7.8pt;
      font-weight: 700;
      line-height: 1.3;
      vertical-align: baseline;
      letter-spacing: 0.02em;
    }

    .doc-badge-critical {
      background-color: #9f1239;
      color: #ffffff;
    }

    .doc-badge-high {
      background-color: #ea580c;
      color: #ffffff;
    }

    .doc-badge-medium {
      background-color: #d97706;
      color: #ffffff;
    }

    .doc-badge-low {
      background-color: #16a34a;
      color: #ffffff;
    }

    .doc-badge-info {
      background-color: #2563eb;
      color: #ffffff;
    }

    .doc-badge-scoping {
      background-color: #7c3aed;
      color: #ffffff;
    }

    .doc-badge-active {
      background-color: #0284c7;
      color: #ffffff;
    }

    .doc-badge-draft {
      background-color: #64748b;
      color: #ffffff;
    }

    .doc-badge-final {
      background-color: #059669;
      color: #ffffff;
    }

    .doc-badge-closed {
      background-color: #334155;
      color: #ffffff;
    }

    /* カラーバー（割合積み上げ棒） */
    .doc-colorbar {
      margin: 4.5mm 0;
      padding: 3mm 3.5mm;
      border: 0.5pt solid var(--doc-border);
      border-radius: 1.5mm;
      background-color: var(--doc-bg-subtle);
      break-inside: avoid;
      page-break-inside: avoid;
    }

    .doc-colorbar-track {
      display: flex;
      flex-direction: row;
      flex-wrap: nowrap;
      width: 100%;
      height: 7.5mm;
      border-radius: 1.2mm;
      overflow: hidden;
      background-color: #e2e8f0;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    .doc-colorbar-segment {
      flex: 0 0 auto;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      min-width: 0;
      overflow: hidden;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    .doc-colorbar-segment + .doc-colorbar-segment {
      border-left: 0.5pt solid rgba(255, 255, 255, 0.78);
    }

    .doc-colorbar-segment-label {
      padding: 0 1mm;
      font-family: var(--doc-font-heading);
      font-size: 7.2pt;
      font-weight: 700;
      line-height: 1;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .doc-colorbar-empty {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 100%;
      font-size: 7.5pt;
      color: var(--doc-muted);
    }

    .doc-colorbar-legend {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 1.5mm 4mm;
      margin-top: 2.5mm;
      font-size: 8pt;
      line-height: 1.35;
      color: var(--doc-text);
    }

    .doc-colorbar-legend-item {
      display: inline-flex;
      align-items: center;
      gap: 1.2mm;
      white-space: nowrap;
    }

    .doc-colorbar-swatch {
      display: inline-block;
      width: 2.6mm;
      height: 2.6mm;
      border-radius: 0.6mm;
      flex-shrink: 0;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    .doc-colorbar-legend-label {
      font-weight: 600;
      color: var(--doc-text);
    }

    .doc-colorbar-legend-value {
      font-variant-numeric: tabular-nums;
      color: var(--doc-muted);
    }

    .doc-colorbar-total {
      margin-left: auto;
      font-size: 7.5pt;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      color: var(--doc-muted);
    }

    /* カードブロック（サマリー／KPIカード） */
    .doc-cards {
      display: grid;
      gap: 3mm;
      margin: 4.5mm 0;
      break-inside: avoid;
      page-break-inside: avoid;
    }

    .doc-cards-cols-2 {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .doc-cards-cols-3 {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .doc-cards-cols-4 {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }

    .doc-card {
      display: flex;
      flex-direction: column;
      gap: 1.2mm;
      min-width: 0;
      padding: 3mm 3.5mm;
      border: 0.5pt solid var(--doc-border);
      border-top: 2.5pt solid var(--card-accent, var(--doc-accent));
      border-radius: 1.5mm;
      background-color: var(--doc-bg-subtle);
      break-inside: avoid;
      page-break-inside: avoid;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    .doc-card-label {
      font-family: var(--doc-font-heading);
      font-size: 7.8pt;
      font-weight: 600;
      line-height: 1.3;
      color: var(--doc-muted);
      overflow-wrap: anywhere;
    }

    .doc-card-value {
      font-family: var(--doc-font-heading);
      font-size: 15pt;
      font-weight: 700;
      line-height: 1.2;
      font-variant-numeric: tabular-nums;
      color: var(--card-accent, var(--doc-primary));
      overflow-wrap: anywhere;
    }

    .doc-card-note {
      font-size: 7.5pt;
      line-height: 1.35;
      color: var(--doc-muted);
      overflow-wrap: anywhere;
    }

    .doc-card-accent-critical {
      --card-accent: #9f1239;
      background-color: #fff1f2;
    }

    .doc-card-accent-high {
      --card-accent: #ea580c;
      background-color: #fff7ed;
    }

    .doc-card-accent-medium,
    .doc-card-accent-warning {
      --card-accent: #d97706;
      background-color: #fffbeb;
    }

    .doc-card-accent-low,
    .doc-card-accent-success {
      --card-accent: #16a34a;
      background-color: #f0fdf4;
    }

    .doc-card-accent-info {
      --card-accent: #2563eb;
      background-color: #eff6ff;
    }

    .doc-card-accent-primary {
      --card-accent: var(--doc-primary);
    }

    .doc-card-accent-accent {
      --card-accent: var(--doc-accent);
    }

    .doc-card-accent-neutral {
      --card-accent: #64748b;
    }

    .doc-card-accent-none {
      border-top-width: 0.5pt;
      border-top-color: var(--doc-border);
      --card-accent: var(--doc-primary);
    }

    /* 円グラフ／ドーナツグラフ（純SVGベクター） */
    .doc-chart {
      margin: 4.5mm 0;
      padding: 3.5mm 4mm;
      border: 0.5pt solid var(--doc-border);
      border-radius: 1.5mm;
      background-color: var(--doc-bg-subtle);
      break-inside: avoid;
      page-break-inside: avoid;
    }

    .doc-chart-title {
      font-family: var(--doc-font-heading);
      font-size: 9pt;
      font-weight: 700;
      color: var(--doc-primary);
      margin-bottom: 2.5mm;
    }

    .doc-chart-body {
      display: flex;
      flex-direction: row;
      align-items: center;
      gap: 6mm;
    }

    .doc-chart-svg {
      width: 44mm;
      height: 44mm;
      flex-shrink: 0;
      display: block;
      font-family: var(--doc-font-heading);
    }

    .doc-chart-legend {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 1.5mm;
      font-size: 8.2pt;
      line-height: 1.35;
      color: var(--doc-text);
    }

    .doc-chart-legend-item {
      display: flex;
      align-items: center;
      gap: 2mm;
    }

    .doc-chart-swatch {
      display: inline-block;
      width: 2.8mm;
      height: 2.8mm;
      border-radius: 0.6mm;
      flex-shrink: 0;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    .doc-chart-legend-label {
      flex: 1;
      min-width: 0;
      font-weight: 600;
      color: var(--doc-text);
      overflow-wrap: anywhere;
    }

    .doc-chart-legend-value {
      flex-shrink: 0;
      font-variant-numeric: tabular-nums;
      color: var(--doc-muted);
      white-space: nowrap;
    }

    .doc-chart-total {
      margin-top: 1mm;
      padding-top: 1.5mm;
      border-top: 0.5pt solid var(--doc-border);
      display: flex;
      justify-content: space-between;
      font-size: 8pt;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      color: var(--doc-primary);
    }

    .doc-body h1,
    .doc-body h2,
    .doc-body h3,
    .doc-body h4 {
      font-family: var(--doc-font-heading);
      color: var(--doc-primary);
      break-after: avoid;
      page-break-after: avoid;
      line-height: 1.35;
    }

    .doc-body h1 {
      font-size: 17pt;
      font-weight: 700;
      margin: 10mm 0 4.5mm 0;
      padding-bottom: 2mm;
      border-bottom: 1.5pt solid var(--doc-primary);
    }

    .doc-body h1:first-child {
      margin-top: 0;
    }

    .theme-technical .doc-body h1 {
      border-bottom: none;
      border-left: 3.5pt solid var(--doc-accent);
      padding-left: 3.5mm;
      padding-bottom: 0;
    }

    .theme-minimal .doc-body h1 {
      border-bottom: 0.75pt solid var(--doc-border);
    }

    .doc-body h2 {
      font-size: 13pt;
      font-weight: 700;
      margin: 7mm 0 3mm 0;
      color: var(--doc-primary);
    }

    .theme-business .doc-body h2 {
      border-left: 2.5pt solid var(--doc-accent);
      padding-left: 3mm;
    }

    .doc-body h3 {
      font-size: 11pt;
      font-weight: 700;
      margin: 5mm 0 2mm 0;
    }


    /* 見出し行ハイライト（階層連動 + バッジ連動 + <!-- hl: ... --> 上書き） */
    .doc-body h1 .doc-badge,
    .doc-body h2 .doc-badge,
    .doc-body h3 .doc-badge {
      box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.72);
    }

    .doc-root.heading-hl-tinted .doc-body h1:not(.doc-chapter-cover h1):not(.doc-hl-none):not(.doc-hl-custom) {
      background-color: color-mix(in srgb, var(--doc-primary) 10%, #ffffff);
      color: var(--doc-primary);
      border-bottom: none;
      border-left: 4pt solid var(--doc-primary);
      padding: 2.5mm 4mm;
      border-radius: 1mm;
    }

    .doc-root.heading-hl-tinted .doc-body h2:not(.doc-hl-none):not(.doc-hl-custom) {
      background-color: color-mix(in srgb, var(--doc-accent) 9%, #ffffff);
      color: var(--doc-primary);
      border-left: 3pt solid var(--doc-accent);
      padding: 1.8mm 3.5mm;
      border-radius: 1mm;
    }

    .doc-root.heading-hl-solid .doc-body h1:not(.doc-chapter-cover h1):not(.doc-hl-none):not(.doc-hl-custom) {
      background-color: var(--doc-primary);
      color: #ffffff;
      border: none;
      padding: 2.8mm 4.5mm;
      border-radius: 1mm;
    }

    .doc-root.heading-hl-solid .doc-body h1:not(.doc-chapter-cover h1):not(.doc-hl-none):not(.doc-hl-custom) code {
      background-color: rgba(255, 255, 255, 0.2);
      color: #ffffff;
    }

    .doc-root.heading-hl-solid .doc-body h2:not(.doc-hl-none):not(.doc-hl-custom) {
      background-color: color-mix(in srgb, var(--doc-primary) 10%, #ffffff);
      color: var(--doc-primary);
      border-left: 3.5pt solid var(--doc-primary);
      padding: 1.8mm 3.5mm;
      border-radius: 1mm;
    }

    .doc-root:not(.heading-hl-none) .doc-body .doc-hl-custom {
      border-bottom: none;
      padding: 2mm 3.8mm;
      border-radius: 1mm;
    }

    .doc-root:not(.heading-hl-none) .doc-body h1.doc-hl-custom {
      padding: 2.5mm 4.2mm;
    }

    .doc-root:not(.heading-hl-none) .doc-body h3.doc-hl-custom {
      padding: 1.4mm 3mm;
    }

    .doc-root:not(.heading-hl-none) .doc-body .doc-hl-critical {
      background-color: #fff1f2;
      color: #9f1239;
      border-left: 3.5pt solid #be123c;
    }

    .doc-root.heading-hl-solid .doc-body h1.doc-hl-critical {
      background-color: #9f1239;
      color: #ffffff;
      border-left: none;
    }

    .doc-root:not(.heading-hl-none) .doc-body .doc-hl-high {
      background-color: #fff7ed;
      color: #c2410c;
      border-left: 3.5pt solid #ea580c;
    }

    .doc-root.heading-hl-solid .doc-body h1.doc-hl-high {
      background-color: #c2410c;
      color: #ffffff;
      border-left: none;
    }

    .doc-root:not(.heading-hl-none) .doc-body .doc-hl-medium {
      background-color: #fffbeb;
      color: #b45309;
      border-left: 3.5pt solid #d97706;
    }

    .doc-root.heading-hl-solid .doc-body h1.doc-hl-medium {
      background-color: #b45309;
      color: #ffffff;
      border-left: none;
    }

    .doc-root:not(.heading-hl-none) .doc-body .doc-hl-low {
      background-color: #f0fdf4;
      color: #15803d;
      border-left: 3.5pt solid #16a34a;
    }

    .doc-root.heading-hl-solid .doc-body h1.doc-hl-low {
      background-color: #15803d;
      color: #ffffff;
      border-left: none;
    }

    .doc-root:not(.heading-hl-none) .doc-body .doc-hl-info {
      background-color: #eff6ff;
      color: #1d4ed8;
      border-left: 3.5pt solid #2563eb;
    }

    .doc-root.heading-hl-solid .doc-body h1.doc-hl-info {
      background-color: #1d4ed8;
      color: #ffffff;
      border-left: none;
    }

    .doc-root:not(.heading-hl-none) .doc-body .doc-hl-scoping {
      background-color: #f5f3ff;
      color: #6d28d9;
      border-left: 3.5pt solid #7c3aed;
    }

    .doc-root:not(.heading-hl-none) .doc-body .doc-hl-neutral {
      background-color: #f8fafc;
      color: #334155;
      border-left: 3.5pt solid #64748b;
    }

    .doc-root:not(.heading-hl-none) .doc-body .doc-hl-primary {
      background-color: color-mix(in srgb, var(--doc-primary) 10%, #ffffff);
      color: var(--doc-primary);
      border-left: 3.5pt solid var(--doc-primary);
    }

    .doc-root:not(.heading-hl-none) .doc-body .doc-hl-accent {
      background-color: color-mix(in srgb, var(--doc-accent) 10%, #ffffff);
      color: var(--doc-primary);
      border-left: 3.5pt solid var(--doc-accent);
    }

    .doc-root.heading-hl-solid .doc-body h1.doc-hl-custom code {
      background-color: rgba(255, 255, 255, 0.2);
      color: #ffffff;
    }

    .doc-body p {
      margin: 0 0 3.5mm 0;
      text-align: left;
      orphans: 3;
      widows: 3;
    }

    .doc-body ul,
    .doc-body ol {
      margin: 0 0 4mm 0;
      padding-left: 7mm;
    }

    .doc-body ul {
      list-style-type: disc;
      list-style-position: outside;
    }

    .doc-body ul ul {
      list-style-type: circle;
    }

    .doc-body ul ul ul {
      list-style-type: square;
    }

    .doc-body ol {
      list-style-type: decimal;
      list-style-position: outside;
    }

    .doc-body ol ol {
      list-style-type: lower-alpha;
    }

    .doc-body ul.contains-task-list {
      list-style-type: none;
      padding-left: 2mm;
    }

    .doc-body li {
      margin-bottom: 1.2mm;
    }

    .doc-body hr {
      border: none;
      border-top: 0.75pt solid var(--doc-border);
      margin: 6mm 0;
    }

    .doc-body a {
      color: var(--doc-accent);
      text-decoration: underline;
      overflow-wrap: anywhere;
      word-break: break-all;
    }

    .doc-body img {
      display: inline-block;
      vertical-align: middle;
      max-width: 100%;
      max-height: ${maxImageHeight};
      width: auto;
      height: auto;
      object-fit: contain;
      break-inside: avoid;
      page-break-inside: avoid;
    }

    .page-break {
      break-before: page;
      page-break-before: always;
      height: 0;
      margin: 0;
      padding: 0;
    }

    .doc-body table {
      width: 100%;
      border-collapse: collapse;
      margin: 4.5mm 0;
      font-size: 9pt;
      break-inside: avoid;
      page-break-inside: avoid;
    }

    .doc-body th,
    .doc-body td {
      border: 0.5pt solid var(--doc-border);
      padding: 2.2mm 3mm;
      text-align: left;
      vertical-align: top;
    }

    .doc-body th[align="center"],
    .doc-body td[align="center"] {
      text-align: center;
    }

    .doc-body th[align="right"],
    .doc-body td[align="right"] {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }

    .doc-body thead th {
      background-color: var(--doc-primary);
      color: #ffffff;
      font-weight: 600;
    }

    .theme-minimal .doc-body thead th {
      background-color: var(--doc-bg-subtle);
      color: var(--doc-primary);
      border-bottom: 1.2pt solid var(--doc-primary);
    }

    .doc-body tbody tr:nth-child(even) {
      background-color: var(--doc-bg-subtle);
    }

    .doc-body blockquote {
      margin: 4mm 0;
      padding: 2.5mm 4mm;
      border-left: 2.5pt solid var(--doc-border);
      background-color: var(--doc-bg-subtle);
      color: var(--doc-muted);
      break-inside: avoid;
    }

    .callout {
      margin: 4.5mm 0;
      padding: 3mm 4mm;
      border-radius: 1.5mm;
      border-left: 3pt solid #3b82f6;
      background-color: #eff6ff;
      break-inside: avoid;
      page-break-inside: avoid;
    }

    .callout-title {
      font-family: var(--doc-font-heading);
      font-size: 8.5pt;
      font-weight: 700;
      letter-spacing: 0.04em;
      margin-bottom: 1.5mm;
      color: #1d4ed8;
    }

    .callout-title:last-child {
      margin-bottom: 0;
    }

    .callout-title code {
      font-size: 8pt;
    }

    .callout-body p:last-child {
      margin-bottom: 0;
    }

    .callout-warning {
      border-left-color: #d97706;
      background-color: #fffbeb;
    }

    .callout-warning .callout-title {
      color: #b45309;
    }

    .callout-tip {
      border-left-color: #0d9488;
      background-color: #f0fdfa;
    }

    .callout-tip .callout-title {
      color: #0f766e;
    }

    .callout-important {
      border-left-color: #7c3aed;
      background-color: #f5f3ff;
    }

    .callout-important .callout-title {
      color: #6d28d9;
    }

    .callout-caution {
      border-left-color: #dc2626;
      background-color: #fef2f2;
    }

    .callout-caution .callout-title {
      color: #991b1b;
    }

    .callout-summary {
      border-left-color: #0891b2;
      background-color: #ecfeff;
    }

    .callout-summary .callout-title {
      color: #155e75;
    }

    .callout-success {
      border-left-color: #16a34a;
      background-color: #f0fdf4;
    }

    .callout-success .callout-title {
      color: #15803d;
    }

    .doc-body code {
      font-family: var(--doc-font-mono);
      font-size: 8.5pt;
      color: var(--doc-text);
      background-color: var(--doc-bg-subtle);
      border: 0.5pt solid var(--doc-border);
      padding: 0.3mm 1.2mm;
      border-radius: 1mm;
    }

    .doc-body thead th code {
      background-color: rgba(255, 255, 255, 0.18);
      color: #ffffff;
      border-color: rgba(255, 255, 255, 0.32);
    }

    .theme-minimal .doc-body thead th code {
      background-color: rgba(0, 0, 0, 0.06);
      color: var(--doc-primary);
      border-color: var(--doc-border);
    }

    .code-block-wrapper {
      margin: 4.5mm 0;
      border: 0.5pt solid var(--doc-border);
      border-radius: 1.5mm;
      overflow: hidden;
      break-inside: avoid;
      page-break-inside: avoid;
    }

    .code-block-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      background-color: #e2e8f0;
      color: #334155;
      padding: 1.5mm 3mm;
      font-family: var(--doc-font-mono);
      font-size: 7.5pt;
      border-bottom: 0.5pt solid var(--doc-border);
    }

    .code-lang {
      font-weight: 700;
    }

    .code-filename {
      opacity: 0.85;
    }

    .doc-body pre {
      margin: 0;
      padding: 3mm 3.5mm;
      background-color: #f8fafc;
      overflow-x: auto;
      white-space: pre-wrap;
      word-break: break-word;
      break-inside: avoid;
      page-break-inside: avoid;
    }

    .doc-body pre code {
      background: transparent;
      border: none;
      padding: 0;
      font-size: 8.2pt;
      line-height: 1.55;
    }

    .katex-display {
      margin: 4mm 0;
      break-inside: avoid;
      page-break-inside: avoid;
    }

    .footnotes {
      margin-top: 10mm;
      padding-top: 4mm;
      border-top: 0.5pt solid var(--doc-border);
      font-size: 8.5pt;
      color: var(--doc-muted);
    }
  `;
}
