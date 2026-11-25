import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { FormatToolbar, type FormatSnippet } from "@/components/FormatToolbar";

describe("FormatToolbar callout buttons", () => {
  afterEach(() => {
    cleanup();
  });

  it("inserts unified Katakana default titles for all 5 callout buttons", () => {
    const inserted: FormatSnippet[] = [];
    const onInsert = vi.fn((snippet: FormatSnippet) => {
      inserted.push(snippet);
    });

    render(<FormatToolbar onInsert={onInsert} />);

    const expected: Array<{ title: string; before: string }> = [
      { title: "コールアウト [!NOTE]", before: "> [!NOTE] ノート\n> " },
      { title: "コールアウト [!WARNING]", before: "> [!WARNING] ワーニング\n> " },
      { title: "コールアウト [!CAUTION]", before: "> [!CAUTION] コーション\n> " },
      { title: "コールアウト [!SUMMARY]", before: "> [!SUMMARY] サマリー\n> " },
      { title: "コールアウト [!SUCCESS]", before: "> [!SUCCESS] サクセス\n> " },
    ];

    for (const item of expected) {
      const button = screen.getByTitle(item.title);
      fireEvent.click(button);
    }

    expect(onInsert).toHaveBeenCalledTimes(expected.length);
    expect(inserted.map((s) => s.before)).toEqual(
      expected.map((e) => e.before)
    );
    expect(inserted.every((s) => s.block === true)).toBe(true);
  });
});
