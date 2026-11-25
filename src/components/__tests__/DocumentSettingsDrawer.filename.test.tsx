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
});
