import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { DocumentSettingsDrawer } from "@/components/DocumentSettingsDrawer";
import { DEFAULT_FILENAME_TEMPLATE } from "@/lib/export-filename";
import { DEFAULT_FRONTMATTER } from "@/types/document";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("DocumentSettingsDrawer export filename section (#10)", () => {
  it("renders PDF/MD filename previews, switches presets, inserts variable chips, and resets to default", () => {
    const onChangeFilenameTemplate = vi.fn();

    const { rerender } = render(
      <DocumentSettingsDrawer
        isOpen={true}
        onClose={vi.fn()}
        frontmatter={DEFAULT_FRONTMATTER}
        assets={{}}
        filenameTemplate={DEFAULT_FILENAME_TEMPLATE}
        onChangeFilenameTemplate={onChangeFilenameTemplate}
        exportFilenamePreview={{
          pdf: "20261126_文書タイトル_CONFIDENTIAL.pdf",
          md: "20261126_文書タイトル_CONFIDENTIAL.md",
        }}
        onChangeFrontmatter={vi.fn()}
        onSaveAsset={vi.fn().mockResolvedValue(undefined)}
        onRemoveAsset={vi.fn().mockResolvedValue(undefined)}
      />
    );

    expect(
      screen.getByTestId("export-filename-preview-pdf").textContent
    ).toBe("20261126_文書タイトル_CONFIDENTIAL.pdf");
    expect(
      screen.getByTestId("export-filename-preview-md").textContent
    ).toBe("20261126_文書タイトル_CONFIDENTIAL.md");

    // プリセット切替
    fireEvent.click(screen.getByRole("button", { name: /タイトルのみ/ }));
    expect(onChangeFilenameTemplate).toHaveBeenCalledWith("{title}");

    // 変数チップ挿入（ヘッダー・フッター欄にも同名チップがあるため先頭＝出力ファイル名欄を選択）
    onChangeFilenameTemplate.mockClear();
    fireEvent.click(
      screen.getAllByRole("button", { name: "{recipient}" })[0]
    );
    expect(onChangeFilenameTemplate).toHaveBeenCalledWith(
      "{date}_{title}_{confidential}_{recipient}"
    );

    // カスタムテンプレート表示と標準に戻す
    rerender(
      <DocumentSettingsDrawer
        isOpen={true}
        onClose={vi.fn()}
        frontmatter={DEFAULT_FRONTMATTER}
        assets={{}}
        filenameTemplate="{date}-{recipient}-{title}"
        onChangeFilenameTemplate={onChangeFilenameTemplate}
        exportFilenamePreview={{
          pdf: "20261126-文書タイトル.pdf",
          md: "20261126-文書タイトル.md",
        }}
        onChangeFrontmatter={vi.fn()}
        onSaveAsset={vi.fn().mockResolvedValue(undefined)}
        onRemoveAsset={vi.fn().mockResolvedValue(undefined)}
      />
    );

    expect(screen.getByText("カスタム")).toBeTruthy();
    onChangeFilenameTemplate.mockClear();
    const resetButtons = screen.getAllByRole("button", { name: "標準に戻す" });
    fireEvent.click(resetButtons[0]);
    expect(onChangeFilenameTemplate).toHaveBeenCalledWith(
      DEFAULT_FILENAME_TEMPLATE
    );
  });

  it("copies PDF and MD filenames to clipboard when copy buttons are clicked", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    render(
      <DocumentSettingsDrawer
        isOpen={true}
        onClose={vi.fn()}
        frontmatter={DEFAULT_FRONTMATTER}
        assets={{}}
        filenameTemplate={DEFAULT_FILENAME_TEMPLATE}
        onChangeFilenameTemplate={vi.fn()}
        exportFilenamePreview={{
          pdf: "20261126_報告書_CONFIDENTIAL.pdf",
          md: "20261126_報告書_CONFIDENTIAL.md",
        }}
        onChangeFrontmatter={vi.fn()}
        onSaveAsset={vi.fn().mockResolvedValue(undefined)}
        onRemoveAsset={vi.fn().mockResolvedValue(undefined)}
      />
    );

    fireEvent.click(screen.getByLabelText("PDFファイル名をコピー"));
    expect(writeText).toHaveBeenCalledWith("20261126_報告書_CONFIDENTIAL.pdf");

    fireEvent.click(screen.getByLabelText("MDファイル名をコピー"));
    expect(writeText).toHaveBeenCalledWith("20261126_報告書_CONFIDENTIAL.md");
  });

  it("renders all 6 settings sections as native open <details>/<summary> accordions and applies auto-sizing class to textareas", () => {
    const { container } = render(
      <DocumentSettingsDrawer
        isOpen={true}
        onClose={vi.fn()}
        frontmatter={{ ...DEFAULT_FRONTMATTER, back_cover: true }}
        assets={{}}
        filenameTemplate={DEFAULT_FILENAME_TEMPLATE}
        onChangeFilenameTemplate={vi.fn()}
        onChangeFrontmatter={vi.fn()}
        onSaveAsset={vi.fn().mockResolvedValue(undefined)}
        onRemoveAsset={vi.fn().mockResolvedValue(undefined)}
      />
    );

    const detailsList = Array.from(
      container.querySelectorAll<HTMLDetailsElement>("details.mdpub-settings-details")
    );
    expect(detailsList).toHaveLength(6);
    expect(detailsList.every((el) => el.open)).toBe(true);

    const summaries = detailsList.map(
      (el) => el.querySelector("summary")?.textContent?.trim() ?? ""
    );
    expect(summaries).toEqual([
      "基本・用紙設定",
      "機密表示・透かし設定",
      "出力ファイル名",
      "デザインテーマ & カスタマイズ",
      "ページ構成（表紙・目次・奥付）",
      "ヘッダー・フッター・ロゴ",
    ]);

    // Native <summary> click toggles <details> open state
    const firstDetails = detailsList[0];
    const firstSummary = firstDetails.querySelector("summary")!;
    fireEvent.click(firstSummary);
    expect(firstDetails.open).toBe(false);
    fireEvent.click(firstSummary);
    expect(firstDetails.open).toBe(true);

    // Title and back_cover_text textareas carry the field-sizing helper class
    const textareas = Array.from(container.querySelectorAll("textarea"));
    expect(textareas).toHaveLength(2);
    expect(
      textareas.every((el) => el.classList.contains("mdpub-auto-textarea"))
    ).toBe(true);
  });
});
