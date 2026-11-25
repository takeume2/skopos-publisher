import { describe, it, expect } from "vitest";
import {
  compileMarkdownToHtml,
  resolveAssetSrc,
  sanitizeImageUrl,
} from "@/lib/markdown";

describe("compileMarkdownToHtml", () => {
  it("sanitizes dangerous HTML tags, event handlers, and protocols", async () => {
    const md = `---
title: "XSS Test"
cover: false
toc: false
back_cover: false
---

<script>alert("xss")</script>
<img src="https://example.com/a.png" onerror="alert(1)" />
<svg onload="alert(1)"><script>alert(2)</script></svg>
<iframe src="javascript:alert(1)"></iframe>
<object data="javascript:alert(1)"></object>
<style>body { display: none; }</style>
<form><button formaction="javascript:alert(1)">click</button></form>

[bad-js](javascript:alert(1))
[bad-data](data:text/html,<script>alert(1)</script>)
<a href="vbscript:msgbox(1)">vb</a>
`;
    const compiled = await compileMarkdownToHtml(md);
    expect(compiled.html).not.toContain("<script");
    expect(compiled.html).not.toContain("onerror");
    expect(compiled.html).not.toContain("onload");
    expect(compiled.html).not.toContain("<iframe");
    expect(compiled.html).not.toContain("<object");
    expect(compiled.html).not.toContain("<style");
    expect(compiled.html).not.toContain("<form");
    expect(compiled.html).not.toContain("formaction");
    expect(compiled.html).not.toContain("javascript:");
    expect(compiled.html).not.toContain("vbscript:");
    expect(compiled.html).not.toContain("data:text/html");
  });

  it("strips arbitrary style and class attributes to prevent UI spoofing while preserving allowed features", async () => {
    const md = `---
title: "Whitelist Test"
cover: false
toc: false
back_cover: false
---

<div class="fixed inset-0 z-50 bg-black">spoof</div>
<table><tr><td style="position:fixed;inset:0;background:url(https://evil.example/a)" align="center">cell</td></tr></table>
<a id="page-1" name="body" href="https://example.com">link</a>

<!-- pagebreak -->

| 左 | 中央 |
| :--- | :---: |
| A | B |

数式 $x^2 + y^2 = z^2$ と footnote[^1]

[^1]: 脚注テキスト
`;
    const compiled = await compileMarkdownToHtml(md);

    // 任意 class / style は除去
    expect(compiled.html).not.toContain("fixed inset-0");
    expect(compiled.html).not.toContain("position:fixed");
    expect(compiled.html).not.toContain("evil.example");

    // DOM Clobbering 防御: ユーザー HTML の id/name には user-content- が付与される
    expect(compiled.html).toContain('id="user-content-page-1"');
    expect(compiled.html).toContain('name="user-content-body"');
    expect(compiled.html).not.toContain('id="page-1"');

    // 正当な機能は維持される
    expect(compiled.html).toContain('<div class="page-break"></div>');
    expect(compiled.html).toContain('<th align="center">中央</th>');
    expect(compiled.html).toContain('class="katex"');
    expect(compiled.html).toContain('href="#user-content-fn-1"');
    expect(compiled.html).toContain('id="user-content-fn-1"');
    expect(compiled.html).not.toContain("user-content-user-content-");
  });

  it("validates image data URIs and rejects malicious data:text/html, SVG scripts, and frontmatter javascript URLs", async () => {
    const maliciousSvgBase64 = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script></svg>'
    ).toString("base64");
    const safeSvgBase64 = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#0284c7"/></svg>'
    ).toString("base64");
    const safePng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

    const md = `---
title: "Image Security"
cover: true
toc: false
back_cover: true
logo: "javascript:alert(1)"
cover_image: "data:text/html,<script>alert(1)</script>"
back_cover_image: "data:image/svg+xml;base64,${maliciousSvgBase64}"
---

<img src="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==" alt="bad-html" />
<img src="data:image/svg+xml;base64,${maliciousSvgBase64}" alt="bad-svg" />
<img src="data:image/svg+xml;base64,${safeSvgBase64}" alt="ok-svg" />
<img src="${safePng}" alt="ok-png" />
<img src="asset:img_1" alt="ok-asset" />
`;

    const compiled = await compileMarkdownToHtml(md, {
      "asset:img_1": safePng,
    });

    expect(compiled.html).not.toContain("javascript:");
    expect(compiled.html).not.toContain("data:text/html");
    expect(compiled.html).not.toContain(maliciousSvgBase64);
    expect(compiled.html).not.toContain("cover-logo");
    expect(compiled.html).not.toContain("cover-bg-img");
    expect(compiled.html).not.toContain("backcover-bg-img");

    // 安全な画像 Data URI と解決済みアセットは維持される
    expect(compiled.html).toContain(`src="data:image/svg+xml;base64,${safeSvgBase64}"`);
    expect(compiled.html).toContain(`src="${safePng}"`);

    // ヘルパー直接検証
    expect(sanitizeImageUrl("javascript:alert(1)")).toBe("");
    expect(sanitizeImageUrl("data:image/svg+xml,<svg><animate attributeName='href' to='javascript:alert(1)'/></svg>")).toBe("");
    expect(resolveAssetSrc("javascript:alert(1)", {})).toBe("");
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

  it("renders colorbar directives as accessible Flexbox figures while ignoring code blocks and sanitizing malicious input", async () => {
    const md = `---
title: "サマリーレポート"
cover: false
toc: false
back_cover: false
---

<!-- colorbar: Critical=10, High=20, Medium=30, Low=40 -->

インラインコード \`<!-- colorbar: A=1, B=2 -->\` は変換しない。

\`\`\`md
<!-- colorbar: CodeBlock=100 -->
\`\`\`

<!-- colorbar: <script>alert(1)</script>=10(red;expression(1)), Safe=10 -->
<!-- colorbar: " onmouseover="alert(1)=5, Clean=5 -->
<div data-colorbar="Injected=5, Other=5" onclick="alert(1)" style="position:fixed"></div>
<!-- colorbar: ZeroA=0, ZeroB=0 -->
<!-- colorbar: invalid-only -->
`;
    const compiled = await compileMarkdownToHtml(md);

    // 通常のカラーバー描画
    expect(compiled.html).toContain('<figure class="doc-colorbar"');
    expect(compiled.html).toContain('class="doc-colorbar-track"');
    expect(compiled.html).toContain("width: 10%; background-color: #9f1239;");
    expect(compiled.html).toContain("width: 20%; background-color: #ea580c;");
    expect(compiled.html).toContain("width: 30%; background-color: #d97706;");
    expect(compiled.html).toContain("width: 40%; background-color: #16a34a;");
    expect(compiled.html).toContain("計 100");
    expect(compiled.html).toContain("Critical");
    expect(compiled.html).toContain("10 (10%)");

    // コードブロック・インラインコード内は非変換
    expect(compiled.html).toContain(
      "<code>&#x3C;!-- colorbar: A=1, B=2 --></code>"
    );
    expect(compiled.html).toContain("CodeBlock=100");
    expect(compiled.html).not.toContain('aria-label="CodeBlock');

    // XSS・属性インジェクションの抑止（凡例テキストはエスケープされ、属性脱出・イベントハンドラは不可）
    expect(compiled.html).toContain(
      '<span class="doc-colorbar-legend-label">&#x3C;script>alert(1)&#x3C;/script></span>'
    );
    expect(compiled.html).toContain("&#x22; onmouseover=&#x22;alert(1)");
    expect(compiled.html).not.toContain(' onmouseover="alert(1)"');
    expect(compiled.html).not.toContain("expression(1)");
    expect(compiled.html).not.toContain("onclick");
    expect(compiled.html).not.toContain("position:fixed");

    // 全項目 0 件と不正記法の安全な処理
    expect(compiled.html).toContain('class="doc-colorbar-empty"');
    expect(compiled.html).not.toContain("NaN%");
    expect(compiled.html).not.toContain("data-colorbar");
  });
});
