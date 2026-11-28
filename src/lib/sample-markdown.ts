import type { Locale } from "./i18n";

export const SAMPLE_MARKDOWN = `---
title: "次世代クラウドプラットフォーム\\n技術・セキュリティ評価報告書"
subtitle: "アーキテクチャ設計・セキュリティ診断結果・パフォーマンス評価"
recipient: "株式会社サンプルエンタープライズ IT基盤推進部 御中"
author: "システムアーキテクチャ推進室"
date: "2026-11-26"
page_size: "A4"
orientation: "portrait"
cover: true
cover_image: ""
cover_overlay: "light-fade"
back_cover: true
back_cover_image: ""
back_cover_text: |-
  株式会社サンプルテクノロジー
  システムアーキテクチャ推進室
  東京都千代田区1-1
  Copyright (c) 2026 Sample Technology Inc. All Rights Reserved.
toc: true
toc_depth: 3
theme: "business"
heading_highlight: "tinted"
confidential_mode: "none"
confidential_label: "CONFIDENTIAL"
logo: ""
logo_position: "cover-and-header"
header_left: "{title}"
header_right: "{date}"
footer_left: "{author}"
footer_right: "{page} / {pages}"
---

<!-- chapter -->

# 1. エグゼクティブサマリー

次世代クラウドプラットフォームの設計妥当性、セキュリティ診断結果、および性能評価の要点を総括します。

<!-- /chapter -->

## 1.1 総合評価と主要 KPI

本報告書は、クライアント完結型のドキュメント組版基盤および分散マイクロサービス基盤に対する技術評価・セキュリティ診断の結果を取りまとめたものです。主要指標は以下の通りです。

<!-- cards -->

- 評価項目総数 | 42件 | 前回診断比 -8件 | info
- 緊急・高リスク | 7件 | Critical 2 / High 5 | critical
- セキュリティ適合率 | 92.9% | 目標 90% 以上達成 | success
- 目標稼働率 (SLA) | 99.95% | 冗長構成検証済み | primary

<!-- /cards -->

> [!SUMMARY] 総合評価サマリー
> 全体として設計品質・運用自動化の水準は高く、セキュリティ基準適合率は **92.9%** と目標値を上回りました。一方で、認証トークン検証および権限制御に関する :Critical: / :High: の 7 件については、本番移行前の是正が必要です。

## 1.2 対策進捗ステータス

全 42 件の検出・評価項目に対する現時点の対応進捗を下図のカラーバーに示します。

<!-- colorbar: 完了=28, 進行中=9, 未着手=5 -->

> [!SUCCESS] 主要コンプライアンス基準への適合確認
> 暗号化通信（TLS 1.3）、監査ログの改ざん検知、およびブラウザ完結型のローカルデータ保護設計については、社内セキュリティ基準への完全適合を確認済みです。

> [!NOTE] 本サンプルドキュメントについて
> この文書は Markdown と YAML フロントマターから自動組版されています。右上の「設定」パネルからテーマ・配色・機密表示・出力ファイル名規則を変更すると、リアルタイムにプレビューへ反映されます。

<!-- chapter -->

# 2. セキュリティ診断・リスク分析

脆弱性診断および設定監査により検出された 42 件の内訳と、優先的に対処すべき主要リスクの詳細を整理します。

<!-- /chapter -->

## 2.1 検出事項の重要度別内訳

診断で検出された全 42 件を重要度別に集計した結果を以下のドーナツグラフに示します。

<!-- donut(検出事項の重要度別内訳): Critical=2, High=5, Medium=12, Low=18, Info=5 -->

主な検出事項と現在の対応ステータスは次の通りです。

| ID | 検出項目 | 重要度 | ステータス | 目標対応時期 |
| :--- | :--- | :---: | :---: | :--- |
| SEC-001 | 管理 API における認可チェック不備 | :Critical: | :Active: | リリース前必須 |
| SEC-002 | 認証トークンの有効期限検証不備 | :High: | :Active: | リリース前必須 |
| SEC-003 | セッション Cookie の属性強化 | :Medium: | :Final: | 対応完了 |
| SEC-004 | エラーレスポンスの詳細情報抑制 | :Low: | :Draft: | 次期スプリント |
| SEC-005 | 監査ログの長期保管ポリシー明文化 | :Info: | :Closed: | 記録済み |

## 2.2 認証トークンの有効期限検証不備 :High:

一部のマイクロサービス間連携エンドポイントにおいて、JWT の \`exp\` クレーム検証に時刻スキュー許容幅の上限が設定されていませんでした。失効済みトークンの再利用リスクを排除するため、許容幅を最大 60 秒以内に制限してください。

> [!CAUTION] 本番リリース前の必須是正事項
> :Critical: および :High: に分類された 7 件が未解消のまま本番環境へ展開された場合、不正アクセスや権限昇格につながる恐れがあります。リリース判定会議までに是正完了と再診断を実施してください。

## 2.3 監査ログの改ざん検知設計 <!-- hl: info -->

認証イベントおよび管理操作ログは、ハッシュチェーンを付与した追記専用ストレージへリアルタイム転送します。これにより、事後監査時の証跡完全性を担保します。

> [!WARNING] 高解像度画像・大容量アセット埋め込み時の留意点
> レポートへ大量の高解像度画像を埋め込む場合、ブラウザの印刷プレビュー生成に数秒を要することがあります。ロゴ画像や表紙背景は 1MB 以下を推奨します。

## 2.4 リリース前チェックリスト

- [x] GFM テーブル・バッジ・タスクリストの描画確認
- [x] KPI カード・カラーバー・ドーナツ／円グラフの組版確認
- [x] ファイル名ラベル付きシンタックスハイライトおよび KaTeX 数式組版
- [ ] 印刷ダイアログでの「背景のグラフィック」有効化確認[^1]

<!-- chapter -->

# 3. アーキテクチャ設計と実装例

システム全体のレイテンシ構造、組版コストの数理モデル、および主要コンポーネントの実装例を示します。

<!-- /chapter -->

## 3.1 レイテンシ内訳とパフォーマンス指標

代表トランザクション（平均応答時間 90 ms）における処理フェーズ別の内訳は以下の通りです。

<!-- pie(リクエスト処理レイテンシ内訳［ms］): 認証・認可=12, アプリ処理=28, DBアクセス=35, ネットワーク=15 -->

| コンポーネント | 目標レイテンシ | 最大メモリ使用量 | 永続化方式 | 備考 |
| :--- | :---: | :---: | :--- | :--- |
| Markdown パーサー | < 50 ms | 32 MB | メモリ内処理 | unified / remark / rehype |
| Paged.js 組版エンジン | < 800 ms | 128 MB | DOM 隔離領域 | 非同期チャンク処理 |
| ローカルストレージ | < 10 ms | 50 MB | IndexedDB | デバウンス自動保存 |

## 3.2 ページ分割コストの数理モデル

組版エンジンにおける最適な改ページ位置の評価スコア $S$ は、孤立行ペナルティ $P_{\\text{orphan}}$ と余白バランス $B_{\\text{margin}}$ を用いて次式で定義されます。

$$
S = \\sum_{i=1}^{N} \\left( \\alpha \\cdot P_{\\text{orphan}}(i) + \\beta \\cdot \\left| H_{\\text{page}} - \\sum_{j \\in i} h_j \\right| \\right)
$$

ここで $H_{\\text{page}}$ は印字可能領域の高さ、$h_j$ は各ブロック要素の高さを表します。

<!-- pagebreak -->

## 3.3 コード実装例

ファイル名付きコードブロック（\`\`\`ts:src/lib/formatter.ts）のレンダリング例を示します。

\`\`\`ts:src/lib/formatter.ts
export interface PageMetrics {
  widthMm: number;
  heightMm: number;
  marginMm: number;
}

export function calculatePrintableHeight(metrics: PageMetrics): number {
  const usableHeight = metrics.heightMm - metrics.marginMm * 2;
  if (usableHeight <= 0) {
    throw new Error("Invalid page margin configuration");
  }
  return usableHeight;
}
\`\`\`

> [!TIP] 改ページとアウトライン活用のヒント
> \`<!-- pagebreak -->\` または \`\\newpage\` で任意の箇所に強制改ページを挿入できます。また、左サイドバーの「見出し」タブから各セクションへワンクリックで移動できます。

> [!IMPORTANT] PDF 出力時の推奨印刷設定
> PDF 出力時は、ブラウザの印刷設定で「送信先: PDF に保存」「背景のグラフィック: ON」を選択し、ブラウザ標準の「ヘッダーとフッター」のチェックを外してください。

[^1]: Chrome / Edge の印刷ダイアログでは「詳細設定」内の「背景のグラフィック」を有効にすることで、表紙・中扉・グラフ・コールアウトの背景色が正確に出力されます。
`;

export const SAMPLE_MARKDOWN_EN = `---
title: "Next-Gen Cloud Platform\\nTechnical & Security Assessment Report"
subtitle: "Architecture Review, Security Findings, and Performance Benchmarks"
recipient: "Sample Enterprise Ltd. — Platform Engineering Division"
author: "System Architecture Office"
date: "2026-11-26"
page_size: "A4"
orientation: "portrait"
cover: true
cover_image: ""
cover_overlay: "light-fade"
back_cover: true
back_cover_image: ""
back_cover_text: |-
  Sample Technology Inc.
  System Architecture Office
  Colombo, Sri Lanka
  Copyright (c) 2026 Sample Technology Inc. All Rights Reserved.
toc: true
toc_depth: 3
theme: "business"
heading_highlight: "tinted"
confidential_mode: "none"
confidential_label: "CONFIDENTIAL"
logo: ""
logo_position: "cover-and-header"
header_left: "{title}"
header_right: "{date}"
footer_left: "{author}"
footer_right: "{page} / {pages}"
---

<!-- chapter -->

# 1. Executive Summary

An overview of architecture quality, security assessment findings, and performance benchmarks for the next-generation cloud platform.

<!-- /chapter -->

## 1.1 Overall Assessment & Key KPIs

This report summarizes the technical and security evaluation of our client-side document publishing engine and distributed microservices platform. Key metrics are shown below.

<!-- cards -->

- Total Checks | 42 | -8 vs previous | info
- Critical & High | 7 | Critical 2 / High 5 | critical
- Security Compliance | 92.9% | Target >= 90% | success
- Target Availability (SLA) | 99.95% | Multi-AZ verified | primary

<!-- /cards -->

> [!SUMMARY] Executive Assessment
> Overall design quality and automation maturity are strong, with **92.9%** compliance exceeding the 90% target. However, 7 :Critical: / :High: findings related to token validation and authorization must be remediated before production launch.

## 1.2 Remediation Progress

Current remediation progress across all 42 identified items is illustrated below.

<!-- colorbar: Completed=28, In Progress=9, Pending=5 -->

> [!SUCCESS] Core Compliance Verified
> End-to-end TLS 1.3 encryption, tamper-evident audit logs, and local-first browser storage fully satisfy internal security standards.

> [!NOTE] About This Sample Document
> This document is typeset directly from Markdown and YAML frontmatter. Open the "Settings" panel on the right to customize themes, colors, watermarks, and export filename rules in real time.

<!-- chapter -->

# 2. Security Assessment & Risk Analysis

Breakdown of the 42 findings discovered during vulnerability testing and configuration audits, along with prioritized remediation guidance.

<!-- /chapter -->

## 2.1 Findings by Severity

The distribution of all 42 findings by severity is shown in the donut chart below.

<!-- donut(Findings by Severity): Critical=2, High=5, Medium=12, Low=18, Info=5 -->

Key findings and current remediation status:

| ID | Finding | Severity | Status | Target Window |
| :--- | :--- | :---: | :---: | :--- |
| SEC-001 | Missing authorization check on admin API | :Critical: | :Active: | Before Launch |
| SEC-002 | Unbounded JWT expiration clock skew | :High: | :Active: | Before Launch |
| SEC-003 | Hardened session cookie attributes | :Medium: | :Final: | Completed |
| SEC-004 | Redact verbose error stack traces | :Low: | :Draft: | Next Sprint |
| SEC-005 | Document audit log retention policy | :Info: | :Closed: | Recorded |

## 2.2 JWT Expiration Validation Gap :High:

Several internal service endpoints did not enforce an upper bound on clock skew when validating JWT \`exp\` claims. Restrict allowed skew to 60 seconds or less to prevent replay of expired tokens.

> [!CAUTION] Mandatory Remediation Before Production
> Deploying with unresolved :Critical: or :High: findings may expose unauthorized access or privilege escalation paths. Complete remediation and re-verification prior to release sign-off.

## 2.3 Tamper-Evident Audit Logging <!-- hl: info -->

Authentication events and administrative actions are streamed in real time to append-only hash-chained storage to guarantee post-incident integrity.

> [!WARNING] Embedding Large High-Resolution Images
> Embedding many high-resolution images may add a few seconds to browser print preview generation. Keeping logos and cover backgrounds under 1 MB is recommended.

## 2.4 Pre-Release Checklist

- [x] Verify GFM tables, severity badges, and task lists
- [x] Verify KPI cards, color bars, and donut/pie charts
- [x] Verify syntax-highlighted code blocks and KaTeX equations
- [ ] Confirm "Background graphics" is enabled in the browser print dialog[^1]

<!-- chapter -->

# 3. Architecture & Implementation Example

Latency breakdown, mathematical pagination model, and sample TypeScript implementation.

<!-- /chapter -->

## 3.1 Request Latency Breakdown

Phase-by-phase breakdown of a representative transaction (90 ms average latency):

<!-- pie(Request Latency Breakdown [ms]): Auth=12, App Logic=28, DB Query=35, Network=15 -->

| Component | Target Latency | Peak Memory | Persistence | Notes |
| :--- | :---: | :---: | :--- | :--- |
| Markdown Parser | < 50 ms | 32 MB | In-memory | unified / remark / rehype |
| Paged.js Layout Engine | < 800 ms | 128 MB | Isolated DOM | Async chunked layout |
| Local Storage | < 10 ms | 50 MB | IndexedDB | Debounced auto-save |

## 3.2 Pagination Cost Model

The layout engine evaluates candidate page break score $S$ using orphan penalty $P_{\\text{orphan}}$ and margin balance $B_{\\text{margin}}$:

$$
S = \\sum_{i=1}^{N} \\left( \\alpha \\cdot P_{\\text{orphan}}(i) + \\beta \\cdot \\left| H_{\\text{page}} - \\sum_{j \\in i} h_j \\right| \\right)
$$

where $H_{\\text{page}}$ is printable height and $h_j$ is the height of each block element.

<!-- pagebreak -->

## 3.3 Code Example

Example of a titled code block (\`\`\`ts:src/lib/formatter.ts):

\`\`\`ts:src/lib/formatter.ts
export interface PageMetrics {
  widthMm: number;
  heightMm: number;
  marginMm: number;
}

export function calculatePrintableHeight(metrics: PageMetrics): number {
  const usableHeight = metrics.heightMm - metrics.marginMm * 2;
  if (usableHeight <= 0) {
    throw new Error("Invalid page margin configuration");
  }
  return usableHeight;
}
\`\`\`

> [!TIP] Page Breaks & Outline Navigation
> Insert \`<!-- pagebreak -->\` or \`\\newpage\` to force a page break anywhere. Use the "Outline" tab in the left sidebar to jump directly to any heading.

> [!IMPORTANT] Recommended PDF Print Settings
> When exporting PDF, select "Destination: Save as PDF", turn "Background graphics" ON, and turn browser "Headers and footers" OFF.

[^1]: In Chrome / Edge print settings, enabling "Background graphics" under "More settings" ensures covers, chapter dividers, charts, and callout backgrounds render accurately.
`;

export function getSampleMarkdown(locale: Locale = "ja"): string {
  return locale === "en" ? SAMPLE_MARKDOWN_EN : SAMPLE_MARKDOWN;
}
