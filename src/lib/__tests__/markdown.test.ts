import { describe, it, expect } from "vitest";
import { compileMarkdownToHtml } from "@/lib/markdown";

describe("compileMarkdownToHtml", () => {
  it("sanitizes dangerous HTML tags and event handlers", async () => {
    const md = `---
title: "XSS Test"
cover: false
toc: false
back_cover: false
---

<script>alert("xss")</script>
<img src="https://example.com/a.png" onerror="alert(1)" />

[bad](javascript:alert(1))
`;
    const compiled = await compileMarkdownToHtml(md);
    expect(compiled.html).not.toContain("<script");
    expect(compiled.html).not.toContain("onerror");
    expect(compiled.html).not.toContain("javascript:");
  });

  it("renders inline badges outside code blocks and links heading highlights + TOC badges", async () => {
    const md = `---
title: "診断レポート"
cover: false
toc: true
back_cover: false
heading_highlight: "tinted"
---

## :Critical: 認証バイパス

本文中の \`:Critical:\` は変換しない。通常テキストの :High: は変換する。

## 手動ハイライト <!-- hl: info -->
`;
    const compiled = await compileMarkdownToHtml(md);

    expect(compiled.html).toContain('class="doc-hl-custom doc-hl-critical"');
    expect(compiled.html).toContain('class="doc-hl-custom doc-hl-info"');
    expect(compiled.html).not.toContain("<!-- hl:");
    expect(compiled.html).toContain("<code>:Critical:</code>");
    expect(compiled.html).toContain(
      '<span class="doc-badge doc-badge-high">High</span>'
    );
    expect(compiled.html).toContain(
      '<span class="toc-text"><span class="doc-badge doc-badge-critical">Critical</span> 認証バイパス</span>'
    );
  });

  it("excludes chapter cover h1 from heading highlight and supports manual line breaks in cover title", async () => {
    const md = `---
title: "第1四半期\\nセキュリティレポート"
cover: true
toc: false
back_cover: false
---

<!-- chapter -->
# 第1章 概要
<!-- /chapter -->
`;
    const compiled = await compileMarkdownToHtml(md);
    expect(compiled.html).toContain("第1四半期<br />セキュリティレポート");
    expect(compiled.html).toContain('<section class="doc-chapter-cover">');
    expect(compiled.html).not.toContain("doc-hl-custom");
  });
});
