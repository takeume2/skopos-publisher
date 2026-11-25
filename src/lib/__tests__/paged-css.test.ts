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
});
