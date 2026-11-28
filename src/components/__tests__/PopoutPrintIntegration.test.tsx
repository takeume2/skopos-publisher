import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  act,
  waitFor,
  within,
} from "@testing-library/react";
import { DEFAULT_FILENAME_TEMPLATE } from "@/lib/export-filename";
import { PREVIEW_SESSION_STORAGE_KEY } from "@/lib/preview-sync";

const mockLoadMergedAssetsForDoc = vi.fn<
  (docId: string) => Promise<Record<string, string>>
>();

let initialMarkdown = "";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
}));

vi.mock("@/hooks/useIndexedDbStorage", async () => {
  const actual = await vi.importActual<
    typeof import("@/hooks/useIndexedDbStorage")
  >("@/hooks/useIndexedDbStorage");
  return {
    ...actual,
    loadMergedAssetsForDoc: (docId: string) =>
      mockLoadMergedAssetsForDoc(docId),
    useIndexedDbStorage: () => {
      const [markdown, setMarkdown] = React.useState(initialMarkdown);
      const [prefs, setPrefs] = React.useState({
        autoUpdate: true,
        showMarginGuides: false,
        layoutMode: "single" as "single" | "spread",
        isSidebarOpen: false,
        filenameTemplate: DEFAULT_FILENAME_TEMPLATE,
        skipPrintHeaderFooterNotice: false,
        enablePreflightCheck: true,
        preflightNgWords: "",
      });
      const updatePrefs = React.useCallback(
        async (patch: Partial<typeof prefs>) => {
          setPrefs((prev) => ({ ...prev, ...patch }));
        },
        []
      );
      return {
        markdown,
        setMarkdown,
        activeDocId: "doc_pair_1",
        documentList: [
          {
            id: "doc_pair_1",
            title: "結合テスト文書",
            updatedAt: Date.now(),
            markdownBytes: 180,
            assetsBytes: 0,
            totalBytes: 180,
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
        prefs,
        updatePrefs,
        resetToSample: vi.fn(),
        isLoaded: true,
        saveStatus: "saved" as const,
        storageError: null,
        clearStorageError: vi.fn(),
      };
    },
  };
});

vi.mock("@/components/EditorPane", () => ({
  EditorPane: (props: {
    jumpRequest?: { line: number; requestId: number; align?: "start" | "center" } | null;
  }) => (
    <div
      data-testid="parent-editor"
      data-jump-line={props.jumpRequest?.line ?? ""}
      data-jump-align={props.jumpRequest?.align ?? ""}
    />
  ),
}));

vi.mock("@/components/PagedPreviewPane", () => ({
  PagedPreviewPane: (props: {
    ref?: React.Ref<{
      isUpToDate: () => boolean;
      renderNow: () => Promise<{ ok: boolean }>;
    }>;
    headerRightExtra?: React.ReactNode;
  }) => {
    React.useImperativeHandle(props.ref, () => ({
      isUpToDate: () => true,
      renderNow: async () => ({ ok: true }),
    }));
    return (
      <div data-testid="mock-paged-preview">
        <div>{props.headerRightExtra}</div>
      </div>
    );
  },
}));

class MockBroadcastChannel {
  static instances: MockBroadcastChannel[] = [];
  name: string;
  closed = false;
  private listeners = new Set<(event: MessageEvent) => void>();

  constructor(name: string) {
    this.name = name;
    MockBroadcastChannel.instances.push(this);
  }

  addEventListener(type: string, fn: (event: MessageEvent) => void) {
    if (type === "message") this.listeners.add(fn);
  }

  removeEventListener(type: string, fn: (event: MessageEvent) => void) {
    if (type === "message") this.listeners.delete(fn);
  }

  postMessage(data: unknown) {
    if (this.closed) return;
    for (const inst of MockBroadcastChannel.instances) {
      if (inst !== this && !inst.closed && inst.name === this.name) {
        const event = { data } as MessageEvent;
        inst.listeners.forEach((fn) => fn(event));
      }
    }
  }

  close() {
    this.closed = true;
    this.listeners.clear();
  }
}

import { Workspace } from "@/components/Workspace";
import { PopoutPreview } from "@/components/PopoutPreview";

describe("Workspace + PopoutPreview paired BroadcastChannel integration (#64)", () => {
  const originalBroadcastChannel = globalThis.BroadcastChannel;

  beforeEach(() => {
    MockBroadcastChannel.instances = [];
    (globalThis as unknown as { BroadcastChannel: unknown }).BroadcastChannel =
      MockBroadcastChannel;
    window.sessionStorage.clear();
    mockLoadMergedAssetsForDoc.mockReset();
    mockLoadMergedAssetsForDoc.mockResolvedValue({});
    initialMarkdown = [
      "---",
      'title: "製品提案書"',
      'author: "鈴木花子"',
      'date: "2026-11-28"',
      "---",
      "本文に極秘プロジェクトの記述があります。",
    ].join("\n");
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    (globalThis as unknown as { BroadcastChannel: unknown }).BroadcastChannel =
      originalBroadcastChannel;
  });

  it("propagates NG words from parent drawer to popout print dialog, jumps parent editor on issue click, closes dialog before print, and syncs skip-notice back to parent drawer", async () => {
    const mockPopup = {
      closed: false,
      focus: vi.fn(),
      close: vi.fn(() => {
        mockPopup.closed = true;
      }),
    };
    const namedParentFocusSpy = vi.fn();
    window.name = "";
    const openSpy = vi.spyOn(window, "open").mockImplementation((url) => {
      if (url === "") {
        return { focus: namedParentFocusSpy } as unknown as Window;
      }
      return mockPopup as unknown as Window;
    });
    const printSpy = vi.spyOn(window, "print").mockImplementation(() => {});
    const windowFocusSpy = vi.spyOn(window, "focus").mockImplementation(() => {});

    const openerFocusSpy = vi.fn();
    const originalOpener = Object.getOwnPropertyDescriptor(window, "opener");
    Object.defineProperty(window, "opener", {
      configurable: true,
      value: { closed: false, focus: openerFocusSpy },
    });

    try {
      const parentView = render(
        <div data-testid="parent-root">
          <Workspace />
        </div>
      );
      const sessionId = window.sessionStorage.getItem(
        PREVIEW_SESSION_STORAGE_KEY
      )!;
      expect(sessionId).toBeTruthy();

      const parentScope = within(parentView.getByTestId("parent-root"));

      // 1. 親側で別ウィンドウ分離を実行し、同じ BroadcastChannel 空間へ PopoutPreview を同時マウント
      fireEvent.click(
        parentScope.getByRole("button", {
          name: "プレビューを別ウィンドウに分離",
        })
      );
      expect(parentScope.getByText("別ウィンドウ表示中")).toBeTruthy();

      const childView = render(
        <div data-testid="child-root">
          <PopoutPreview sessionId={sessionId} />
        </div>
      );
      const childScope = within(childView.getByTestId("child-root"));

      // ハンドシェイク（preview-ready ↔ sync-state）が自動完了して子に印刷ボタンが出る
      await waitFor(() => {
        expect(childScope.getByRole("button", { name: "印刷" })).toBeTruthy();
      });

      // 2. メイン画面の設定ドロワーでカスタム NG ワードを追加（BroadcastChannel で自動同期）
      const ngWordsInput = parentScope.getByLabelText(
        "カスタム NG ワード（改行・カンマ区切り）"
      );
      fireEvent.change(ngWordsInput, { target: { value: "極秘プロジェクト" } });

      // 3. 別ウィンドウ側で「印刷」をクリック → NG ワードとヘッダー／フッター注意喚起が検出される
      fireEvent.click(childScope.getByRole("button", { name: "印刷" }));
      expect(
        await childScope.findByText(/出力前プリフライトチェック（1件の確認事項）/)
      ).toBeTruthy();
      expect(printSpy).not.toHaveBeenCalled();
      expect(
        childScope.getByText(/NG ワード「極秘プロジェクト」が含まれています。/)
      ).toBeTruthy();

      // 4. 指摘行をクリック → メイン画面の EditorPane へ L6 (align=center) ジャンプが届き、子側に移動トースト表示・分離状態は維持される
      fireEvent.click(
        childScope.getByText(/NG ワード「極秘プロジェクト」が含まれています。/)
      );
      await waitFor(() => {
        expect(
          parentScope.getByTestId("parent-editor").getAttribute("data-jump-line")
        ).toBe("6");
        expect(
          parentScope.getByTestId("parent-editor").getAttribute("data-jump-align")
        ).toBe("center");
      });
      expect(openerFocusSpy).toHaveBeenCalledTimes(1);
      expect(openSpy).toHaveBeenCalledWith("", `skopos_editor_${sessionId}`);
      expect(namedParentFocusSpy).toHaveBeenCalledTimes(1);
      expect(windowFocusSpy).toHaveBeenCalled();
      expect(parentScope.getByText("別ウィンドウ表示中")).toBeTruthy();
      expect(childScope.getByRole("status").textContent).toContain("L6");
      expect(
        childScope.getByRole("button", { name: "プレビューを閉じてエディタへ戻る" })
      ).toBeTruthy();

      // 5. 再度別ウィンドウで「印刷」→ トーストが消え、「次回からこの注意喚起を表示しない」チェック付きで「このまま出力」
      fireEvent.click(childScope.getByRole("button", { name: "印刷" }));
      expect(childScope.queryByRole("status")).toBeNull();
      fireEvent.click(
        childScope.getByRole("checkbox", {
          name: "次回からこの注意喚起を表示しない",
        })
      );

      let dialogOpenDuringPrint: boolean | null = null;
      let dialogHasOpenAttrDuringPrint: boolean | null = null;
      printSpy.mockImplementation(() => {
        const dialogEl = childView
          .getByTestId("child-root")
          .querySelector("dialog");
        dialogOpenDuringPrint = dialogEl ? dialogEl.open : null;
        dialogHasOpenAttrDuringPrint = dialogEl
          ? dialogEl.hasAttribute("open")
          : null;
      });

      fireEvent.click(childScope.getByRole("button", { name: "このまま出力" }));
      expect(printSpy).toHaveBeenCalledTimes(1);
      expect(dialogOpenDuringPrint).toBe(false);
      expect(dialogHasOpenAttrDuringPrint).toBe(false);

      // 6. メイン画面の設定ドロワー側の注意喚起表示トグルが自動でオフに同期されていること
      const parentNoticeToggle = parentScope.getByRole("checkbox", {
        name: "印刷前にヘッダー／フッター無効化の注意喚起を表示する",
      }) as HTMLInputElement;
      await waitFor(() => {
        expect(parentNoticeToggle.checked).toBe(false);
      });
    } finally {
      if (originalOpener) {
        Object.defineProperty(window, "opener", originalOpener);
      } else {
        delete (window as unknown as { opener?: unknown }).opener;
      }
    }
  });
});
