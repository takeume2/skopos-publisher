import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  act,
  waitFor,
} from "@testing-library/react";

const mockLoadMergedAssetsForDoc = vi.fn<
  (docId: string) => Promise<Record<string, string>>
>();

let mockPreviewUpToDate = true;
let mockPreviewRenderNow = vi.fn(async () => ({ ok: true }));
let latestPreviewProps: {
  documentId?: string | null;
  markdown?: string;
  assets?: Record<string, string>;
  autoUpdate?: boolean;
  showMarginGuides?: boolean;
  layoutMode?: "single" | "spread";
  onToggleAutoUpdate?: (val: boolean) => void;
  onToggleMarginGuides?: (val: boolean) => void;
  onLayoutModeChange?: (mode: "single" | "spread") => void;
  headerRightExtra?: React.ReactNode;
} = {};

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("session=test-session"),
}));

vi.mock("@/hooks/useIndexedDbStorage", async () => {
  const actual = await vi.importActual<
    typeof import("@/hooks/useIndexedDbStorage")
  >("@/hooks/useIndexedDbStorage");
  return {
    ...actual,
    loadMergedAssetsForDoc: (docId: string) =>
      mockLoadMergedAssetsForDoc(docId),
  };
});

vi.mock("@/components/PagedPreviewPane", () => ({
  PagedPreviewPane: (props: {
    ref?: React.Ref<{
      isUpToDate: () => boolean;
      renderNow: () => Promise<{ ok: boolean }>;
    }>;
    documentId?: string | null;
    markdown?: string;
    assets?: Record<string, string>;
    autoUpdate?: boolean;
    showMarginGuides?: boolean;
    layoutMode?: "single" | "spread";
    onToggleAutoUpdate?: (val: boolean) => void;
    onToggleMarginGuides?: (val: boolean) => void;
    onLayoutModeChange?: (mode: "single" | "spread") => void;
    headerRightExtra?: React.ReactNode;
  }) => {
    latestPreviewProps = props;
    React.useImperativeHandle(props.ref, () => ({
      isUpToDate: () => mockPreviewUpToDate,
      renderNow: () => mockPreviewRenderNow(),
    }));
    return (
      <div data-testid="popout-mock-preview">
        <div data-testid="popout-doc-id">{props.documentId}</div>
        <div data-testid="popout-markdown">{props.markdown}</div>
        <div data-testid="popout-assets">{JSON.stringify(props.assets)}</div>
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

import { PopoutPreview } from "@/components/PopoutPreview";
import { PREVIEW_SYNC_CHANNEL_NAME } from "@/lib/preview-sync";

describe("PopoutPreview (/preview) sync, reconnect, race safety, and print (#64)", () => {
  const originalBroadcastChannel = globalThis.BroadcastChannel;

  beforeEach(() => {
    MockBroadcastChannel.instances = [];
    (globalThis as unknown as { BroadcastChannel: unknown }).BroadcastChannel =
      MockBroadcastChannel;
    mockLoadMergedAssetsForDoc.mockReset();
    mockLoadMergedAssetsForDoc.mockResolvedValue({});
    mockPreviewUpToDate = true;
    mockPreviewRenderNow = vi.fn(async () => ({ ok: true }));
    latestPreviewProps = {};
    document.title = "Skopos Publisher";
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    (globalThis as unknown as { BroadcastChannel: unknown }).BroadcastChannel =
      originalBroadcastChannel;
  });

  it("handshakes via preview-ready, ignores other sessions, reconnects on parent reload, and syncs prefs/print/close", async () => {
    const parentChannel = new MockBroadcastChannel(PREVIEW_SYNC_CHANNEL_NAME);
    const parentReceived: unknown[] = [];
    parentChannel.addEventListener("message", (e) => {
      parentReceived.push(e.data);
    });

    mockLoadMergedAssetsForDoc.mockResolvedValue({
      "asset:logo": "data:image/png;base64,LOGO",
    });

    const closeSpy = vi.spyOn(window, "close").mockImplementation(() => {});
    const printSpy = vi.spyOn(window, "print").mockImplementation(() => {});

    render(<PopoutPreview sessionId="sess-main" />);

    expect(parentReceived).toContainEqual({
      type: "preview-ready",
      sessionId: "sess-main",
    });

    // 別セッションからのメッセージは無視されること
    act(() => {
      parentChannel.postMessage({
        type: "sync-state",
        sessionId: "other-tab-session",
        documentId: "doc_other",
        markdown: "# 他タブの文書",
        exportBasename: "other",
        prefs: { autoUpdate: true, showMarginGuides: false, layoutMode: "single" },
        assetsVersion: 0,
      });
    });
    expect(screen.queryByTestId("popout-mock-preview")).toBeNull();

    // 正しいセッションの sync-state を受信して描画・タイトル更新
    act(() => {
      parentChannel.postMessage({
        type: "sync-state",
        sessionId: "sess-main",
        documentId: "doc_1",
        markdown: '---\ntitle: "縦モニター報告書"\n---\n\n# 本文',
        exportBasename: "20261128_縦モニター報告書",
        prefs: { autoUpdate: true, showMarginGuides: false, layoutMode: "single" },
        assetsVersion: 1,
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId("popout-doc-id").textContent).toBe("doc_1");
      expect(screen.getByTestId("popout-assets").textContent).toContain(
        "asset:logo"
      );
    });
    expect(document.title).toBe("[プレビュー] 縦モニター報告書");

    // 親切断通知 → プレビューを保持したまま再接続待機バナー表示
    act(() => {
      parentChannel.postMessage({
        type: "parent-disconnected",
        sessionId: "sess-main",
      });
    });
    expect(screen.getByRole("status").textContent).toContain(
      "エディタとの接続が切れました"
    );
    expect(screen.getByTestId("popout-mock-preview")).toBeTruthy();

    // 親リロード後の parent-hello → preview-ready 返信 → sync-state でバナー解消
    parentReceived.length = 0;
    act(() => {
      parentChannel.postMessage({
        type: "parent-hello",
        sessionId: "sess-main",
      });
    });
    expect(parentReceived).toContainEqual({
      type: "preview-ready",
      sessionId: "sess-main",
    });

    act(() => {
      parentChannel.postMessage({
        type: "sync-state",
        sessionId: "sess-main",
        documentId: "doc_1",
        markdown: '---\ntitle: "縦モニター報告書"\n---\n\n# 再接続後',
        exportBasename: "20261128_縦モニター報告書",
        prefs: {
          autoUpdate: true,
          showMarginGuides: false,
          layoutMode: "single",
          skipPrintHeaderFooterNotice: true,
          enablePreflightCheck: false,
          preflightNgWords: "",
        },
        assetsVersion: 1,
      });
    });
    expect(screen.queryByText(/エディタとの接続が切れました/)).toBeNull();

    // 子側からの設定変更が親へ update-prefs 送信される
    act(() => {
      latestPreviewProps.onLayoutModeChange?.("spread");
    });
    expect(parentReceived).toContainEqual({
      type: "update-prefs",
      sessionId: "sess-main",
      patch: { layoutMode: "spread" },
    });

    // 子側からの印刷: document.title が exportBasename に切り替わり afterprint で復元
    let titleDuringPrint = "";
    printSpy.mockImplementation(() => {
      titleDuringPrint = document.title;
    });
    fireEvent.click(screen.getByRole("button", { name: "印刷" }));
    expect(printSpy).toHaveBeenCalledTimes(1);
    expect(titleDuringPrint).toBe("20261128_縦モニター報告書");
    window.dispatchEvent(new Event("afterprint"));
    expect(document.title).toBe("[プレビュー] 縦モニター報告書");

    // 「メインへ戻す」押下で preview-closed を送信し window.close()
    parentReceived.length = 0;
    fireEvent.click(screen.getByRole("button", { name: "メインへ戻す" }));
    expect(parentReceived).toContainEqual({
      type: "preview-closed",
      sessionId: "sess-main",
    });
    expect(closeSpy).toHaveBeenCalledTimes(1);

    parentChannel.close();
  });

  it("prevents stale IndexedDB asset responses from overwriting newer document assets on rapid switching", async () => {
    const parentChannel = new MockBroadcastChannel(PREVIEW_SYNC_CHANNEL_NAME);

    let resolveDocA!: (val: Record<string, string>) => void;
    let resolveDocB!: (val: Record<string, string>) => void;
    mockLoadMergedAssetsForDoc.mockImplementation((docId: string) => {
      if (docId === "doc_a") {
        return new Promise((resolve) => {
          resolveDocA = resolve;
        });
      }
      return new Promise((resolve) => {
        resolveDocB = resolve;
      });
    });

    render(<PopoutPreview sessionId="sess-race" />);

    act(() => {
      parentChannel.postMessage({
        type: "sync-state",
        sessionId: "sess-race",
        documentId: "doc_a",
        markdown: "# 文書A",
        exportBasename: "doc_a",
        prefs: { autoUpdate: true, showMarginGuides: false, layoutMode: "single" },
        assetsVersion: 1,
      });
    });

    act(() => {
      parentChannel.postMessage({
        type: "sync-state",
        sessionId: "sess-race",
        documentId: "doc_b",
        markdown: "# 文書B",
        exportBasename: "doc_b",
        prefs: { autoUpdate: true, showMarginGuides: false, layoutMode: "single" },
        assetsVersion: 2,
      });
    });

    // 文書B が先に解決
    await act(async () => {
      resolveDocB({ "asset:b": "data:image/png;base64,BBB" });
    });
    await waitFor(() => {
      expect(screen.getByTestId("popout-assets").textContent).toContain("asset:b");
    });

    // 遅れて 文書A が解決しても上書きされないこと
    await act(async () => {
      resolveDocA({ "asset:a": "data:image/png;base64,AAA" });
    });
    expect(screen.getByTestId("popout-assets").textContent).toContain("asset:b");
    expect(screen.getByTestId("popout-assets").textContent).not.toContain("asset:a");

    parentChannel.close();
  });

  it("renders a graceful fallback view when sessionId is missing or BroadcastChannel is unavailable", () => {
    render(<PopoutPreview sessionId="" />);
    expect(
      screen.getByText("別ウィンドウプレビューを初期化できませんでした")
    ).toBeTruthy();

    cleanup();
    (globalThis as unknown as { BroadcastChannel: unknown }).BroadcastChannel =
      undefined;
    render(<PopoutPreview sessionId="sess-no-bc" />);
    expect(
      screen.getByText("別ウィンドウプレビューを初期化できませんでした")
    ).toBeTruthy();
  });

  it("shows preflight/NG-word/header-footer dialog before printing, sends jump-to-line with opener.focus(), syncs skip-notice, and closes dialog before window.print()", async () => {
    const parentChannel = new MockBroadcastChannel(PREVIEW_SYNC_CHANNEL_NAME);
    const parentReceived: unknown[] = [];
    parentChannel.addEventListener("message", (e) => {
      parentReceived.push(e.data);
    });

    const openerFocus = vi.fn();
    const originalOpener = Object.getOwnPropertyDescriptor(window, "opener");
    Object.defineProperty(window, "opener", {
      configurable: true,
      value: { closed: false, focus: openerFocus },
    });

    const printSpy = vi.spyOn(window, "print").mockImplementation(() => {});

    try {
      const { container } = render(<PopoutPreview sessionId="sess-preflight" />);

      act(() => {
        parentChannel.postMessage({
          type: "sync-state",
          sessionId: "sess-preflight",
          documentId: "doc_pf",
          markdown: [
            "---",
            'title: "提案書"',
            'author: "山田太郎"',
            'date: "2026-11-28"',
            "---",
            "",
            "# 概要",
            "ここに社外秘コードがあります（TBD）",
          ].join("\n"),
          exportBasename: "20261128_提案書",
          prefs: {
            autoUpdate: true,
            showMarginGuides: false,
            layoutMode: "single",
            skipPrintHeaderFooterNotice: false,
            enablePreflightCheck: true,
            preflightNgWords: "社外秘コード",
          },
          assetsVersion: 1,
        });
      });

      await waitFor(() => {
        expect(screen.getByTestId("popout-doc-id").textContent).toBe("doc_pf");
      });

      // 印刷押下で即 window.print() されず、プリフライト確認ダイアログが開く
      fireEvent.click(screen.getByRole("button", { name: "印刷" }));
      expect(printSpy).not.toHaveBeenCalled();
      expect(screen.getByText(/出力前プリフライトチェック/)).toBeTruthy();
      expect(screen.getByText(/未記入・仮表現「TBD」が残っています。/)).toBeTruthy();
      expect(screen.getByText(/NG ワード「社外秘コード」が含まれています。/)).toBeTruthy();
      expect(screen.getByText("「ヘッダーとフッター」をオフ")).toBeTruthy();

      // 指摘行クリックで jump-to-line を親へ送信し window.opener.focus() を呼ぶ
      parentReceived.length = 0;
      fireEvent.click(screen.getByText(/NG ワード「社外秘コード」が含まれています。/));
      expect(parentReceived).toContainEqual({
        type: "jump-to-line",
        sessionId: "sess-preflight",
        line: 8,
      });
      expect(openerFocus).toHaveBeenCalledTimes(1);

      // 再度印刷 → 「次回から非表示」チェック付きで「このまま出力」
      parentReceived.length = 0;
      fireEvent.click(screen.getByRole("button", { name: "印刷" }));
      fireEvent.click(
        screen.getByRole("checkbox", {
          name: "次回からこの注意喚起を表示しない",
        })
      );

      let dialogOpenDuringPrint: boolean | null = null;
      let dialogHasOpenAttrDuringPrint: boolean | null = null;
      printSpy.mockImplementation(() => {
        const dialogEl = container.querySelector("dialog");
        dialogOpenDuringPrint = dialogEl ? dialogEl.open : null;
        dialogHasOpenAttrDuringPrint = dialogEl
          ? dialogEl.hasAttribute("open")
          : null;
      });

      fireEvent.click(screen.getByRole("button", { name: "このまま出力" }));
      expect(printSpy).toHaveBeenCalledTimes(1);
      expect(dialogOpenDuringPrint).toBe(false);
      expect(dialogHasOpenAttrDuringPrint).toBe(false);
      expect(parentReceived).toContainEqual({
        type: "update-prefs",
        sessionId: "sess-preflight",
        patch: { skipPrintHeaderFooterNotice: true },
      });
    } finally {
      if (originalOpener) {
        Object.defineProperty(window, "opener", originalOpener);
      } else {
        delete (window as unknown as { opener?: unknown }).opener;
      }
      parentChannel.close();
    }
  });

  it("disables line jump when disconnected and still warns on unresolved assets", async () => {
    const parentChannel = new MockBroadcastChannel(PREVIEW_SYNC_CHANNEL_NAME);
    const printSpy = vi.spyOn(window, "print").mockImplementation(() => {});

    render(<PopoutPreview sessionId="sess-disc" />);

    act(() => {
      parentChannel.postMessage({
        type: "sync-state",
        sessionId: "sess-disc",
        documentId: "doc_disc",
        markdown: '---\ntitle: "提案書"\n---\n\n![図](asset:missing_img)\n\nTODO: 追記',
        exportBasename: "20261128_提案書",
        prefs: {
          autoUpdate: true,
          showMarginGuides: false,
          layoutMode: "single",
          skipPrintHeaderFooterNotice: true,
          enablePreflightCheck: true,
          preflightNgWords: "",
        },
        assetsVersion: 1,
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId("popout-doc-id").textContent).toBe("doc_disc");
    });

    act(() => {
      parentChannel.postMessage({
        type: "parent-disconnected",
        sessionId: "sess-disc",
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "印刷" }));
    expect(printSpy).not.toHaveBeenCalled();
    expect(screen.getByText(/未解決の画像があります（1件）/)).toBeTruthy();
    expect(
      screen.getByText("※ メイン画面と未接続のため、行ジャンプは利用できません。")
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /未記入・仮表現「TODO」/ })
    ).toBeNull();

    parentChannel.close();
  });

  it("waits for in-flight IndexedDB asset loading before evaluating unresolved assets on print", async () => {
    const parentChannel = new MockBroadcastChannel(PREVIEW_SYNC_CHANNEL_NAME);
    const printSpy = vi.spyOn(window, "print").mockImplementation(() => {});

    let resolveAssets!: (val: Record<string, string>) => void;
    mockLoadMergedAssetsForDoc.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveAssets = resolve;
        })
    );

    render(<PopoutPreview sessionId="sess-inflight" />);

    act(() => {
      parentChannel.postMessage({
        type: "sync-state",
        sessionId: "sess-inflight",
        documentId: "doc_inflight",
        markdown: '---\ntitle: "画像付き文書"\n---\n\n![図](asset:img_ok)',
        exportBasename: "20261128_画像付き文書",
        prefs: {
          autoUpdate: true,
          showMarginGuides: false,
          layoutMode: "single",
          skipPrintHeaderFooterNotice: true,
          enablePreflightCheck: false,
          preflightNgWords: "",
        },
        assetsVersion: 1,
      });
    });

    // IndexedDB 読込完了前に印刷ボタンをクリック
    fireEvent.click(screen.getByRole("button", { name: "印刷" }));
    expect(printSpy).not.toHaveBeenCalled();
    expect(screen.queryByText(/未解決の画像があります/)).toBeNull();

    // 読込完了後、画像が解決済みなので誤検知モーダルを出さずそのまま印刷される
    await act(async () => {
      resolveAssets({ "asset:img_ok": "data:image/png;base64,OK" });
    });

    await waitFor(() => {
      expect(printSpy).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByText(/未解決の画像があります/)).toBeNull();

    parentChannel.close();
  });
});
