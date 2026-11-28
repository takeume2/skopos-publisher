import { describe, it, expect } from "vitest";
import { parseNgWordsList, runPreflightCheck } from "@/lib/preflight";

describe("preflight check (#9)", () => {
  it("parses newline, comma, and Japanese-comma separated NG word lists with deduplication", () => {
    expect(
      parseNgWordsList("社内限定, ProjectX\n社内限定、internal.example.com，  ")
    ).toEqual(["社内限定", "ProjectX", "internal.example.com"]);
    expect(parseNgWordsList("")).toEqual([]);
  });

  it("detects TBD/TODO/FIXME/XXX and Japanese placeholders while ignoring code blocks, inline code, HTML comments, and normal words like 仮想", () => {
    const md = [
      "---",
      'title: "システム設計書（仮）"',
      'author: "設計チーム"',
      'date: "2026-11-28"',
      "cover: true",
      "---",
      "",
      "# 概要",
      "要件定義は TBD です。",
      "この箇所は要確認です。",
      "仮想環境と仮説検証は問題ない通常単語です。",
      "インラインコードの `TODO` や `TBD` は無視される。",
      "<!-- 社内メモ TODO TBD -->",
      "```ts",
      "// TODO: コードブロック内は無視",
      "const status = 'FIXME';",
      "```",
    ].join("\n");

    const report = runPreflightCheck(md, {});
    const incomplete = report.issues.filter((i) => i.category === "incomplete");

    expect(incomplete.map((i) => ({ label: i.label, line: i.line }))).toEqual([
      { label: "（仮）", line: 2 },
      { label: "TBD", line: 9 },
      { label: "要確認", line: 10 },
    ]);
  });

  it("detects missing/default metadata, sample leftovers, unresolved frontmatter assets, and custom NG words", () => {
    const md = [
      "---",
      'title: "新規ドキュメント"',
      'author: ""',
      'date: ""',
      "cover: true",
      'logo: "asset:missing_logo.png"',
      'confidential_mode: "strict"',
      'confidential_label: "社外秘"',
      'page_size: "A4"',
      'orientation: "landscape"',
      "---",
      "",
      "株式会社サンプル向けの ProjectX 提案資料です。",
    ].join("\n");

    const report = runPreflightCheck(md, {}, { ngWords: "projectx, 社内専用" });

    expect(report.summary).toEqual({
      cover: true,
      backCover: true,
      toc: true,
      logoStatus: "missing",
      coverImageStatus: "none",
      confidentialLabel: "社外秘",
      pageLabel: "A4 横",
    });

    const labels = report.issues.map((i) => `${i.category}:${i.label}`);
    expect(labels).toContain("metadata:タイトル未設定");
    expect(labels).toContain("metadata:作成者未設定");
    expect(labels).toContain("metadata:日付未設定");
    expect(labels).toContain("unresolved-asset:ロゴ画像");
    expect(labels).toContain("metadata:サンプル仮値");
    expect(labels).toContain("ng-word:projectx");
  });

  it("returns zero issues for a clean, complete document", () => {
    const md = [
      "---",
      'title: "本番運用設計書"',
      'author: "インフラ運用部"',
      'date: "2026-11-28"',
      "cover: true",
      'logo: "asset:shared_logo"',
      "---",
      "",
      "# 1. 方針",
      "すべての項目が確定しています。",
    ].join("\n");

    const report = runPreflightCheck(
      md,
      { "asset:shared_logo": "data:image/png;base64,AAAA" },
      { ngWords: "ProjectX" }
    );

    expect(report.issues).toEqual([]);
    expect(report.summary.logoStatus).toBe("configured");
    expect(report.summary.cover).toBe(true);
    expect(report.summary.confidentialLabel).toBeNull();
  });
});
