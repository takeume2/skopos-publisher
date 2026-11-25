import { describe, it, expect } from "vitest";
import { parseMarkdownDocument } from "@/lib/frontmatter";
import { compileMarkdownToHtml } from "@/lib/markdown";
import { extractOutlineHeadings } from "@/lib/outline";
import { SAMPLE_MARKDOWN } from "@/lib/sample-markdown";

describe("SAMPLE_MARKDOWN demonstration report (#46)", () => {
  it("parses frontmatter with multi-line back_cover_text and a harmless placeholder address", () => {
    const parsed = parseMarkdownDocument(SAMPLE_MARKDOWN);

    expect(parsed.hasFrontmatter).toBe(true);
    expect(parsed.frontmatter.cover).toBe(true);
    expect(parsed.frontmatter.back_cover).toBe(true);
    expect(parsed.frontmatter.toc).toBe(true);
    expect(parsed.frontmatter.recipient).toBeTruthy();

    // 裏表紙の文章が複数行に改行されていること
    const backCoverLines = parsed.frontmatter.back_cover_text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    expect(backCoverLines.length).toBeGreaterThanOrEqual(3);

    // 実在町名を含まず、無害な例示住所であること
    expect(parsed.frontmatter.back_cover_text).not.toContain("豊島区");
    expect(parsed.frontmatter.back_cover_text).not.toContain("駒込");
    expect(parsed.frontmatter.back_cover_text).toContain("東京都千代田区1-1");
  });

  it("compiles all major showcase features without errors", async () => {
    const compiled = await compileMarkdownToHtml(SAMPLE_MARKDOWN);

    // 表紙・目次・中扉・裏表紙
    expect(compiled.html).toContain('class="doc-cover"');
    expect(compiled.html).toContain('class="cover-recipient"');
    expect(compiled.html).toContain('class="doc-toc"');
    expect(compiled.html).toContain('class="doc-chapter-cover"');
    expect(compiled.html).toContain('class="doc-backcover"');
    expect(compiled.tocEntries.length).toBeGreaterThanOrEqual(6);

    // 裏表紙テキストに <br /> 改行が複数出力されていること
    expect(compiled.html).toContain(
      '<div class="backcover-text">株式会社サンプルテクノロジー<br />システムアーキテクチャ推進室<br />東京都千代田区1-1<br />Copyright (c) 2026 Sample Technology Inc. All Rights Reserved.</div>'
    );

    // 追加された表現機能（KPI カード・カラーバー・ドーナツグラフ・円グラフ）
    expect(compiled.html).toContain('class="doc-cards doc-cards-cols-4"');
    expect(compiled.html).toContain('class="doc-colorbar"');
    expect(compiled.html).toContain('class="doc-chart doc-chart-donut"');
    expect(compiled.html).toContain('class="doc-chart doc-chart-pie"');

    // バッジ・見出しハイライト
    expect(compiled.html).toContain("doc-badge-critical");
    expect(compiled.html).toContain("doc-badge-high");
    expect(compiled.html).toContain("doc-badge-medium");
    expect(compiled.html).toContain("doc-badge-low");
    expect(compiled.html).toContain("doc-badge-info");
    expect(compiled.html).toContain("doc-hl-high");
    expect(compiled.html).toContain("doc-hl-info");

    // 7 種類のコールアウト
    expect(compiled.html).toContain("callout-summary");
    expect(compiled.html).toContain("callout-success");
    expect(compiled.html).toContain("callout-note");
    expect(compiled.html).toContain("callout-caution");
    expect(compiled.html).toContain("callout-warning");
    expect(compiled.html).toContain("callout-tip");
    expect(compiled.html).toContain("callout-important");

    // 数式・コードブロックヘッダー・改ページ
    expect(compiled.html).toContain("katex");
    expect(compiled.html).toContain("code-block-header");
    expect(compiled.html).toContain('class="page-break"');
  });

  it("produces clean outline headings for editor navigation", () => {
    const headings = extractOutlineHeadings(SAMPLE_MARKDOWN);

    expect(headings.length).toBeGreaterThanOrEqual(8);
    expect(headings[0]).toMatchObject({
      level: 1,
      text: "1. エグゼクティブサマリー",
    });
    // <!-- hl: info --> コメントが見出しテキストから除去されていること
    expect(
      headings.some((h) => h.text === "2.3 監査ログの改ざん検知設計")
    ).toBe(true);
  });
});
