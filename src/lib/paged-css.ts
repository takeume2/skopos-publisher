import type {
  DocumentFrontmatter,
  DocumentTheme,
  FontFamilyOption,
  PageOrientation,
  PageSize,
} from "@/types/document";

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
    .replaceAll("\n", " ");
}

function formatMarginContent(
  template: string,
  fm: DocumentFrontmatter
): string {
  if (!template || !template.trim()) {
    return "none";
  }

  const resolved = template
    .replaceAll("{title}", fm.title)
    .replaceAll("{author}", fm.author)
    .replaceAll("{date}", fm.date)
    .replaceAll("{page}", "__MD_PAGE__")
    .replaceAll("{pages}", "__MD_PAGES__");

  return `"${escapeCssString(resolved)}"`;
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

export function buildPagedMediaCss(
  fm: DocumentFrontmatter,
  resolvedLogoDataUrl?: string
): string {
  const { cssSize, pageHeight } = getPageDimensions(
    fm.page_size,
    fm.orientation
  );
  const fullPageHeight = `calc(${pageHeight} - 1mm)`;
  const maxImageHeight = `calc(${pageHeight} - 52mm)`;

  const headerLeft = formatMarginContent(fm.header_left, fm);
  const headerRight = formatMarginContent(fm.header_right, fm);
  const footerLeft = formatMarginContent(fm.footer_left, fm);
  const footerRight = formatMarginContent(fm.footer_right, fm);

  const logoSrc =
    fm.logo.startsWith("asset:") && resolvedLogoDataUrl
      ? resolvedLogoDataUrl
      : fm.logo;

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
      @top-left { content: none; }
      @top-center { content: none; }
      @top-right { content: none; }
      @bottom-left { content: none; }
      @bottom-center { content: none; }
      @bottom-right { content: none; }
    }

    @page toc {
      @top-left { content: none; }
      @top-center { content: none; }
      @top-right { content: none; }
      @bottom-left { content: none; }
      @bottom-center {
        content: counter(page, lower-roman);
        font-family: var(--doc-font-sans);
        font-size: 8.5pt;
        color: var(--doc-muted);
      }
      @bottom-right { content: none; }
    }

    @page chapter {
      margin: 0;
      @top-left { content: none; }
      @top-center { content: none; }
      @top-right { content: none; }
      @bottom-left { content: none; }
      @bottom-center { content: none; }
      @bottom-right { content: none; }
    }

    @page backcover {
      margin: 0;
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

    .cover-inner {
      display: flex;
      flex-direction: column;
      gap: 10mm;
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
    }

    .cover-subtitle {
      font-size: 13pt;
      line-height: 1.5;
      margin: 0;
      opacity: 0.86;
    }

    .cover-meta {
      margin-top: 24mm;
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

    /* 中扉 (Chapter Cover) */
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

    /* 目次 (Table of Contents) */
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

    .doc-body p {
      margin: 0 0 3.5mm 0;
      text-align: justify;
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
      border-left-color: #059669;
      background-color: #ecfdf5;
    }

    .callout-tip .callout-title {
      color: #047857;
    }

    .callout-important {
      border-left-color: #7c3aed;
      background-color: #f5f3ff;
    }

    .callout-important .callout-title {
      color: #6d28d9;
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
