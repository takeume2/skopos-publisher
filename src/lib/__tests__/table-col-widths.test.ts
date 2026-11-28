import { describe, it, expect } from "vitest";
import {
  adjustAdjacentColumnWidths,
  buildColumnWidthPresets,
  computeColWidthsDirectiveEdit,
  detectTableAtCursorLine,
  formatColWidthsDirective,
  normalizeColumnWidths,
  parseColWidthsSpec,
  resolveTableColumnWidths,
  updateSingleColumnWidth,
} from "@/lib/table-col-widths";

describe("table-col-widths utilities (#62)", () => {
  it("parses percentage, comma, space, and colon-separated specs and rejects unsafe or invalid tokens", () => {
    expect(parseColWidthsSpec("15, 30, 55")).toEqual([15, 30, 55]);
    expect(parseColWidthsSpec("15% 30% 55%")).toEqual([15, 30, 55]);
    expect(parseColWidthsSpec("1:2:4")).toEqual([1, 2, 4]);
    expect(parseColWidthsSpec("12.5, 37.5, 50")).toEqual([12.5, 37.5, 50]);

    expect(parseColWidthsSpec("")).toBeNull();
    expect(parseColWidthsSpec("0, 50, 50")).toBeNull();
    expect(parseColWidthsSpec("-10, 60, 50")).toBeNull();
    expect(parseColWidthsSpec("20, expression(1), 30")).toBeNull();
    expect(parseColWidthsSpec("20px, 80px")).toBeNull();
  });

  it("normalizes ratios and mismatched column counts to integer percentages summing to 100 with min-width clamping", () => {
    expect(normalizeColumnWidths([1, 2, 4], 3)).toEqual([14, 29, 57]);
    expect(resolveTableColumnWidths("15, 25", 3)).toEqual([15, 25, 60]);
    expect(resolveTableColumnWidths("10, 20, 30, 40", 2)).toEqual([33, 67]);

    // Extreme ratio still enforces minimum column width (5%) and sums to 100
    const clamped = normalizeColumnWidths([1, 999], 2);
    expect(clamped[0]).toBeGreaterThanOrEqual(5);
    expect(clamped[0] + clamped[1]).toBe(100);
  });

  it("generates presets summing to 100% for 2, 3, and 4+ column tables", () => {
    for (const cols of [2, 3, 4, 5]) {
      const presets = buildColumnWidthPresets(cols);
      expect(presets.length).toBeGreaterThanOrEqual(3);
      for (const preset of presets) {
        expect(preset.widths).toHaveLength(cols);
        expect(preset.widths.reduce((a, b) => a + b, 0)).toBe(100);
      }
    }
    expect(buildColumnWidthPresets(1)).toEqual([]);
  });

  it("adjusts adjacent columns and single column widths while preserving 100% sum and min bounds", () => {
    expect(adjustAdjacentColumnWidths([20, 30, 50], 0, 10)).toEqual([30, 20, 50]);
    // Clamped so right neighbor stays >= 5
    expect(adjustAdjacentColumnWidths([20, 30, 50], 0, 100)).toEqual([45, 5, 50]);
    // Clamped so left neighbor stays >= 5
    expect(adjustAdjacentColumnWidths([20, 30, 50], 0, -100)).toEqual([5, 45, 50]);

    const updated = updateSingleColumnWidth([20, 30, 50], 0, 40);
    expect(updated[0]).toBe(40);
    expect(updated.reduce((a, b) => a + b, 0)).toBe(100);
    expect(updated.every((w) => w >= 5)).toBe(true);
  });

  it("detects GFM table at cursor line including existing col-widths directive while skipping frontmatter and code fences", () => {
    const md = [
      "---",
      'title: "テスト"',
      "---",
      "",
      "```markdown",
      "| Code | Table |",
      "| --- | --- |",
      "| a | b |",
      "```",
      "",
      "<!-- col-widths: 15, 30, 55 -->",
      "| **ID** | `項目名` | 説明 |",
      "| :--- | :--- | :--- |",
      "| 1 | 認証 | 詳細テキスト |",
      "",
      "通常段落",
    ].join("\n");

    // Inside fenced code block -> null
    expect(detectTableAtCursorLine(md, 6)).toBeNull();
    // Outside table -> null
    expect(detectTableAtCursorLine(md, 16)).toBeNull();

    // On directive line (11) or body row (14) -> detects table
    const ctx = detectTableAtCursorLine(md, 14);
    expect(ctx).toEqual({
      headers: ["ID", "項目名", "説明"],
      columnCount: 3,
      tableStartLine: 12,
      tableEndLine: 14,
      directiveLine: 11,
      widths: [15, 30, 55],
    });
    expect(detectTableAtCursorLine(md, 11)?.tableStartLine).toBe(12);
  });

  it("computes atomic insert, update, and delete edits for col-widths directive", () => {
    const baseMd = [
      "# 見出し",
      "",
      "| ID | 項目名 | 説明 |",
      "| --- | --- | --- |",
      "| 1 | A | B |",
    ].join("\n");

    const ctxNoDir = detectTableAtCursorLine(baseMd, 4)!;
    expect(ctxNoDir.directiveLine).toBeNull();

    // Insert above table
    const insertEdit = computeColWidthsDirectiveEdit(baseMd, ctxNoDir, [15, 30, 55])!;
    const afterInsert =
      baseMd.slice(0, insertEdit.from) + insertEdit.insert + baseMd.slice(insertEdit.to);
    expect(afterInsert).toContain(
      `${formatColWidthsDirective([15, 30, 55])}\n| ID | 項目名 | 説明 |`
    );

    // Update existing directive in place
    const ctxWithDir = detectTableAtCursorLine(afterInsert, 5)!;
    expect(ctxWithDir.directiveLine).toBe(3);
    const updateEdit = computeColWidthsDirectiveEdit(afterInsert, ctxWithDir, [20, 40, 40])!;
    const afterUpdate =
      afterInsert.slice(0, updateEdit.from) +
      updateEdit.insert +
      afterInsert.slice(updateEdit.to);
    expect(afterUpdate).toContain("<!-- col-widths: 20, 40, 40 -->\n| ID | 項目名 | 説明 |");

    // Reset to auto removes directive line cleanly
    const ctxUpdated = detectTableAtCursorLine(afterUpdate, 5)!;
    const deleteEdit = computeColWidthsDirectiveEdit(afterUpdate, ctxUpdated, null)!;
    const afterDelete =
      afterUpdate.slice(0, deleteEdit.from) +
      deleteEdit.insert +
      afterUpdate.slice(deleteEdit.to);
    expect(afterDelete).toBe(baseMd);
  });
});
