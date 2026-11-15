export const SAMPLE_MARKDOWN = `---
title: "次世代プラットフォーム技術仕様書"
subtitle: "アーキテクチャ設計・セキュリティ要件・運用ガイドライン"
author: "システムアーキテクチャ推進室"
date: "2026-11-14"
page_size: "A4"
orientation: "portrait"
cover: true
back_cover: true
back_cover_text: "株式会社サンプルテクノロジー\n東京都豊島区駒込 1-2-3\nCopyright (c) 2026 Sample Technology Inc. All Rights Reserved."
toc: true
toc_depth: 3
theme: "business"
logo: ""
logo_position: "cover-and-header"
header_left: "{title}"
header_right: "{date}"
footer_left: "{author}"
footer_right: "{page} / {pages}"
---

# 1. エグゼクティブサマリー

本書は、クライアント完結型のドキュメント組版基盤および分散マイクロサービスの設計仕様を定義する。外部データベースへの依存を排除し、ブラウザ標準の印刷エンジンと CSS Paged Media によって商業印刷品質のPDF出力を実現する。

> [!NOTE]
> 本ドキュメントは Markdown + YAML フロントマターから自動組版されています。右上の「設定」ドロワーまたは YAML を編集すると、リアルタイムでページネーションが再計算されます。

## 1.1 設計方針

1. **ローカルファースト設計**: 作業データおよびアセットはブラウザ内の IndexedDB に保存され、外部サーバーへ送信されない。
2. **ベクター品質のPDF出力**: ヘッドレスブラウザを常駐させず、Paged.js と \`window.print()\` によりテキスト選択可能なPDFを生成する。
3. **単一バイナリ／コンテナ互換**: Next.js standalone 出力により、ローカル開発環境と本番コンテナ環境の双方で同一の挙動を保証する。

---

# 2. システム要件とパフォーマンス指標

各コンポーネントにおける目標SLAおよびリソース制約を下表に示す。

| コンポーネント | 目標レイテンシ | 最大メモリ使用量 | 永続化方式 | 備考 |
| :--- | :---: | :---: | :--- | :--- |
| Markdownパーサー | < 50 ms | 32 MB | メモリ内処理 | unified / remark / rehype |
| Paged.js 組版エンジン | < 800 ms | 128 MB | DOM隔離領域 | 非同期チャンク処理 |
| ローカルストレージ | < 10 ms | 50 MB | IndexedDB | 800ms デバウンス保存 |

> [!WARNING]
> 大量の高解像度画像を埋め込む場合、ブラウザの印刷プレビュー生成に数秒を要することがあります。ロゴ画像は 1MB 以下を推奨します。

## 2.1 チェックリスト

- [x] GFM テーブルおよびタスクリストの描画
- [x] KaTeX による数式組版（インライン・ブロック）
- [x] ファイル名ラベル付きシンタックスハイライト
- [ ] 印刷ダイアログでの「背景のグラフィック」有効化確認[^1]

<!-- pagebreak -->

# 3. 数理モデルと実装例

## 3.1 ページ分割コスト関数

組版エンジンにおける最適な改ページ位置の評価スコア $S$ は、孤立行ペナルティ $P_{\\text{orphan}}$ と余白バランス $B_{\\text{margin}}$ を用いて次式で定義される。

$$
S = \\sum_{i=1}^{N} \\left( \\alpha \\cdot P_{\\text{orphan}}(i) + \\beta \\cdot \\left| H_{\\text{page}} - \\sum_{j \\in i} h_j \\right| \\right)
$$

ここで $H_{\\text{page}}$ は印字可能領域の高さ、$h_j$ は各ブロック要素の高さを表す。

## 3.2 コード実装例

ファイル名付きコードブロック（\`\`\`ts:src/lib/formatter.ts）のレンダリング例を示す。

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

> [!TIP]
> \`<!-- pagebreak -->\` または \`\\newpage\` を記述することで、任意の箇所で強制改ページを実行できます。

> [!IMPORTANT]
> PDF出力時は、ブラウザの印刷設定で「余白: なし」または「デフォルト」を選択し、「ヘッダーとフッター」のチェックを外してください。

[^1]: Chrome / Edge の印刷ダイアログでは「詳細設定」内の「背景のグラフィック」を有効にすることで、表紙やコールアウトの背景色が正確に出力されます。
`;
