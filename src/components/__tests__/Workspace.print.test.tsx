import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { Workspace } from "@/components/Workspace";

const ORIGINAL_APP_TITLE = "Skopos Publisher — Markdown DTP & PDF Publishing";

let mockMarkdown = "";
const mockSetMarkdown = vi.fn((next: string) => {
  mockMarkdown = next;
});

vi.mock("@/hooks/useIndexedDbStorage", () => ({
  useIndexedDbStorage: () => {
    const [markdown, setMarkdownState] = React.useState(mockMarkdown);
    const setMarkdown = React.useCallback((next: string) => {
      mockSetMarkdown(next);
      setMarkdownState(next);
    }, []);
    return {
      markdown,
      setMarkdown,
      activeDocId: "doc_1",
      documentList: [
        {
          id: "doc_1",
          title: "テスト文書",
          updatedAt: Date.now(),
          markdownBytes: 100,
          assetsBytes: 0,
          totalBytes: 100,
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
      getExpandedMarkdownForDoc: vi.fn(),
      prefs: {
        autoUpdate: false,
        showMarginGuides: false,
        layoutMode: "single" as const,
        isSidebarOpen: false,
      },
      updatePrefs: vi.fn(),
      resetToSample: vi.fn(),
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

describe("Workspace PDF print document.title handling", () => {
  beforeEach(() => {
    document.title = ORIGINAL_APP_TITLE;
    mockMarkdown = `---\ntitle: "セキュリティ監査報告書\\n2026年度版"\n---\n\n# 概要\n`;
    mockSetMarkdown.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    document.title = ORIGINAL_APP_TITLE;
  });

  it("sets document.title before window.print and restores original title on afterprint", () => {
    let titleDuringPrint = "";
    const printSpy = vi.spyOn(window, "print").mockImplementation(() => {
      // ブラウザと同様に beforeprint が重複発火しても元のタイトルが壊れないことを検証
      window.dispatchEvent(new Event("beforeprint"));
      titleDuringPrint = document.title;
    });

    render(<Workspace />);

    fireEvent.click(screen.getByRole("button", { name: "PDF出力 / 印刷" }));

    expect(printSpy).toHaveBeenCalledTimes(1);
    expect(titleDuringPrint).toBe("セキュリティ監査報告書2026年度版");
    expect(document.title).toBe("セキュリティ監査報告書2026年度版");

    window.dispatchEvent(new Event("afterprint"));
    expect(document.title).toBe(ORIGINAL_APP_TITLE);
  });

  it("handles browser-initiated printing via beforeprint and afterprint events", () => {
    mockMarkdown = "# 導入ガイドライン\n\n本文";

    render(<Workspace />);

    expect(document.title).toBe(ORIGINAL_APP_TITLE);

    window.dispatchEvent(new Event("beforeprint"));
    expect(document.title).toBe("導入ガイドライン");

    window.dispatchEvent(new Event("afterprint"));
    expect(document.title).toBe(ORIGINAL_APP_TITLE);
  });

  it("restores original title if window.print throws an error", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(window, "print").mockImplementation(() => {
      throw new Error("print blocked");
    });

    render(<Workspace />);

    fireEvent.click(screen.getByRole("button", { name: "PDF出力 / 印刷" }));

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(document.title).toBe(ORIGINAL_APP_TITLE);
  });

  it("restores original title on unmount if afterprint never fired", () => {
    vi.spyOn(window, "print").mockImplementation(() => {});

    const { unmount } = render(<Workspace />);

    fireEvent.click(screen.getByRole("button", { name: "PDF出力 / 印刷" }));
    expect(document.title).toBe("セキュリティ監査報告書2026年度版");

    unmount();
    expect(document.title).toBe(ORIGINAL_APP_TITLE);
  });

  it("uses imported markdown filename as fallback title when title and headings are missing", async () => {
    mockMarkdown = "初期テキスト";
    let titleDuringPrint = "";
    vi.spyOn(window, "print").mockImplementation(() => {
      titleDuringPrint = document.title;
    });

    const { container } = render(<Workspace />);

    const fileInput = container.querySelector(
      'input[type="file"][accept=".md,.markdown,.txt"]'
    ) as HTMLInputElement;

    const importedFile = new File(["見出しのないメモ本文のみ"], "quarterly-memo.md", {
      type: "text/markdown",
    });
    Object.defineProperty(importedFile, "text", {
      value: () => Promise.resolve("見出しのないメモ本文のみ"),
    });

    fireEvent.change(fileInput, { target: { files: [importedFile] } });

    await vi.waitFor(() => {
      expect(mockSetMarkdown).toHaveBeenCalledWith("見出しのないメモ本文のみ");
    });

    fireEvent.click(screen.getByRole("button", { name: "PDF出力 / 印刷" }));
    expect(titleDuringPrint).toBe("quarterly-memo");

    window.dispatchEvent(new Event("afterprint"));
    expect(document.title).toBe(ORIGINAL_APP_TITLE);
  });
});
