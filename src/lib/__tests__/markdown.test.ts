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

  it("renders all 7 callout types (including CAUTION, SUMMARY/ABSTRACT, SUCCESS) with default English labels and custom titles", async () => {
    const md = `---
title: "コールアウト検証"
cover: false
toc: false
back_cover: false
---

> [!NOTE]
> デフォルトノート

> [!WARNING]
> デフォルト警告

> [!TIP]
> デフォルトヒント

> [!IMPORTANT]
> デフォルト重要

> [!CAUTION]
> 危険な操作です

> [!SUMMARY]
> 要約テキスト

> [!abstract]
> ABSTRACT エイリアス

> [!SUCCESS]
> すべての基準に適合

> [!CAUTION] コーション
> カタカナタイトル本文

> [!NOTE] **重要**な \`config.yml\` 補足
> インライン記法入りタイトルの本文

> [!SUCCESS] サクセス

> [!SUMMARY] サマリー
>
> 空行区切りの本文

> [!NOTE] <script>alert(1)</script> 安全タイトル
> XSS 検証本文

> 通常の引用文

> [!NOTE]nospace
> マーカー直後に空白なし

> [!UNKNOWN] 未対応
> 未対応タイプ
`;
    const compiled = await compileMarkdownToHtml(md);

    // 全 7 種のクラスとデフォルト英語ラベル（タイトル省略時）
    expect(compiled.html).toContain(
      '<div class="callout callout-note"><div class="callout-title">NOTE</div>'
    );
    expect(compiled.html).toContain(
      '<div class="callout callout-warning"><div class="callout-title">WARNING</div>'
    );
    expect(compiled.html).toContain(
      '<div class="callout callout-tip"><div class="callout-title">TIP</div>'
    );
    expect(compiled.html).toContain(
      '<div class="callout callout-important"><div class="callout-title">IMPORTANT</div>'
    );
    expect(compiled.html).toContain(
      '<div class="callout callout-caution"><div class="callout-title">CAUTION</div>'
    );
    expect(compiled.html).toContain(
      '<div class="callout callout-summary"><div class="callout-title">SUMMARY</div>'
    );
    expect(compiled.html).toContain("ABSTRACT エイリアス");
    expect(compiled.html).toContain(
      '<div class="callout callout-success"><div class="callout-title">SUCCESS</div>'
    );

    // カタカナカスタムタイトル
    expect(compiled.html).toContain(
      '<div class="callout callout-caution"><div class="callout-title">コーション</div><div class="callout-body">\n<p>カタカナタイトル本文</p>\n</div></div>'
    );

    // インライン記法を含むカスタムタイトルが本文に漏れないこと
    expect(compiled.html).toContain(
      '<div class="callout-title"><strong>重要</strong>な <code>config.yml</code> 補足</div><div class="callout-body">\n<p>インライン記法入りタイトルの本文</p>\n</div>'
    );

    // タイトルのみコールアウトは空の callout-body を出力しないこと
    expect(compiled.html).toContain(
      '<div class="callout callout-success"><div class="callout-title">サクセス</div></div>'
    );

    // 空行区切りの本文
    expect(compiled.html).toContain(
      '<div class="callout callout-summary"><div class="callout-title">サマリー</div><div class="callout-body">\n\n<p>空行区切りの本文</p>\n</div></div>'
    );

    // カスタムタイトル内の XSS サニタイズ
    expect(compiled.html).not.toContain("<script");
    expect(compiled.html).toContain(
      '<div class="callout-title">安全タイトル</div>'
    );

    // 通常引用・不正マーカーは blockquote のまま維持されること
    expect(compiled.html).toContain("<blockquote>\n<p>通常の引用文</p>\n</blockquote>");
    expect(compiled.html).toContain("<blockquote>\n<p>[!NOTE]nospace");
    expect(compiled.html).toContain("<blockquote>\n<p>[!UNKNOWN] 未対応");
  });

  it("renders card blocks with 2-4 column CSS Grid, explicit column override, code block protection, and XSS sanitization", async () => {
    const md = `---
title: "KPIレポート"
cover: false
toc: false
back_cover: false
---

<!-- cards -->
- 検出総数 | 42件 | 前回比 -8件
- Critical | 3件 | 要即時対応 | critical
- 適合率 | 92.5% | 目標 90%以上 | success
- カスタム | A | 総合評価 | #0284c7
<!-- /cards -->

<!-- cards: 2 -->
- 項目A | 10
- 項目B | 20
- 項目C | 30
<!-- /cards -->

インライン \`<!-- cards -->\` は変換しない。

\`\`\`md
<!-- cards -->
- CodeBlock | 999
<!-- /cards -->
\`\`\`

<!-- cards -->
- <script>alert(1)</script> | 10 | 説明 | red;expression(1)
<!-- /cards -->

<!-- cards -->
<!-- /cards -->
`;
    const compiled = await compileMarkdownToHtml(md);

    // 4枚自動レイアウト（4列）とセマンティック／カスタム色
    expect(compiled.html).toContain('<div class="doc-cards doc-cards-cols-4">');
    expect(compiled.html).toContain('<div class="doc-card-label">検出総数</div>');
    expect(compiled.html).toContain('<div class="doc-card-value">42件</div>');
    expect(compiled.html).toContain('<div class="doc-card-note">前回比 -8件</div>');
    expect(compiled.html).toContain('class="doc-card doc-card-accent-critical"');
    expect(compiled.html).toContain('class="doc-card doc-card-accent-success"');
    expect(compiled.html).toContain('style="--card-accent: #0284c7;"');

    // 明示列指定（2列）
    expect(compiled.html).toContain('<div class="doc-cards doc-cards-cols-2">');

    // コードブロック・インラインコード非変換
    expect(compiled.html).toContain("<code>&#x3C;!-- cards --></code>");
    expect(compiled.html).toContain("CodeBlock | 999");

    // XSS サニタイズと不正色拒否、孤立・空マーカーの除去
    expect(compiled.html).not.toContain("<script");
    expect(compiled.html).not.toContain("expression(1)");
    expect(compiled.html).not.toContain("data-cards-marker");
  });

  it("renders pure SVG pie and donut charts with title, legend, code-block protection, and XSS sanitization", async () => {
    const md = `---
title: "SVGグラフ検証"
cover: false
toc: false
back_cover: false
---

<!-- donut(深刻度別件数): Critical=10, High=20, Medium=30, Low=40 -->

<!-- pie: 完了=100 -->

<!-- donut: ZeroA=0, ZeroB=0 -->

インライン \`<!-- pie: A=1, B=2 -->\` は変換しない。

\`\`\`md
<!-- donut: CodeBlock=100 -->
\`\`\`

<!-- pie: <script>alert(1)</script>=10(red;expression(1)), Safe=10 -->
<div data-chart-kind="donut" data-chart-spec="Raw=5" onclick="alert(1)" style="position:fixed"></div>
<!-- pie: invalid-only -->
`;
    const compiled = await compileMarkdownToHtml(md);

    // ドーナツグラフ（タイトル・SVG viewBox・path・中央合計・凡例）
    expect(compiled.html).toContain('class="doc-chart doc-chart-donut"');
    expect(compiled.html).toContain('<div class="doc-chart-title">深刻度別件数</div>');
    expect(compiled.html).toContain('<svg class="doc-chart-svg" viewBox="0 0 200 200"');
    expect(compiled.html).toContain('fill="#9f1239"');
    expect(compiled.html).toContain('stroke-width="1.5"');
    expect(compiled.html).toContain('text-anchor="middle"');
    expect(compiled.html).toContain(">100</text>");
    expect(compiled.html).toContain(">合計</text>");
    expect(compiled.html).toContain("10 (10%)");

    // 単一 100% 円グラフは <circle> で描画される
    expect(compiled.html).toContain('class="doc-chart doc-chart-pie"');
    expect(compiled.html).toContain('<circle cx="100" cy="100" r="86" fill="#059669"></circle>');

    // 全件 0 件も NaN なしでニュートラルリング描画
    expect(compiled.html).toContain('stroke="#e2e8f0"');
    expect(compiled.html).not.toContain("NaN");

    // コードブロック・インラインコードは非変換
    expect(compiled.html).toContain("<code>&#x3C;!-- pie: A=1, B=2 --></code>");
    expect(compiled.html).toContain("CodeBlock=100");

    // XSS・属性インジェクション・不正色拒否・無効データ除去
    expect(compiled.html).toContain(
      '<span class="doc-chart-legend-label">&#x3C;script>alert(1)&#x3C;/script></span>'
    );
    expect(compiled.html).not.toContain("expression(1)");
    expect(compiled.html).not.toContain("onclick");
    expect(compiled.html).not.toContain("position:fixed");
    expect(compiled.html).not.toContain("data-chart-spec");
  });

  it("preserves pagebreak and newpage directives literally inside callouts, inline code, and code blocks (#41)", async () => {
    const md = `---
title: "ディレクティブ保護検証"
cover: false
toc: false
back_cover: false
---

> [!TIP]
> \`<!-- pagebreak -->\` または \`\\newpage\` を記述することで、任意の箇所で強制改ページを実行できます。

> [!NOTE]
> <!-- pagebreak -->
> コールアウト内の生コメントも改ページにしない。

\`\`\`md
<!-- pagebreak -->
\\newpage
<!-- chapter -->
<!-- hl: info -->
\`\`\`

通常本文の直後

\\newpage

次のページ
`;
    const compiled = await compileMarkdownToHtml(md);

    // コールアウト内のインラインコードはリテラル表示され、コールアウトが壊れないこと
    expect(compiled.html).toContain(
      '<div class="callout callout-tip"><div class="callout-title">TIP</div><div class="callout-body">\n<p><code>&#x3C;!-- pagebreak --></code> または <code>\\newpage</code> を記述することで、任意の箇所で強制改ページを実行できます。</p>\n</div></div>'
    );

    // コールアウト内の生 <!-- pagebreak --> も改ページに変換されずコールアウト構造を維持
    expect(compiled.html).toContain("コールアウト内の生コメントも改ページにしない。");

    // コードブロック内のディレクティブもリテラルとして保持
    expect(compiled.html).toContain("&#x3C;!-- pagebreak -->");
    expect(compiled.html).toContain("\\newpage");
    expect(compiled.html).toContain("&#x3C;!-- chapter -->");
    expect(compiled.html).toContain("&#x3C;!-- hl: info -->");

    // 通常の \newpage はちょうど 1 回だけ <div class="page-break"></div> になること
    const pageBreakMatches = compiled.html.match(/<div class="page-break"><\/div>/g) || [];
    expect(pageBreakMatches).toHaveLength(1);
  });

  it("renders unresolved asset: images as placeholders preserving dimensions while escaping text (#25)", async () => {
    const safePng =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    const md = `---
title: "プレースホルダ検証"
cover: false
toc: false
back_cover: false
---

![アーキテクチャ図](asset:arch.png)

<img src="asset:sized.png" alt="サイズ指定" width="320" height="180" />

<img src="asset:bad_dim.png" alt="不正寸法" width="100px;background:red" />

![解決済み](asset:ok.png)
`;
    const compiled = await compileMarkdownToHtml(md, {
      "asset:ok.png": safePng,
    });

    expect(compiled.html).toContain('class="doc-asset-placeholder"');
    expect(compiled.html).toContain('data-asset-key="asset:arch.png"');
    expect(compiled.html).toContain(
      '<span class="doc-asset-placeholder-name">arch.png</span>'
    );
    expect(compiled.html).toContain("画像をドロップして復元");
    expect(compiled.html).toContain("doc-asset-placeholder-icon");

    // width / height 属性を引き継ぐこと
    expect(compiled.html).toContain('data-asset-key="asset:sized.png"');
    expect(compiled.html).toContain('style="width: 320px; height: 180px;"');

    // 不正な寸法指定は style に混入しないこと
    expect(compiled.html).toContain('data-asset-key="asset:bad_dim.png"');
    expect(compiled.html).not.toContain("background:red");

    // 解決済みアセットは通常の <img> として描画されること
    expect(compiled.html).toContain(`<img src="${safePng}" alt="解決済み">`);
    expect(compiled.html).not.toContain('data-asset-key="asset:ok.png"');
  });

  it("extracts block-level unresolved asset placeholders out of <p> to avoid Paged.js inline-flex fragmentation loops while keeping small inline icons inline (#25)", async () => {
    const md = `---
title: "ブロック分離検証"
cover: false
toc: false
back_cover: false
---

手順1の説明です。
![図1](asset:step1.png)
手順2の説明です。
![図2](asset:step2.png)

小さなアイコン <img src="asset:icon.png" width="20" height="20" /> を文中に埋め込みます。

| 列A | 列B |
| --- | --- |
| 証跡 | ![表内](asset:cell.png) |
`;
    const compiled = await compileMarkdownToHtml(md);

    // 段落内の通常プレースホルダは <p> を分割してブロック <figure> として独立出力されること
    expect(compiled.html).toContain("<p>手順1の説明です。</p>");
    expect(compiled.html).toContain("<p>手順2の説明です。</p>");
    expect(compiled.html).toContain(
      '<figure class="doc-asset-placeholder" data-asset-key="asset:step1.png"'
    );
    expect(compiled.html).toContain(
      '<figure class="doc-asset-placeholder" data-asset-key="asset:step2.png"'
    );
    expect(compiled.html).not.toContain("<p><figure");
    expect(compiled.html).not.toContain("</figure></p>");

    // 明示的に小さいインライン寸法の画像は文中に inline <span> として維持されること
    expect(compiled.html).toContain(
      '<span class="doc-asset-placeholder doc-asset-placeholder-inline" data-asset-key="asset:icon.png"'
    );

    // テーブルセル内も妥当なインライン要素として出力されること
    expect(compiled.html).toContain(
      '<td><span class="doc-asset-placeholder doc-asset-placeholder-inline" data-asset-key="asset:cell.png"'
    );
  });
});
