import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { EditorJumpRequest } from "@/components/EditorPane";
import { Workspace } from "@/components/Workspace";

let mockMarkdown = "";
let capturedOnChange: ((next: string) => void) | null = null;
let capturedJumpRequest: EditorJumpRequest | null | undefined = null;

vi.mock("@/hooks/useIndexedDbStorage", () => ({
  useIndexedDbStorage: () => {
    const [markdown, setMarkdown] = React.useState(mockMarkdown);
    return {
      markdown,
      setMarkdown,
      activeDocId: "doc_1",
      documentList: [
        {
          id: "doc_1",
          title: "アウトライン検証文書",
          updatedAt: Date.now(),
          markdownBytes: 200,
          assetsBytes: 0,
          totalBytes: 200,
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
        isSidebarOpen: true,
        filenameTemplate: "{date}_{title}_{confidential}",
        skipPrintHeaderFooterNotice: false,
        enablePreflightCheck: true,
        preflightNgWords: "",
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
  EditorPane: ({
    value,
    onChange,
    jumpRequest,
  }: {
    value: string;
    onChange: (next: string) => void;
    jumpRequest?: EditorJumpRequest | null;
  }) => {
    capturedOnChange = onChange;
    capturedJumpRequest = jumpRequest;
    return (
      <div
        data-testid="mock-editor"
        data-jump-line={jumpRequest?.line ?? ""}
        data-jump-id={jumpRequest?.requestId ?? ""}
      >
        {value}
      </div>
    );
  },
}));

vi.mock("@/components/PagedPreviewPane", () => ({
  PagedPreviewPane: () => <div data-testid="mock-preview" />,
}));

describe("Workspace heading outline integration (#34)", () => {
  beforeEach(() => {
    mockMarkdown = [
      "---",
      'title: "アウトライン検証文書"',
      "---",
      "",
      "# 1. はじめに",
      "本文",
      "## 1.1 背景",
      "本文",
    ].join("\n");
    capturedOnChange = null;
    capturedJumpRequest = null;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("updates outline live on heading add/edit/delete and jumps editor on click", () => {
    render(<Workspace />);

    // 同じサイドバー領域で見出し（アウトライン）タブへ切り替え
    fireEvent.click(screen.getByRole("tab", { name: /見出し/ }));

    expect(screen.getByRole("button", { name: /1\. はじめに/ })).toBeTruthy();
    const sectionBtn = screen.getByRole("button", { name: /1\.1 背景/ });
    expect(sectionBtn).toBeTruthy();

    // クリックするとエディタへ行ジャンプ要求が渡される (7行目)
    fireEvent.click(sectionBtn);
    expect(capturedJumpRequest?.line).toBe(7);

    // 編集中に見出しを変更・追加・削除するとリアルタイムに反映される
    React.act(() => {
      capturedOnChange?.(
        [
          "---",
          'title: "アウトライン検証文書"',
          "---",
          "",
          "# 1. 改訂版はじめに",
          "### 1.1.1 新規サブセクション",
        ].join("\n")
      );
    });

    expect(screen.getByRole("button", { name: /1\. 改訂版はじめに/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /1\.1 背景/ })).toBeNull();
    const addedBtn = screen.getByRole("button", {
      name: /1\.1\.1 新規サブセクション/,
    });
    expect(addedBtn).toBeTruthy();

    fireEvent.click(addedBtn);
    expect(capturedJumpRequest?.line).toBe(6);
  });

  it("switches from preview-only mode to split view and jumps when an outline heading is clicked", () => {
    render(<Workspace />);

    // プレビューのみ表示へ切り替え（エディタは非表示）
    fireEvent.click(screen.getByRole("button", { name: "プレビューのみ" }));
    expect(screen.queryByTestId("mock-editor")).toBeNull();

    // アウトラインから見出しをクリックすると分割表示へ復帰して該当行へジャンプする
    fireEvent.click(screen.getByRole("tab", { name: /見出し/ }));
    fireEvent.click(screen.getByRole("button", { name: /1\.1 背景/ }));

    const editor = screen.getByTestId("mock-editor");
    expect(editor).toBeTruthy();
    expect(editor.getAttribute("data-jump-line")).toBe("7");
    expect(screen.getByTestId("mock-preview")).toBeTruthy();
  });
});
