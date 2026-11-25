import { describe, it, expect } from "vitest";
import {
  extractOutlineHeadings,
  findActiveOutlineHeadingId,
} from "@/lib/outline";

describe("extractOutlineHeadings", () => {
  it("extracts H1 through H6 headings with accurate 1-based line numbers", () => {
    const md = [
      "# 第1章 はじめに",
      "本文テキスト",
      "## 1.1 背景",
      "### 1.1.1 目的",
      "#### 詳細仕様",
      "##### 補足事項",
      "###### 注記",
    ].join("\n");

    const headings = extractOutlineHeadings(md);

    expect(headings).toEqual([
      { id: "heading-1-0", level: 1, text: "第1章 はじめに", line: 1 },
      { id: "heading-3-1", level: 2, text: "1.1 背景", line: 3 },
      { id: "heading-4-2", level: 3, text: "1.1.1 目的", line: 4 },
      { id: "heading-5-3", level: 4, text: "詳細仕様", line: 5 },
      { id: "heading-6-4", level: 5, text: "補足事項", line: 6 },
      { id: "heading-7-5", level: 6, text: "注記", line: 7 },
    ]);
  });

  it("ignores YAML frontmatter (including YAML comments) and preserves full-document line numbers", () => {
    const md = [
      "---",
      'title: "設計書"',
      "# YAMLコメントは見出しではない",
      "theme: business",
      "---",
      "",
      "# 概要",
      "## 構成",
    ].join("\n");

    const headings = extractOutlineHeadings(md);

    expect(headings).toEqual([
      { id: "heading-7-0", level: 1, text: "概要", line: 7 },
      { id: "heading-8-1", level: 2, text: "構成", line: 8 },
    ]);
  });

  it("ignores headings inside fenced code blocks, indented code, blockquotes, and multi-line HTML comments", () => {
    const md = [
      "# 有効な見出し1",
      "```bash",
      "# bash comment",
      "## not a heading",
      "```",
      "~~~python",
      "# python comment",
      "~~~",
      "    # 4スペースインデントはコードブロック",
      "> # 引用内の見出しは除外",
      "<!--",
      "# コメント内の見出し",
      "-->",
      "## 有効な見出し2",
    ].join("\n");

    const headings = extractOutlineHeadings(md);

    expect(headings).toEqual([
      { id: "heading-1-0", level: 1, text: "有効な見出し1", line: 1 },
      { id: "heading-14-1", level: 2, text: "有効な見出し2", line: 14 },
    ]);
  });

  it("cleans inline Markdown formatting, HTML directive comments, and optional closing hashes", () => {
    const md = [
      "# **重要**な `foo_bar_baz` と [リンク](https://example.com) <!-- hl:high --> ##",
      "## C# と F# 比較##",
      "### ~~旧仕様~~ と _斜体_ と \\#エスケープ",
      "#### ![アイコン](icon.png) 画像付き見出し",
      "##   ",
      "### ###",
    ].join("\n");

    const headings = extractOutlineHeadings(md);

    expect(headings).toEqual([
      {
        id: "heading-1-0",
        level: 1,
        text: "重要な foo_bar_baz と リンク",
        line: 1,
      },
      { id: "heading-2-1", level: 2, text: "C# と F# 比較##", line: 2 },
      {
        id: "heading-3-2",
        level: 3,
        text: "旧仕様 と 斜体 と #エスケープ",
        line: 3,
      },
      { id: "heading-4-3", level: 4, text: "アイコン 画像付き見出し", line: 4 },
    ]);
  });

  it("returns an empty array for empty or heading-less documents", () => {
    expect(extractOutlineHeadings("")).toEqual([]);
    expect(extractOutlineHeadings("---\ntitle: A\n---")).toEqual([]);
    expect(extractOutlineHeadings("本文のみのドキュメント\n#スペースなし")).toEqual(
      []
    );
  });
});

describe("findActiveOutlineHeadingId", () => {
  const headings = extractOutlineHeadings(
    ["# 章1", "", "本文", "## 節1.1", "本文", "# 章2"].join("\n")
  );

  it("returns the last heading at or above the cursor line", () => {
    expect(findActiveOutlineHeadingId(headings, 1)).toBe("heading-1-0");
    expect(findActiveOutlineHeadingId(headings, 3)).toBe("heading-1-0");
    expect(findActiveOutlineHeadingId(headings, 4)).toBe("heading-4-1");
    expect(findActiveOutlineHeadingId(headings, 5)).toBe("heading-4-1");
    expect(findActiveOutlineHeadingId(headings, 6)).toBe("heading-6-2");
    expect(findActiveOutlineHeadingId(headings, 99)).toBe("heading-6-2");
  });

  it("returns null when cursor is above the first heading or list is empty", () => {
    const withFrontmatter = extractOutlineHeadings(
      ["---", "title: test", "---", "", "# 最初の見出し"].join("\n")
    );
    expect(findActiveOutlineHeadingId(withFrontmatter, 2)).toBeNull();
    expect(findActiveOutlineHeadingId(withFrontmatter, 5)).toBe("heading-5-0");
    expect(findActiveOutlineHeadingId([], 1)).toBeNull();
  });
});
