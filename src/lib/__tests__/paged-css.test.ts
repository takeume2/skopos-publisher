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
});
