import { describe, it, expect } from "vitest";
import {
  parseCardColumnsAttr,
  parseCardItem,
  resolveCardColumns,
} from "@/lib/cards";

describe("cards helper", () => {
  it("parses pipe-delimited card items with 1 to 4 fields", () => {
    expect(parseCardItem("検出総数 | 42件 | 前回比 -8件")).toEqual({
      label: "検出総数",
      value: "42件",
      note: "前回比 -8件",
      accentKind: null,
      customColor: null,
    });

    expect(parseCardItem("適合率 | 92.5%")).toEqual({
      label: "適合率",
      value: "92.5%",
      note: "",
      accentKind: null,
      customColor: null,
    });

    expect(parseCardItem("ラベルのみ")).toEqual({
      label: "ラベルのみ",
      value: "",
      note: "",
      accentKind: null,
      customColor: null,
    });

    expect(parseCardItem("適合率 | 92.5% | | success")).toEqual({
      label: "適合率",
      value: "92.5%",
      note: "",
      accentKind: "success",
      customColor: null,
    });
  });

  it("infers semantic accents from labels and supports explicit keywords or validated hex colors", () => {
    expect(parseCardItem("Critical | 3件 | 要対応")?.accentKind).toBe(
      "critical"
    );
    expect(parseCardItem("重大 (Critical) | 3件")?.accentKind).toBe("critical");
    expect(parseCardItem("高速処理 | 12ms")?.accentKind).toBeNull();
    expect(parseCardItem("カスタム | 99% | 目標達成 | #0af")).toEqual({
      label: "カスタム",
      value: "99%",
      note: "目標達成",
      accentKind: null,
      customColor: "#00aaff",
    });

    // 不正な CSS インジェクション値は無視される
    const injected = parseCardItem(
      "攻撃 | 1件 | 説明 | red;background:url(evil)"
    );
    expect(injected?.customColor).toBeNull();
    expect(injected?.accentKind).toBeNull();

    // none で自動アクセントを明示解除できる
    expect(parseCardItem("Critical | 0件 | なし | none")?.accentKind).toBe(
      "none"
    );
  });

  it("resolves 2 to 4 columns automatically or via explicit column override", () => {
    expect(parseCardColumnsAttr("2")).toBe(2);
    expect(parseCardColumnsAttr("3")).toBe(3);
    expect(parseCardColumnsAttr("4")).toBe(4);
    expect(parseCardColumnsAttr("1")).toBeNull();
    expect(parseCardColumnsAttr("5")).toBeNull();
    expect(parseCardColumnsAttr("abc")).toBeNull();

    expect(resolveCardColumns(1)).toBe(2);
    expect(resolveCardColumns(2)).toBe(2);
    expect(resolveCardColumns(3)).toBe(3);
    expect(resolveCardColumns(4)).toBe(4);
    expect(resolveCardColumns(5)).toBe(3);
    expect(resolveCardColumns(6)).toBe(3);
    expect(resolveCardColumns(7)).toBe(4);
    expect(resolveCardColumns(8)).toBe(4);

    expect(resolveCardColumns(4, 2)).toBe(2);
    expect(resolveCardColumns(2, 4)).toBe(4);
  });

  it("returns null for blank items", () => {
    expect(parseCardItem("")).toBeNull();
    expect(parseCardItem("   |  |  ")).toBeNull();
  });
});
