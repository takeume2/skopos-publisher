import { describe, it, expect } from "vitest";
import {
  extractUnresolvedAssetRefs,
  getAssetDisplayName,
  matchDroppedFilesToUnresolvedAssets,
  sanitizePlaceholderDimension,
} from "@/lib/unresolved-assets";

function makeFile(name: string, type = "image/png"): File {
  return new File(["img"], name, { type });
}

describe("unresolved-assets (#25)", () => {
  it("extracts unresolved inline asset: references while ignoring resolved assets, external URLs, code blocks, and HTML comments", () => {
    const md = `---
title: "テスト文書"
logo: "asset:missing-logo.png"
---

# 本文

![架構図](asset:architecture.png)

同じ画像を再参照: ![架構図2](asset:architecture.png)

解決済み: ![ok](asset:resolved.png)

外部URL: ![ext](https://example.com/a.png)

HTMLタグ: <img src="asset:photo_1.jpg" alt="写真1" width="320" />

参照リンク: ![フロー][flow-img]

自動採番: ![screenshot](asset:img_1732589123456)

インラインコード \`![ignored](asset:inline_code.png)\` は除外。

\`\`\`md
![fenced](asset:fenced_code.png)
<img src="asset:fenced_html.png" />
\`\`\`

<!-- <img src="asset:commented.png" /> -->

[flow-img]: asset:flow.svg
`;

    const assets = {
      "asset:resolved.png": "data:image/png;base64,AAAA",
    };

    const bodyRefs = extractUnresolvedAssetRefs(md, assets);
    expect(bodyRefs).toEqual([
      {
        assetKey: "asset:architecture.png",
        rawName: "architecture.png",
        displayName: "architecture.png",
        alt: "架構図",
        occurrences: 2,
        source: "body",
      },
      {
        assetKey: "asset:photo_1.jpg",
        rawName: "photo_1.jpg",
        displayName: "photo_1.jpg",
        alt: "写真1",
        occurrences: 1,
        source: "body",
      },
      {
        assetKey: "asset:flow.svg",
        rawName: "flow.svg",
        displayName: "flow.svg",
        alt: "フロー",
        occurrences: 1,
        source: "body",
      },
      {
        assetKey: "asset:img_1732589123456",
        rawName: "img_1732589123456",
        displayName: "screenshot (img_1732589123456)",
        alt: "screenshot",
        occurrences: 1,
        source: "body",
      },
    ]);

    // includeFrontmatter: true で #9 プリフライト向けに frontmatter の未解決 asset: も検出できる
    const withFrontmatter = extractUnresolvedAssetRefs(md, assets, {
      includeFrontmatter: true,
    });
    expect(withFrontmatter[0]).toEqual({
      assetKey: "asset:missing-logo.png",
      rawName: "missing-logo.png",
      displayName: "missing-logo.png",
      alt: "ロゴ画像",
      occurrences: 1,
      source: "frontmatter",
    });
  });

  it("formats display names and sanitizes placeholder width/height dimensions safely", () => {
    expect(getAssetDisplayName("asset:diagram.png", "図1")).toBe("diagram.png");
    expect(getAssetDisplayName("asset:img_1732589123456", "構成図")).toBe(
      "構成図 (img_1732589123456)"
    );
    expect(getAssetDisplayName("asset:img_1732589123456", "")).toBe(
      "img_1732589123456"
    );

    expect(sanitizePlaceholderDimension(400)).toBe("400px");
    expect(sanitizePlaceholderDimension("320")).toBe("320px");
    expect(sanitizePlaceholderDimension("50%")).toBe("50%");
    expect(sanitizePlaceholderDimension("80mm")).toBe("80mm");
    expect(sanitizePlaceholderDimension("0")).toBeNull();
    expect(sanitizePlaceholderDimension("-20px")).toBeNull();
    expect(sanitizePlaceholderDimension("100px; background: url(evil)")).toBeNull();
    expect(sanitizePlaceholderDimension("expression(1)")).toBeNull();
  });

  it("matches dropped files by exact name, basename, extensionless stem, NFC normalization, and alt fallback", () => {
    const unresolved = [
      {
        assetKey: "asset:images/Diagram.png",
        rawName: "images/Diagram.png",
        displayName: "images/Diagram.png",
        alt: "図",
        occurrences: 1,
        source: "body" as const,
      },
      {
        assetKey: "asset:chart_summary",
        rawName: "chart_summary",
        displayName: "chart_summary",
        alt: "",
        occurrences: 1,
        source: "body" as const,
      },
      {
        assetKey: "asset:img_1732589123456",
        rawName: "img_1732589123456",
        displayName: "ログイン画面 (img_1732589123456)",
        alt: "ログイン画面",
        occurrences: 1,
        source: "body" as const,
      },
      {
        // NFC: ガ = \u30ac
        assetKey: "asset:ガイド.png",
        rawName: "ガイド.png",
        displayName: "ガイド.png",
        alt: "",
        occurrences: 1,
        source: "body" as const,
      },
    ];

    // NFD filename (macOS): カ + 濁点 (\u30ab\u3099)
    const nfdFile = makeFile("\u30ab\u3099イド.png");
    const files = [
      makeFile("diagram.png"),
      makeFile("chart_summary.webp", "image/webp"),
      makeFile("ログイン画面.png"),
      nfdFile,
      makeFile("unmatched.png"),
      makeFile("readme.txt", "text/plain"),
    ];

    const res = matchDroppedFilesToUnresolvedAssets(files, unresolved);
    expect(res.matched).toHaveLength(4);
    expect(res.matched.map((m) => [m.file.name, m.assetKeys])).toEqual([
      ["diagram.png", ["asset:images/Diagram.png"]],
      ["chart_summary.webp", ["asset:chart_summary"]],
      ["ログイン画面.png", ["asset:img_1732589123456"]],
      [nfdFile.name, ["asset:ガイド.png"]],
    ]);
    expect(res.unmatchedFiles.map((f) => f.name)).toEqual(["unmatched.png"]);
    expect(res.nonImageFiles.map((f) => f.name)).toEqual(["readme.txt"]);
  });

  it("handles 100+ files bulk matching accurately and lists unmatched filenames", () => {
    const unresolved = Array.from({ length: 100 }, (_, i) => {
      const name = `shot_${String(i + 1).padStart(3, "0")}.png`;
      return {
        assetKey: `asset:${name}`,
        rawName: name,
        displayName: name,
        alt: `shot_${i + 1}`,
        occurrences: 1,
        source: "body" as const,
      };
    });

    const files = [
      ...unresolved.map((u) => makeFile(u.rawName)),
      makeFile("extra_1.png"),
      makeFile("extra_2.jpg", "image/jpeg"),
      makeFile("notes.md", "text/markdown"),
    ];

    const res = matchDroppedFilesToUnresolvedAssets(files, unresolved);
    expect(res.matched).toHaveLength(100);
    expect(res.unmatchedFiles.map((f) => f.name)).toEqual([
      "extra_1.png",
      "extra_2.jpg",
    ]);
    expect(res.nonImageFiles.map((f) => f.name)).toEqual(["notes.md"]);
  });
});
