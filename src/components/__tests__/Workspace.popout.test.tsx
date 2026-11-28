import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act, waitFor } from "@testing-library/react";
import { Workspace } from "@/components/Workspace";
import { DEFAULT_FILENAME_TEMPLATE } from "@/lib/export-filename";
import {
  PREVIEW_SESSION_STORAGE_KEY,
  PREVIEW_SYNC_CHANNEL_NAME,
} from "@/lib/preview-sync";

let mockMarkdown = "";
let mockPreviewUpToDate = true;
let mockPreviewRenderNow = vi.fn(async () => ({ ok: true }));
const mockUpdatePrefsSpy = vi.fn();
let latestPreviewProps: {
  suspendAutoRender?: boolean;
  headerRightExtra?: React.ReactNode;
} = {};

vi.mock("@/hooks/useIndexedDbStorage", () => ({
  useIndexedDbStorage: () => {
    const [markdown, setMarkdown] = React.useState(mockMarkdown);
    const [prefs, setPrefs] = React.useState({
      autoUpdate: true,
      showMarginGuides: false,
      layoutMode: "single" as "single" | "spread",
      isSidebarOpen: false,
      filenameTemplate: DEFAULT_FILENAME_TEMPLATE,
      skipPrintHeaderFooterNotice: true,
      enablePreflightCheck: false,
      preflightNgWords: "",
    });
    const updatePrefs = React.useCallback(
      async (patch: Partial<typeof prefs>) => {
        mockUpdatePrefsSpy(patch);
        setPrefs((prev) => ({ ...prev, ...patch }));
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
          title: "ポップアウト検証",
          updatedAt: Date.now(),
          markdownBytes: 120,
          assetsBytes: 0,
          totalBytes: 120,
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
}));

vi.mock("@/components/EditorPane", () => ({
  EditorPane: () => <div data-testid="mock-editor" />,
}));

vi.mock("@/components/PagedPreviewPane", () => ({
  PagedPreviewPane: (props: {
    ref?: React.Ref<{
      isUpToDate: () => boolean;
      renderNow: () => Promise<{ ok: boolean }>;
    }>;
    suspendAutoRender?: boolean;
    headerRightExtra?: React.ReactNode;
  }) => {
    latestPreviewProps = props;
    React.useImperativeHandle(props.ref, () => ({
      isUpToDate: () => mockPreviewUpToDate,
      renderNow: () => mockPreviewRenderNow(),
    }));
    return (
      <div
        data-testid="mock-preview"
        data-suspended={String(Boolean(props.suspendAutoRender))}
      >
        {props.headerRightExtra}
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

describe("Workspace popout preview integration (#64)", () => {
  const originalBroadcastChannel = globalThis.BroadcastChannel;

  beforeEach(() => {
    MockBroadcastChannel.instances = [];
    (globalThis as unknown as { BroadcastChannel: unknown }).BroadcastChannel =
      MockBroadcastChannel;
    window.sessionStorage.clear();
    mockMarkdown = '---\ntitle: "ポップアウト検証"\ndate: "2026-11-28"\n---\n\n# 概要';
    mockPreviewUpToDate = true;
    mockPreviewRenderNow = vi.fn(async () => ({ ok: true }));
    mockUpdatePrefsSpy.mockClear();
    latestPreviewProps = {};
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    (globalThis as unknown as { BroadcastChannel: unknown }).BroadcastChannel =
      originalBroadcastChannel;
  });

  it("opens popout preview, suspends parent auto-render, prevents duplicate open, syncs prefs without loops, and prints via renderNow()", async () => {
    const mockPopup = {
      closed: false,
      focus: vi.fn(),
      close: vi.fn(() => {
        mockPopup.closed = true;
      }),
    };
    const openSpy = vi
      .spyOn(window, "open")
      .mockReturnValue(mockPopup as unknown as Window);
    const printSpy = vi.spyOn(window, "print").mockImplementation(() => {});

    const childChannel = new MockBroadcastChannel(PREVIEW_SYNC_CHANNEL_NAME);
    const childReceived: unknown[] = [];
    childChannel.addEventListener("message", (e) => {
      childReceived.push(e.data);
    });

    const { container } = render(<Workspace />);
    const sessionId = window.sessionStorage.getItem(PREVIEW_SESSION_STORAGE_KEY)!;
    expect(sessionId).toBeTruthy();

    // プレビューツールバー右端の「別ウィンドウ」ボタンから分離
    fireEvent.click(
      screen.getByRole("button", { name: "プレビューを別ウィンドウに分離" })
    );
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy.mock.calls[0][0]).toBe(
      `/preview?session=${encodeURIComponent(sessionId)}`
    );

    // 親側はオフスクリーン非表示＋自動描画停止になり、トップバー中央は3択から分離バーへ差し替わる
    const wrapper = container.querySelector(".print-preview-pane")!;
    expect(wrapper.classList.contains("print-preview-pane-screen-hidden")).toBe(true);
    expect(latestPreviewProps.suspendAutoRender).toBe(true);
    expect(screen.getByText("別ウィンドウ表示中")).toBeTruthy();
    expect(screen.queryByRole("group", { name: "表示モード切替" })).toBeNull();

    // 既に開いている状態で再クリックしても重複ウィンドウを開かず focus する（「前面へ」ボタンも含めて検証）
    mockPopup.focus.mockClear();
    fireEvent.click(
      screen.getByRole("button", {
        name: "プレビューを別ウィンドウに分離",
        hidden: true,
      })
    );
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(mockPopup.focus).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "前面へ" }));
    expect(mockPopup.focus).toHaveBeenCalledTimes(2);

    // 子側からの preview-ready に sync-state で応答、update-prefs は差分のみ反映し同値ではループしない
    childReceived.length = 0;
    act(() => {
      childChannel.postMessage({ type: "preview-ready", sessionId });
    });
    expect(childReceived.some((m) => (m as { type?: string }).type === "sync-state")).toBe(
      true
    );

    act(() => {
      childChannel.postMessage({
        type: "update-prefs",
        sessionId,
        patch: { layoutMode: "spread" },
      });
    });
    expect(mockUpdatePrefsSpy).toHaveBeenCalledTimes(1);
    expect(mockUpdatePrefsSpy).toHaveBeenCalledWith({ layoutMode: "spread" });

    // 同値の update-prefs や別セッションのメッセージは無視
    act(() => {
      childChannel.postMessage({
        type: "update-prefs",
        sessionId,
        patch: { layoutMode: "spread" },
      });
      childChannel.postMessage({
        type: "update-prefs",
        sessionId: "other-session",
        patch: { layoutMode: "single" },
      });
    });
    expect(mockUpdatePrefsSpy).toHaveBeenCalledTimes(1);

    // 分離中に親から印刷: 親プレビューが stale でも renderNow() を待ってから window.print() される
    mockPreviewUpToDate = false;
    fireEvent.click(screen.getByRole("button", { name: "PDF出力 / 印刷" }));
    await waitFor(() => {
      expect(mockPreviewRenderNow).toHaveBeenCalledTimes(1);
      expect(printSpy).toHaveBeenCalledTimes(1);
    });

    // 「メインに戻す」クリックで close-preview 送信＋popup.close()＋親プレビュー復帰
    childReceived.length = 0;
    fireEvent.click(screen.getByRole("button", { name: "メインに戻す" }));
    expect(childReceived).toContainEqual({
      type: "close-preview",
      sessionId,
    });
    expect(mockPopup.close).toHaveBeenCalledTimes(1);
    expect(wrapper.classList.contains("print-preview-pane-screen-hidden")).toBe(false);
    expect(latestPreviewProps.suspendAutoRender).toBe(false);
    expect(screen.getByRole("group", { name: "表示モード切替" })).toBeTruthy();

    childChannel.close();
  });

  it("shows a notice modal when popup window is blocked by the browser", () => {
    vi.spyOn(window, "open").mockReturnValue(null);

    render(<Workspace />);
    fireEvent.click(
      screen.getByRole("button", { name: "プレビューを別ウィンドウに分離" })
    );

    expect(screen.getByText("別ウィンドウを開けませんでした")).toBeTruthy();
    expect(latestPreviewProps.suspendAutoRender).toBe(false);
  });

  it("auto-reconnects after parent reload (popupRef=null) via sessionStorage sessionId and docks back via close-preview message", () => {
    window.sessionStorage.setItem(PREVIEW_SESSION_STORAGE_KEY, "persisted-sess");
    const childChannel = new MockBroadcastChannel(PREVIEW_SYNC_CHANNEL_NAME);
    const childReceived: unknown[] = [];
    childChannel.addEventListener("message", (e) => {
      childReceived.push(e.data);
    });

    // 親リロード相当: window.open を呼んでいない状態でマウント
    render(<Workspace />);
    expect(childReceived).toContainEqual({
      type: "parent-hello",
      sessionId: "persisted-sess",
    });

    // 生存している子から preview-ready が届く → 自動で分離状態へ復帰し sync-state 返信
    childReceived.length = 0;
    act(() => {
      childChannel.postMessage({
        type: "preview-ready",
        sessionId: "persisted-sess",
      });
    });

    expect(screen.getByText("別ウィンドウ表示中")).toBeTruthy();
    expect(latestPreviewProps.suspendAutoRender).toBe(true);
    expect(
      childReceived.some((m) => (m as { type?: string }).type === "sync-state")
    ).toBe(true);

    // popupRef が null でも「メインに戻す」で close-preview が飛んでメイン復帰できる
    childReceived.length = 0;
    fireEvent.click(screen.getByRole("button", { name: "メインに戻す" }));
    expect(childReceived).toContainEqual({
      type: "close-preview",
      sessionId: "persisted-sess",
    });
    expect(latestPreviewProps.suspendAutoRender).toBe(false);

    childChannel.close();
  });

  it("opens popout directly from editor-only mode via top toolbar icon and always restores the exact previous viewMode (#64)", () => {
    const mockPopup = {
      closed: false,
      focus: vi.fn(),
      close: vi.fn(() => {
        mockPopup.closed = true;
      }),
    };
    vi.spyOn(window, "open").mockReturnValue(mockPopup as unknown as Window);

    const { container } = render(<Workspace />);
    const wrapper = container.querySelector(".print-preview-pane")!;

    // 1. 「エディタのみ」からトップバーの別ウィンドウアイコンで分離 → 「メインに戻す」で「エディタのみ」へ復帰
    fireEvent.click(screen.getByRole("button", { name: "エディタのみ" }));
    fireEvent.click(
      screen.getByRole("button", { name: "プレビューを別ウィンドウで開く" })
    );
    expect(screen.getByText("別ウィンドウ表示中")).toBeTruthy();
    expect(screen.queryByRole("group", { name: "表示モード切替" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "メインに戻す" }));
    expect(
      screen.getByRole("button", { name: "エディタのみ" }).getAttribute("aria-pressed")
    ).toBe("true");
    expect(wrapper.classList.contains("print-preview-pane-screen-hidden")).toBe(true);

    // 2. 「プレビューのみ」から分離 → 「メインに戻す」で「プレビューのみ」へ復帰
    mockPopup.closed = false;
    fireEvent.click(screen.getByRole("button", { name: "プレビューのみ" }));
    expect(screen.queryByTestId("mock-editor")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "プレビューを別ウィンドウで開く" })
    );
    // 分離中はメイン画面がエディタ全幅になる
    expect(screen.getByTestId("mock-editor")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "メインに戻す" }));
    expect(
      screen
        .getByRole("button", { name: "プレビューのみ" })
        .getAttribute("aria-pressed")
    ).toBe("true");
    expect(screen.queryByTestId("mock-editor")).toBeNull();
  });

  it("restores split preview automatically via popup.closed polling if child closes without sending preview-closed", () => {
    vi.useFakeTimers();
    const mockPopup = {
      closed: false,
      focus: vi.fn(),
      close: vi.fn(),
    };
    vi.spyOn(window, "open").mockReturnValue(mockPopup as unknown as Window);

    render(<Workspace />);
    fireEvent.click(
      screen.getByRole("button", { name: "プレビューを別ウィンドウに分離" })
    );
    expect(latestPreviewProps.suspendAutoRender).toBe(true);

    // メッセージを送らず異常終了
    mockPopup.closed = true;
    act(() => {
      vi.advanceTimersByTime(1100);
    });

    expect(latestPreviewProps.suspendAutoRender).toBe(false);
    expect(screen.queryByText("別ウィンドウ表示中")).toBeNull();
  });
});
