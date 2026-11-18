import { describe, it, expect } from "vitest";
import {
  parseMarkdownDocument,
  serializeFrontmatter,
  updateMarkdownFrontmatter,
} from "@/lib/frontmatter";
import { DEFAULT_FRONTMATTER } from "@/types/document";

describe("frontmatter", () => {
  it("returns default frontmatter when YAML block is absent", () => {
    const parsed = parseMarkdownDocument("# Hello\n\nBody text");
    expect(parsed.hasFrontmatter).toBe(false);
    expect(parsed.frontmatter).toEqual(DEFAULT_FRONTMATTER);
    expect(parsed.body).toBe("# Hello\n\nBody text");
  });

  it("normalizes and clamps frontmatter values", () => {
    const md = `---
title: "セキュリティ診断報告書"
page_size: "INVALID_SIZE"
font_size: 99
line_height: 0.5
heading_highlight: "solid"
cover_overlay: "dark-fade"
primary_color: "#1e3a8a"
accent_color: "not-a-hex"
---

# 本文
`;
    const parsed = parseMarkdownDocument(md);
    expect(parsed.hasFrontmatter).toBe(true);
    expect(parsed.frontmatter.title).toBe("セキュリティ診断報告書");
    expect(parsed.frontmatter.page_size).toBe(DEFAULT_FRONTMATTER.page_size);
    expect(parsed.frontmatter.font_size).toBe(12);
    expect(parsed.frontmatter.line_height).toBe(1.4);
    expect(parsed.frontmatter.heading_highlight).toBe("solid");
    expect(parsed.frontmatter.cover_overlay).toBe("dark-fade");
    expect(parsed.frontmatter.primary_color).toBe("#1e3a8a");
    expect(parsed.frontmatter.accent_color).toBe("");
  });

  it("round-trips frontmatter serialization and updates body cleanly", () => {
    const nextFm = {
      ...DEFAULT_FRONTMATTER,
      title: "テスト文書",
      heading_highlight: "none" as const,
    };
    const serialized = serializeFrontmatter(nextFm);
    const updated = updateMarkdownFrontmatter("# 見出し\n\n段落", nextFm);

    expect(updated.startsWith(serialized)).toBe(true);
    const reparsed = parseMarkdownDocument(updated);
    expect(reparsed.frontmatter.title).toBe("テスト文書");
    expect(reparsed.frontmatter.heading_highlight).toBe("none");
    expect(reparsed.body.trim()).toBe("# 見出し\n\n段落");
  });
});
