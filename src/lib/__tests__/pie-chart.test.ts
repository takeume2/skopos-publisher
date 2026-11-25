import { describe, it, expect } from "vitest";
import { buildSvgChart, CHART_CENTER } from "@/lib/pie-chart";

describe("buildSvgChart", () => {
  it("generates pie SVG arc paths with semantic colors and skips in-slice labels for narrow wedges", () => {
    const chart = buildSvgChart(
      "pie",
      "Critical=5, High=15, Medium=30, Low=50"
    );
    expect(chart).not.toBeNull();
    expect(chart!.kind).toBe("pie");
    expect(chart!.total).toBe(100);
    expect(chart!.slices).toHaveLength(4);

    // 5% (< 8%) はスライス内ラベル非表示、15% 以上は表示
    expect(chart!.slices[0].showLabel).toBe(false);
    expect(chart!.slices[0].color).toBe("#9f1239");
    expect(chart!.slices[0].pathD).toMatch(/^M 100 100 L 100 14 A 86 86 0 0 1 /);

    // 50% スライスは largeArcFlag=0、50%超なら largeArcFlag=1
    expect(chart!.slices[1].showLabel).toBe(true);
    expect(chart!.slices[3].color).toBe("#16a34a");
    expect(chart!.slices[3].pathD).toContain("Z");
  });

  it("generates donut arc paths with inner radius and largeArcFlag=1 for slices > 50%", () => {
    const chart = buildSvgChart("donut", "完了=75, 未着手=25", "進捗状況");
    expect(chart).not.toBeNull();
    expect(chart!.kind).toBe("donut");
    expect(chart!.title).toBe("進捗状況");
    expect(chart!.totalLabel).toBe("100");
    expect(chart!.slices).toHaveLength(2);

    // 75% スライスは外弧(86)と内弧(46)に largeArcFlag=1 を使用
    expect(chart!.slices[0].pathD).toContain("A 86 86 0 1 1");
    expect(chart!.slices[0].pathD).toContain("A 46 46 0 1 0");
    expect(chart!.slices[1].pathD).toContain("A 86 86 0 0 1");
    expect(chart!.slices[1].pathD).toContain("A 46 46 0 0 0");
  });

  it("uses full-circle representation for a single 100% positive slice", () => {
    const pie = buildSvgChart("pie", "Critical=0, Low=10");
    expect(pie).not.toBeNull();
    expect(pie!.slices).toHaveLength(1);
    expect(pie!.slices[0].isFullCircle).toBe(true);
    expect(pie!.slices[0].pathD).toBeNull();
    expect(pie!.slices[0].labelX).toBe(CHART_CENTER);
    expect(pie!.slices[0].labelY).toBe(CHART_CENTER);
    expect(pie!.segments).toHaveLength(2);

    const donut = buildSvgChart("donut", "完了=42");
    expect(donut).not.toBeNull();
    expect(donut!.slices).toHaveLength(1);
    expect(donut!.slices[0].isFullCircle).toBe(true);
    expect(donut!.slices[0].labelX).toBe(CHART_CENTER);
    expect(donut!.slices[0].labelY).toBe(34);
  });

  it("handles all-zero totals and invalid specs safely without NaN", () => {
    const zero = buildSvgChart("donut", "Critical=0, High=0");
    expect(zero).not.toBeNull();
    expect(zero!.total).toBe(0);
    expect(zero!.slices).toHaveLength(0);
    expect(zero!.segments).toHaveLength(2);

    expect(buildSvgChart("pie", "")).toBeNull();
    expect(buildSvgChart("donut", "invalid-spec")).toBeNull();
  });
});
