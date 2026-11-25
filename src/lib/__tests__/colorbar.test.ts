import { describe, it, expect } from "vitest";
import {
  formatColorBarNumber,
  formatColorBarPercent,
  getContrastTextColor,
  parseColorBarSpec,
} from "@/lib/colorbar";

describe("parseColorBarSpec", () => {
  it("parses severity items with semantic colors and exact percentage widths", () => {
    const parsed = parseColorBarSpec(
      "Critical=10, High=20, Medium=30, Low=40"
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.total).toBe(100);
    expect(parsed!.segments).toHaveLength(4);

    expect(parsed!.segments[0]).toMatchObject({
      label: "Critical",
      value: 10,
      widthPercent: 10,
      displayPercent: 10,
      color: "#9f1239",
      textColor: "#ffffff",
      showInBarLabel: true,
    });
    expect(parsed!.segments[1]).toMatchObject({
      label: "High",
      value: 20,
      widthPercent: 20,
      color: "#ea580c",
    });
    expect(parsed!.segments[2]).toMatchObject({
      label: "Medium",
      value: 30,
      widthPercent: 30,
      color: "#d97706",
    });
    expect(parsed!.segments[3]).toMatchObject({
      label: "Low",
      value: 40,
      widthPercent: 40,
      color: "#16a34a",
    });
  });

  it("adjusts the last positive segment so widths sum to exactly 100%", () => {
    const parsed = parseColorBarSpec("A=1, B=1, C=1");
    expect(parsed).not.toBeNull();
    const widths = parsed!.segments.map((s) => s.widthPercent);
    expect(widths).toEqual([33.33, 33.33, 33.34]);
    const sum = widths.reduce((acc, w) => acc + w, 0);
    expect(Math.round(sum * 100) / 100).toBe(100);
    expect(parsed!.segments.map((s) => s.displayPercent)).toEqual([
      33.3, 33.3, 33.3,
    ]);
  });

  it("handles Japanese labels, zero items, narrow segments, and decimal values", () => {
    const parsed = parseColorBarSpec("緊急=0、高=0.5、中=4.5、低=5");
    expect(parsed).not.toBeNull();
    expect(parsed!.total).toBe(10);
    expect(parsed!.segments[0]).toMatchObject({
      label: "緊急",
      value: 0,
      widthPercent: 0,
      displayPercent: 0,
      color: "#9f1239",
      showInBarLabel: false,
    });
    expect(parsed!.segments[1]).toMatchObject({
      label: "高",
      value: 0.5,
      widthPercent: 5,
      displayPercent: 5,
      color: "#ea580c",
      showInBarLabel: false,
    });
    expect(parsed!.segments[2].showInBarLabel).toBe(true);
    expect(parsed!.segments[3].widthPercent).toBe(50);

    const withEqualsInLabel = parseColorBarSpec("SLA >= 99.9%=95, SLA < 99.9%=5");
    expect(withEqualsInLabel).not.toBeNull();
    expect(withEqualsInLabel!.segments[0].label).toBe("SLA >= 99.9%");
    expect(withEqualsInLabel!.segments[0].widthPercent).toBe(95);
  });

  it("handles all-zero totals gracefully without NaN", () => {
    const parsed = parseColorBarSpec("Critical=0, High=0");
    expect(parsed).not.toBeNull();
    expect(parsed!.total).toBe(0);
    expect(parsed!.segments.every((s) => s.widthPercent === 0)).toBe(true);
    expect(parsed!.segments.every((s) => s.displayPercent === 0)).toBe(true);
  });

  it("supports validated custom hex colors, contrast text colors, and rejects CSS injection colors", () => {
    const parsed = parseColorBarSpec(
      "完了=18(#0f0), 注意=2(#fef08a), 攻撃=5(red;background:url(evil))"
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.segments[0].color).toBe("#00ff00");
    expect(parsed!.segments[1].color).toBe("#fef08a");
    expect(parsed!.segments[1].textColor).toBe("#0f172a");
    // 不正な色指定はパレットへフォールバックする
    expect(parsed!.segments[2].color).toMatch(/^#[0-9a-f]{6}$/);
    expect(parsed!.segments[2].color).not.toContain("url");
  });

  it("returns null for empty or invalid specs and ignores negative entries", () => {
    expect(parseColorBarSpec("")).toBeNull();
    expect(parseColorBarSpec("invalid, foo=bar, neg=-5")).toBeNull();

    const mixed = parseColorBarSpec("Valid=10, Bad=-5, Broken=abc");
    expect(mixed).not.toBeNull();
    expect(mixed!.segments).toHaveLength(1);
    expect(mixed!.segments[0].widthPercent).toBe(100);
  });

  it("formats numbers, percentages, and contrast text colors consistently", () => {
    expect(formatColorBarNumber(10)).toBe("10");
    expect(formatColorBarNumber(12.345)).toBe("12.35");
    expect(formatColorBarPercent(33.333)).toBe("33.3%");
    expect(getContrastTextColor("#9f1239")).toBe("#ffffff");
    expect(getContrastTextColor("#fef08a")).toBe("#0f172a");
  });
});
