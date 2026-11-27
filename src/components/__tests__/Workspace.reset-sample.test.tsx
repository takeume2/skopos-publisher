import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { Workspace } from "@/components/Workspace";
import { DEFAULT_FILENAME_TEMPLATE } from "@/lib/export-filename";

const mockResetToSample = vi.fn();
let mockMarkdown = "";

vi.mock("@/hooks/useIndexedDbStorage", () => ({
  useIndexedDbStorage: () => {
    const [markdown, setMarkdown] = React.useState(mockMarkdown);
    const getExpandedMarkdownForDoc = React.useCallback(async () => {
      return { title: "業務設計書", content: markdown };
    }, [markdown]);
    return {
      markdown,
      setMarkdown,
      activeDocId: "doc_1",
      documentList: [
        {
          id: "doc_1",
          title: "業務設計書",
          updatedAt: Date.now(),
          markdownBytes: 256,
          assetsBytes: 0,
          totalBytes: 256,
          assetCount: 0,
        },
      ],
      sharedAssetList: [],
      assets: {},
      saveAsset: vi.fn(),
      saveAssetsBatch: vi.fn(),
      removeAsset: vi.fn(),
      clearSharedAssets: vi.fn(),
      switchDocument: vi.fn(),
      createDocument: vi.fn(),
      deleteDocument: vi.fn(),
      deleteAllDocuments: vi.fn(),
      getExpandedMarkdownForDoc,
      prefs: {
        autoUpdate: false,
        showMarginGuides: false,
        layoutMode: "single" as const,
        isSidebarOpen: true,
        filenameTemplate: DEFAULT_FILENAME_TEMPLATE,
        skipPrintHeaderFooterNotice: false,
      },
      updatePrefs: vi.fn(),
      resetToSample: mockResetToSample,
      isLoaded: true,
      saveStatus: "saved" as const,
      storageError: null,
      clearStorageError: vi.fn(),
    };
  },
}));

vi.mock("@/components/EditorPane", () => ({
  EditorPane: () => <div data-testid="mock-editor" />,
}));

vi.mock("@/components/PagedPreviewPane", () => ({
  PagedPreviewPane: () => <div data-testid="mock-preview" />,
}));

describe("Workspace sample reset confirmation workflow (#63)", () => {
  beforeEach(() => {
    mockResetToSample.mockClear();
    mockMarkdown = `---\ntitle: "業務設計書"\ndate: "2026-11-28"\n---\n\n# 概要\n`;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("opens a confirmation dialog from sidebar before resetting to sample, supports backup export, cancel, and confirm", async () => {
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    const createObjectURLMock = vi.fn(() => "blob:backup-md");
    const revokeObjectURLMock = vi.fn();

    Object.defineProperty(URL, "createObjectURL", {
      value: createObjectURLMock,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      value: revokeObjectURLMock,
      configurable: true,
      writable: true,
    });

    let exportedFilename = "";
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      exportedFilename = this.download;
    });

    try {
      const { container } = render(<Workspace />);

      // トップバーには「サンプル復元」ボタンが存在しない
      const header = container.querySelector("header")!;
      expect(header.textContent).not.toContain("サンプル");

      // サイドバー下部のボタンを押しても即座に resetToSample は呼ばれず、確認ダイアログが表示される
      fireEvent.click(
        screen.getByRole("button", { name: "サンプルを復元（上書き）" })
      );
      expect(mockResetToSample).not.toHaveBeenCalled();
      expect(
        screen.getByText("現在の文書をサンプルで上書きしますか？")
      ).toBeTruthy();

      // キャンセルで上書きせず閉じる
      fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));
      expect(mockResetToSample).not.toHaveBeenCalled();
      expect(
        screen.queryByText("現在の文書をサンプルで上書きしますか？")
      ).toBeNull();

      // 再度開き「先に .md を保存」でバックアップ保存できる
      fireEvent.click(
        screen.getByRole("button", { name: "サンプルを復元（上書き）" })
      );
      fireEvent.click(screen.getByRole("button", { name: "先に .md を保存" }));
      await waitFor(() => {
        expect(exportedFilename).toBe("20261128_業務設計書.md");
      });
      expect(mockResetToSample).not.toHaveBeenCalled();

      // 「サンプルを復元する」確定で初めて resetToSample が実行される
      fireEvent.click(
        screen.getByRole("button", { name: "サンプルを復元する" })
      );
      expect(mockResetToSample).toHaveBeenCalledTimes(1);
      expect(
        screen.queryByText("現在の文書をサンプルで上書きしますか？")
      ).toBeNull();
    } finally {
      Object.defineProperty(URL, "createObjectURL", {
        value: originalCreateObjectURL,
        configurable: true,
        writable: true,
      });
      Object.defineProperty(URL, "revokeObjectURL", {
        value: originalRevokeObjectURL,
        configurable: true,
        writable: true,
      });
    }
  });
});
