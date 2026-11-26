import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { Workspace } from "@/components/Workspace";
import {
  DEFAULT_FILENAME_TEMPLATE,
  formatDateYYYYMMDD,
} from "@/lib/export-filename";

const ORIGINAL_APP_TITLE = "Skopos Publisher — Markdown DTP & PDF Publishing";

let mockMarkdown = "";
let mockFilenameTemplate = DEFAULT_FILENAME_TEMPLATE;
const mockSetMarkdown = vi.fn((next: string) => {
  mockMarkdown = next;
});

const mockSaveAsset = vi.fn().mockResolvedValue(undefined);
const mockSaveAssetsBatch = vi.fn().mockResolvedValue(undefined);
let mockAssets: Record<string, string> = {};
let latestPreviewProps: {
  onDropFileOnPlaceholder?: (assetKey: string, file: File) => void | Promise<void>;
  onDropFilesOnPreview?: (files: File[]) => void | Promise<void>;
} = {};

vi.mock("@/lib/image-processing", async () => {
  const actual = await vi.importActual<typeof import("@/lib/image-processing")>(
    "@/lib/image-processing"
  );
  return {
    ...actual,
    processUploadedImageFile: vi.fn(async (file: File) => ({
      dataUrl: `data:image/png;base64,MOCK_${file.name}`,
      resized: false,
      originalBytes: file.size || 10,
      finalBytes: 24,
    })),
  };
});

vi.mock("@/hooks/useIndexedDbStorage", () => ({
  useIndexedDbStorage: () => {
    const [markdown, setMarkdownState] = React.useState(mockMarkdown);
    const [assets, setAssetsState] = React.useState<Record<string, string>>(
      mockAssets
    );
    const [filenameTemplate, setFilenameTemplate] = React.useState(
      mockFilenameTemplate
    );
    const setMarkdown = React.useCallback((next: string) => {
      mockSetMarkdown(next);
      setMarkdownState(next);
    }, []);
    const saveAsset = React.useCallback(async (assetId: string, dataUrl: string) => {
      await mockSaveAsset(assetId, dataUrl);
      setAssetsState((prev) => ({ ...prev, [assetId]: dataUrl }));
    }, []);
    const saveAssetsBatch = React.useCallback(
      async (entries: Record<string, string>) => {
        await mockSaveAssetsBatch(entries);
        setAssetsState((prev) => ({ ...prev, ...entries }));
      },
      []
    );
    const getExpandedMarkdownForDoc = React.useCallback(async () => {
      return { title: "テスト文書", content: markdown };
    }, [markdown]);
    const updatePrefs = React.useCallback(
      async (patch: { filenameTemplate?: string }) => {
        if (typeof patch.filenameTemplate === "string") {
          setFilenameTemplate(patch.filenameTemplate);
        }
      },
      []
    );
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
      assets,
      saveAsset,
      saveAssetsBatch,
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
        isSidebarOpen: false,
        filenameTemplate,
      },
      updatePrefs,
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
  PagedPreviewPane: (props: {
    onDropFileOnPlaceholder?: (assetKey: string, file: File) => void | Promise<void>;
    onDropFilesOnPreview?: (files: File[]) => void | Promise<void>;
  }) => {
    latestPreviewProps = props;
    return <div data-testid="mock-preview" />;
  },
}));

describe("Workspace PDF print document.title & export filename handling (#19, #10)", () => {
  beforeEach(() => {
    document.title = ORIGINAL_APP_TITLE;
    mockFilenameTemplate = DEFAULT_FILENAME_TEMPLATE;
    mockAssets = {};
    latestPreviewProps = {};
    mockMarkdown = `---\ntitle: "セキュリティ監査報告書\\n2026年度版"\ndate: "2026-11-14"\nconfidential_mode: "strict"\nconfidential_label: "CONFIDENTIAL"\n---\n\n# 概要\n`;
    mockSetMarkdown.mockClear();
    mockSaveAsset.mockClear();
    mockSaveAssetsBatch.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    document.title = ORIGINAL_APP_TITLE;
  });

  it("sets generated filename basename to document.title before window.print and restores original title on afterprint", () => {
    let titleDuringPrint = "";
    const printSpy = vi.spyOn(window, "print").mockImplementation(() => {
      // ブラウザと同様に beforeprint が重複発火しても元のタイトルが壊れないことを検証
      window.dispatchEvent(new Event("beforeprint"));
      titleDuringPrint = document.title;
    });

    render(<Workspace />);

    fireEvent.click(screen.getByRole("button", { name: "PDF出力 / 印刷" }));

    expect(printSpy).toHaveBeenCalledTimes(1);
    expect(titleDuringPrint).toBe(
      "20261114_セキュリティ監査報告書2026年度版_CONFIDENTIAL"
    );
    expect(document.title).toBe(
      "20261114_セキュリティ監査報告書2026年度版_CONFIDENTIAL"
    );

    window.dispatchEvent(new Event("afterprint"));
    expect(document.title).toBe(ORIGINAL_APP_TITLE);
  });

  it("handles browser-initiated printing via beforeprint and afterprint events", () => {
    mockMarkdown = "# 導入ガイドライン\n\n本文";
    const today = formatDateYYYYMMDD(new Date());

    render(<Workspace />);

    expect(document.title).toBe(ORIGINAL_APP_TITLE);

    window.dispatchEvent(new Event("beforeprint"));
    expect(document.title).toBe(`${today}_導入ガイドライン`);

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
    expect(document.title).toBe(
      "20261114_セキュリティ監査報告書2026年度版_CONFIDENTIAL"
    );

    unmount();
    expect(document.title).toBe(ORIGINAL_APP_TITLE);
  });

  it("uses imported markdown filename as fallback title when title and headings are missing", async () => {
    mockMarkdown = "初期テキスト";
    const today = formatDateYYYYMMDD(new Date());
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
    expect(titleDuringPrint).toBe(`${today}_quarterly-memo`);

    window.dispatchEvent(new Event("afterprint"));
    expect(document.title).toBe(ORIGINAL_APP_TITLE);
  });

  it("applies the generated filename rule to .md export downloads and reflects template preset changes (#10)", async () => {
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    const createObjectURLMock = vi.fn(() => "blob:mock-md");
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

    let capturedDownload = "";
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      capturedDownload = this.download;
    });

    try {
      render(<Workspace />);

      // 標準プリセットでの .md 保存
      fireEvent.click(screen.getByRole("button", { name: ".md保存" }));
      await waitFor(() => {
        expect(capturedDownload).toBe(
          "20261114_セキュリティ監査報告書2026年度版_CONFIDENTIAL.md"
        );
      });

      // 設定ドロワーで「タイトルのみ」プリセットへ切り替えて再保存
      fireEvent.click(screen.getByRole("button", { name: /タイトルのみ/ }));
      fireEvent.click(screen.getByRole("button", { name: ".md保存" }));
      await waitFor(() => {
        expect(capturedDownload).toBe("セキュリティ監査報告書2026年度版.md");
      });

      expect(createObjectURLMock).toHaveBeenCalledTimes(2);
      expect(revokeObjectURLMock).toHaveBeenCalledTimes(2);
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

  it('sets closedby="any" on the modal <dialog> for native light-dismiss (#56)', () => {
    const { container } = render(<Workspace />);
    const dialog = container.querySelector("dialog.mdpub-dialog");
    expect(dialog).toBeTruthy();
    expect(dialog?.getAttribute("closedby")).toBe("any");
  });

  it("shows a warning dialog before printing when unresolved asset: images exist, and allows cancel or proceed (#25)", () => {
    mockMarkdown = `---\ntitle: "未解決画像テスト"\ndate: "2026-11-26"\n---\n\n![図1](asset:diagram.png)\n\n![図2](asset:chart.png)\n![図2再掲](asset:chart.png)\n`;
    const printSpy = vi.spyOn(window, "print").mockImplementation(() => {});

    render(<Workspace />);

    fireEvent.click(screen.getByRole("button", { name: "PDF出力 / 印刷" }));

    // 即時印刷せず警告ダイアログを表示
    expect(printSpy).not.toHaveBeenCalled();
    expect(screen.getByText("未解決の画像があります（2件）")).toBeTruthy();
    expect(screen.getByText("diagram.png")).toBeTruthy();
    expect(screen.getByText("chart.png")).toBeTruthy();
    expect(screen.getByText("×2")).toBeTruthy();

    // キャンセルで印刷せず閉じる
    fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(printSpy).not.toHaveBeenCalled();
    expect(screen.queryByText("未解決の画像があります（2件）")).toBeNull();

    // 再度押下し「このまま出力」で window.print() を実行
    fireEvent.click(screen.getByRole("button", { name: "PDF出力 / 印刷" }));
    fireEvent.click(screen.getByRole("button", { name: "このまま出力" }));
    expect(printSpy).toHaveBeenCalledTimes(1);
    expect(document.title).toBe("20261126_未解決画像テスト");
  });

  it("restores matched images in bulk on preview drop, lists unmatched filenames, and supports direct placeholder drop (#25)", async () => {
    mockMarkdown = `---\ntitle: "復元テスト"\n---\n\n![図1](asset:fig1.png)\n\n![図2](asset:fig2.png)\n`;

    render(<Workspace />);

    // 文書全体ドロップ: fig1.png のみ一致、unknown.png は不一致
    const matchedFile = new File(["img"], "fig1.png", { type: "image/png" });
    const unmatchedFile = new File(["img"], "unknown.png", { type: "image/png" });
    await latestPreviewProps.onDropFilesOnPreview?.([matchedFile, unmatchedFile]);

    await waitFor(() => {
      expect(mockSaveAssetsBatch).toHaveBeenCalledWith({
        "asset:fig1.png": "data:image/png;base64,MOCK_fig1.png",
      });
    });

    // 不一致ファイル名一覧ダイアログが表示されること
    expect(await screen.findByText("1 件の画像を復元しました")).toBeTruthy();
    expect(screen.getByText("一致しなかったファイル（1件）")).toBeTruthy();
    expect(screen.getByText("unknown.png")).toBeTruthy();

    // プレースホルダ直接ドロップ: ファイル名が異なっても fig2.png キーで登録
    const customFile = new File(["img"], "replacement.png", {
      type: "image/png",
    });
    await latestPreviewProps.onDropFileOnPlaceholder?.(
      "asset:fig2.png",
      customFile
    );

    await waitFor(() => {
      expect(mockSaveAsset).toHaveBeenCalledWith(
        "asset:fig2.png",
        "data:image/png;base64,MOCK_replacement.png"
      );
    });
  });
});
