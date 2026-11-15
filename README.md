# MD Publisher

Markdown と YAML フロントマターから、Paged.js（CSS Paged Media）を用いて商業印刷・ビジネスレポート品質の PDF を生成するクライアント完結型パブリッシング Web アプリケーションです。

## 主な特徴

- **ローカル＆サーバー両立**: 外部 DB・外部 API 不要。`output: "standalone"` による Docker デプロイ対応。
- **クライアント完結型 PDF 出力**: Paged.js + `@page` ルール + `window.print()` により、テキスト選択可能なベクター PDF を生成。
- **プライバシー保護**: 執筆中の Markdown、設定、ロゴ画像はブラウザの IndexedDB に自動保存。

## ローカル起動

```bash
npm install --legacy-peer-deps
npm run dev
```

ブラウザで `http://localhost:3000` を開いて利用します。

## Docker デプロイ（standalone）

```bash
docker build -t markdown-publisher .
docker run -d -p 3000:3000 --name md-publisher markdown-publisher
```
