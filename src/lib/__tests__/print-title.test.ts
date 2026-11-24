import { describe, it, expect } from "vitest";
import {
  FALLBACK_PRINT_TITLE,
  extractFirstHeading,
  normalizeFilenameTitle,
  normalizeSingleLineTitle,
  resolvePrintDocumentTitle,
} from "@/lib/print-title";

describe("print-title", () => {
  it("uses explicit frontmatter title as highest priority", () => {
    const md = `---
title: "2026年度 セキュリティ診断報告書"
author: "Security Team"
---

# 本文の見出し
`;
    expect(
      resolvePrintDocumentTitle(md, { fallbackFilename: "report.md" })
    ).toBe("2026年度 セキュリティ診断報告書");
  });

  it("normalizes line breaks and <br /> in frontmatter title into a single line", () => {
    expect(normalizeSingleLineTitle("2026年度\\nセキュリティ診断報告書")).toBe(
      "2026年度セキュリティ診断報告書"
    );
    expect(normalizeSingleLineTitle("Security<br />Report 2026")).toBe(
      "Security Report 2026"
    );

    const md = `---
title: "第1四半期\\nプロジェクト進捗報告"
---

# 見出し
`;
    expect(resolvePrintDocumentTitle(md)).toBe("第1四半期プロジェクト進捗報告");
  });

  it("falls back to first ATX heading when frontmatter is absent or title is empty", () => {
    const noFmMd = `
\`\`\`bash
# これはコードブロック内のコメント
echo "hello"
\`\`\`

# **システム設計書** <!-- hl:primary --> [v2](https://example.com)

本文テキスト
`;
    expect(resolvePrintDocumentTitle(noFmMd)).toBe("システム設計書 v2");

    const emptyTitleMd = `---
title: ""
author: "Team"
---

## 第1章 \`API\` 仕様書
`;
    expect(resolvePrintDocumentTitle(emptyTitleMd)).toBe("第1章 API 仕様書");
  });

  it("falls back to first heading when frontmatter omits title key (does not use default placeholder)", () => {
    const omittedTitleMd = `---
author: "Team"
theme: "technical"
---

週次定例議事録
====

決定事項をまとめます。
`;
    expect(resolvePrintDocumentTitle(omittedTitleMd)).toBe("週次定例議事録");
  });

  it("falls back to imported filename without extension when neither title nor heading exists", () => {
    const plainMd = `---
title: ""
---

見出しのない本文だけのメモです。
`;
    expect(
      resolvePrintDocumentTitle(plainMd, {
        fallbackFilename: "docs/2026-11-meeting-notes.md",
      })
    ).toBe("2026-11-meeting-notes");

    expect(normalizeFilenameTitle("C:\\reports\\spec.markdown")).toBe("spec");
    expect(normalizeFilenameTitle("memo.txt")).toBe("memo");
  });

  it("falls back to default untitled label when all sources are missing", () => {
    expect(resolvePrintDocumentTitle("ただの段落テキストのみ。")).toBe(
      FALLBACK_PRINT_TITLE
    );
    expect(
      resolvePrintDocumentTitle("---\ntitle: \"   \"\n---\n\n段落のみ", {
        fallbackFilename: "",
      })
    ).toBe(FALLBACK_PRINT_TITLE);
  });

  it("ignores headings inside tilde code fences", () => {
    const md = `~~~markdown
# フェンス内の見出し
~~~

## 実際の見出し
`;
    expect(extractFirstHeading(md)).toBe("実際の見出し");
  });
});
