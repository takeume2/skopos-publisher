import { describe, it, expect } from "vitest";
import { buildPagedMediaCss } from "@/lib/paged-css";
import { DEFAULT_FRONTMATTER } from "@/types/document";

describe("buildPagedMediaCss", () => {
  it("applies strict watermark only to main @page and @page toc, excluding cover/backcover", () => {
    const css = buildPagedMediaCss({
      ...DEFAULT_FRONTMATTER,
      confidential_mode: "strict",
      confidential_label: "INTERNAL ONLY",
    });

    expect(css).toContain("INTERNAL%20ONLY");
    expect(css).toContain("@page cover {");
    expect(css).toContain("background-image: none !important;");
  });

  it("generates left-aligned paragraphs, URL wrapping, and heading highlight rules", () => {
    const css = buildPagedMediaCss({
      ...DEFAULT_FRONTMATTER,
      heading_highlight: "solid",
    });

    expect(css).toContain("text-align: left;");
    expect(css).toContain("overflow-wrap: anywhere;");
    expect(css).toContain("word-break: break-all;");
    expect(css).toContain(".doc-root.heading-hl-solid");
  });

  it("rejects dangerous logo URLs and escapes closing style tags in margin content", () => {
    const css = buildPagedMediaCss({
      ...DEFAULT_FRONTMATTER,
      logo: 'javascript:alert(1)"); } </style><script>alert(1)</script>',
      logo_position: "cover-and-header",
      header_left: 'Title </style><script>alert(1)</script>',
    });

    expect(css).not.toContain("javascript:");
    expect(css).not.toContain("</style>");
    expect(css).toContain("@top-center { content: none; }");
  });

  it("includes Flexbox and print-safe CSS rules for colorbars", () => {
    const css = buildPagedMediaCss(DEFAULT_FRONTMATTER);

    expect(css).toContain(".doc-colorbar {");
    expect(css).toContain(".doc-colorbar-track {");
    expect(css).toContain("display: flex;");
    expect(css).toContain(".doc-colorbar-segment {");
    expect(css).toContain("print-color-adjust: exact;");
    expect(css).toContain("break-inside: avoid;");
  });

  it("includes distinct styles for callout-caution, callout-summary, callout-success, and callout-tip", () => {
    const css = buildPagedMediaCss(DEFAULT_FRONTMATTER);

    expect(css).toContain(".callout-caution {");
    expect(css).toContain(".callout-summary {");
    expect(css).toContain(".callout-success {");
    expect(css).toContain(".callout-tip {");
    expect(css).toContain(".callout-title:last-child {");

    // TIP（ティール系）と SUCCESS（グリーン系）が視覚的に差別化されていること
    expect(css).toContain("border-left-color: #0d9488;");
    expect(css).toContain("border-left-color: #16a34a;");
  });

  it("includes 2-4 column CSS Grid and print-safe rules for KPI card blocks", () => {
    const css = buildPagedMediaCss(DEFAULT_FRONTMATTER);

    expect(css).toContain(".doc-cards {");
    expect(css).toContain("display: grid;");
    expect(css).toContain("grid-template-columns: repeat(2, minmax(0, 1fr));");
    expect(css).toContain("grid-template-columns: repeat(3, minmax(0, 1fr));");
    expect(css).toContain("grid-template-columns: repeat(4, minmax(0, 1fr));");
    expect(css).toContain(".doc-card {");
    expect(css).toContain(".doc-card-accent-critical {");
  });

  it("includes print-safe side-by-side layout rules for SVG pie and donut charts", () => {
    const css = buildPagedMediaCss(DEFAULT_FRONTMATTER);

    expect(css).toContain(".doc-chart {");
    expect(css).toContain(".doc-chart-body {");
    expect(css).toContain(".doc-chart-svg {");
    expect(css).toContain("width: 44mm;");
    expect(css).toContain(".doc-chart-swatch {");
    expect(css).toContain(".doc-chart-legend {");
  });

  it("hides header and footer cleanly on @page toc without roman page numbers or inherited border/logo leaks", () => {
    const css = buildPagedMediaCss({
      ...DEFAULT_FRONTMATTER,
      logo: "https://example.com/logo.png",
      logo_position: "cover-and-header",
    });

    const tocMatch = css.match(/@page toc \{[\s\S]*?\n    \}/);
    expect(tocMatch).not.toBeNull();
    const tocBlock = tocMatch![0];

    expect(tocBlock).not.toContain("lower-roman");
    expect(tocBlock).not.toContain("counter(page");
    expect(tocBlock).toContain(
      "@top-left { content: none; border: none; background-image: none; }"
    );
    expect(tocBlock).toContain(
      "@top-center { content: none; border: none; background-image: none; }"
    );
    expect(tocBlock).toContain(
      "@top-right { content: none; border: none; background-image: none; }"
    );
    expect(tocBlock).toContain(
      "@bottom-left { content: none; border: none; background-image: none; }"
    );
    expect(tocBlock).toContain(
      "@bottom-center { content: none; border: none; background-image: none; }"
    );
    expect(tocBlock).toContain(
      "@bottom-right { content: none; border: none; background-image: none; }"
    );

    expect(css).toContain(
      ".pagedjs_toc_page .pagedjs_margin-top > .pagedjs_margin,"
    );
    expect(css).toContain(
      ".pagedjs_toc_page .pagedjs_margin-bottom > .pagedjs_margin {"
    );
    expect(css).toContain("visibility: hidden !important;");
  });

  it("uses phrase-aware wrapping on cover title/subtitle and tunes title font size when cover image is set", () => {
    const css = buildPagedMediaCss(DEFAULT_FRONTMATTER);

    expect(css).toContain("word-break: auto-phrase;");
    expect(css).not.toContain("text-wrap: balance;");
    expect(css).toContain(
      ".doc-cover.has-cover-image .cover-title {\n        font-size: 22pt;\n      }"
    );
  });

  it("includes placeholder box styles for unresolved asset: images (#25)", () => {
    const css = buildPagedMediaCss(DEFAULT_FRONTMATTER);

    expect(css).toContain(".doc-asset-placeholder {");
    expect(css).toContain("display: block;");
    expect(css).toContain(".doc-asset-placeholder-inline {");
    expect(css).toContain(".doc-asset-placeholder-inner {");
    expect(css).toContain(".doc-asset-placeholder-icon {");
    expect(css).toContain(".doc-asset-placeholder-name {");
    expect(css).toContain(".doc-asset-placeholder-hint {");
    expect(css).toContain("border: 1.5pt dashed var(--doc-border);");
    // 長大テーブルで Paged.js のレイアウト反復・欠落を防ぐため、table 全体ではなく tr 単位で改ページ抑止する
    expect(css).toContain(".doc-body tr {");
    expect(css).toContain("display: table-header-group;");
  });

  it("derives full-page cover/chapter/backcover height from Paged.js pagebox and margin variables and avoids flex-end fragmentation on doc-backcover", () => {
    const css = buildPagedMediaCss(DEFAULT_FRONTMATTER);

    expect(css).toContain(
      "height: calc(var(--pagedjs-pagebox-height, 297mm) - var(--pagedjs-margin-top, 0px) - var(--pagedjs-margin-bottom, 0px) - 0.5mm);"
    );
    expect(css).toContain(".doc-backcover {");
    expect(css).toContain("position: relative;\n      display: block;");
    expect(css).toContain(
      ".backcover-inner {\n      position: absolute;\n      left: 24mm;\n      right: 24mm;\n      bottom: 26mm;"
    );
    expect(css).toContain("max-height: 100%;");
  });
});
