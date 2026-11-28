"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "next/navigation";
import { Loader2, PanelRightClose, Printer, WifiOff } from "lucide-react";
import { loadMergedAssetsForDoc } from "@/hooks/useIndexedDbStorage";
import { parseMarkdownDocument } from "@/lib/frontmatter";
import {
  createPreviewSyncChannel,
  parsePreviewSyncMessage,
  type PreviewSyncMessage,
  type SyncedPreviewPrefs,
} from "@/lib/preview-sync";
import { extractUnresolvedAssetRefs } from "@/lib/unresolved-assets";
import {
  PagedPreviewPane,
  type PagedPreviewPaneHandle,
} from "./PagedPreviewPane";

type ConnectionState = "connecting" | "connected" | "disconnected" | "unsupported";

interface SyncedDocState {
  documentId: string;
  markdown: string;
  exportBasename: string;
  prefs: SyncedPreviewPrefs;
}

interface PopoutPreviewProps {
  /** Optional explicit session ID override (primarily for unit tests) */
  sessionId?: string | null;
}

const DEFAULT_SYNCED_PREFS: SyncedPreviewPrefs = {
  autoUpdate: true,
  showMarginGuides: false,
  layoutMode: "single",
};

const RECONNECT_PING_INTERVAL_MS = 1500;

export function PopoutPreview({
  sessionId: propSessionId,
}: PopoutPreviewProps = {}) {
  const searchParams = useSearchParams();
  const sessionId =
    propSessionId !== undefined
      ? (propSessionId?.trim() ?? "")
      : (searchParams.get("session")?.trim() ?? "");

  const [connectionState, setConnectionState] = useState<ConnectionState>(
    sessionId ? "connecting" : "unsupported"
  );
  const [docState, setDocState] = useState<SyncedDocState | null>(null);
  const [assets, setAssets] = useState<Record<string, string>>({});
  const [isPreparingPrint, setIsPreparingPrint] = useState<boolean>(false);

  const channelRef = useRef<BroadcastChannel | null>(null);
  const previewPaneRef = useRef<PagedPreviewPaneHandle>(null);
  const assetLoadSeqRef = useRef<number>(0);
  const lastLoadedAssetKeyRef = useRef<string>("");
  const hasNotifiedClosedRef = useRef<boolean>(false);
  const isMountedRef = useRef<boolean>(true);
  const isPreparingPrintRef = useRef<boolean>(false);
  const previousTitleRef = useRef<string | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const parsed = useMemo(
    () => (docState ? parseMarkdownDocument(docState.markdown) : null),
    [docState]
  );

  const unresolvedAssets = useMemo(
    () =>
      docState ? extractUnresolvedAssetRefs(docState.markdown, assets) : [],
    [assets, docState]
  );

  const normalWindowTitle = useMemo(() => {
    const docTitle = parsed?.frontmatter.title
      ?.replace(/\\n|\r?\n/g, " ")
      .trim();
    return docTitle
      ? `[プレビュー] ${docTitle}`
      : "[プレビュー] Skopos Publisher";
  }, [parsed?.frontmatter.title]);

  const exportBasenameRef = useRef<string>("document");
  exportBasenameRef.current = docState?.exportBasename || "document";
  const normalTitleRef = useRef<string>(normalWindowTitle);
  normalTitleRef.current = normalWindowTitle;

  useEffect(() => {
    if (previousTitleRef.current === null) {
      document.title = normalWindowTitle;
    }
  }, [normalWindowTitle]);

  const applyPrintTitle = useCallback(() => {
    if (previousTitleRef.current === null) {
      previousTitleRef.current = normalTitleRef.current;
    }
    document.title = exportBasenameRef.current;
  }, []);

  const restorePrintTitle = useCallback(() => {
    if (previousTitleRef.current !== null) {
      document.title = normalTitleRef.current;
      previousTitleRef.current = null;
    }
  }, []);

  useEffect(() => {
    window.addEventListener("beforeprint", applyPrintTitle);
    window.addEventListener("afterprint", restorePrintTitle);
    return () => {
      window.removeEventListener("beforeprint", applyPrintTitle);
      window.removeEventListener("afterprint", restorePrintTitle);
      restorePrintTitle();
    };
  }, [applyPrintTitle, restorePrintTitle]);

  const refreshAssetsFromDb = useCallback(
    async (docId: string, assetsVersion: number, force = false) => {
      const loadKey = `${docId}:${assetsVersion}`;
      if (!force && lastLoadedAssetKeyRef.current === loadKey) {
        return;
      }
      lastLoadedAssetKeyRef.current = loadKey;
      const reqSeq = ++assetLoadSeqRef.current;
      try {
        const merged = await loadMergedAssetsForDoc(docId);
        if (!isMountedRef.current || reqSeq !== assetLoadSeqRef.current) {
          return;
        }
        setAssets(merged);
      } catch (err) {
        console.error("Failed to load assets for popout preview:", err);
      }
    },
    []
  );

  const postMessageSafely = useCallback((message: PreviewSyncMessage) => {
    try {
      channelRef.current?.postMessage(message);
    } catch {
      // Ignore post errors if channel already closed
    }
  }, []);

  const notifyClosedOnce = useCallback(() => {
    if (!sessionId || hasNotifiedClosedRef.current) return;
    hasNotifiedClosedRef.current = true;
    postMessageSafely({ type: "preview-closed", sessionId });
  }, [postMessageSafely, sessionId]);

  useEffect(() => {
    if (!sessionId) {
      setConnectionState("unsupported");
      return;
    }

    const channel = createPreviewSyncChannel();
    if (!channel) {
      setConnectionState("unsupported");
      return;
    }

    channelRef.current = channel;
    hasNotifiedClosedRef.current = false;

    const handleMessage = (event: MessageEvent) => {
      const msg = parsePreviewSyncMessage(event.data, sessionId);
      if (!msg) return;

      if (msg.type === "sync-state") {
        setConnectionState("connected");
        setDocState({
          documentId: msg.documentId,
          markdown: msg.markdown,
          exportBasename: msg.exportBasename,
          prefs: msg.prefs,
        });
        void refreshAssetsFromDb(msg.documentId, msg.assetsVersion);
        return;
      }

      if (msg.type === "assets-updated") {
        void refreshAssetsFromDb(msg.documentId, msg.assetsVersion, true);
        return;
      }

      if (msg.type === "parent-hello") {
        postMessageSafely({ type: "preview-ready", sessionId });
        return;
      }

      if (msg.type === "parent-disconnected") {
        setConnectionState("disconnected");
        return;
      }

      if (msg.type === "focus-preview") {
        window.focus();
        return;
      }

      if (msg.type === "close-preview") {
        hasNotifiedClosedRef.current = true;
        window.close();
      }
    };

    channel.addEventListener("message", handleMessage);
    postMessageSafely({ type: "preview-ready", sessionId });

    const handleUnload = () => {
      notifyClosedOnce();
    };
    window.addEventListener("pagehide", handleUnload);
    window.addEventListener("beforeunload", handleUnload);

    return () => {
      window.removeEventListener("pagehide", handleUnload);
      window.removeEventListener("beforeunload", handleUnload);
      channel.removeEventListener("message", handleMessage);
      channel.close();
      if (channelRef.current === channel) {
        channelRef.current = null;
      }
    };
  }, [notifyClosedOnce, postMessageSafely, refreshAssetsFromDb, sessionId]);

  useEffect(() => {
    if (
      !sessionId ||
      (connectionState !== "connecting" && connectionState !== "disconnected")
    ) {
      return;
    }

    const timer = setInterval(() => {
      postMessageSafely({ type: "preview-ready", sessionId });
    }, RECONNECT_PING_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [connectionState, postMessageSafely, sessionId]);

  const handleUpdatePrefs = useCallback(
    (patch: Partial<SyncedPreviewPrefs>) => {
      setDocState((prev) =>
        prev
          ? {
              ...prev,
              prefs: { ...prev.prefs, ...patch },
            }
          : prev
      );
      if (sessionId) {
        postMessageSafely({ type: "update-prefs", sessionId, patch });
      }
    },
    [postMessageSafely, sessionId]
  );

  const handlePrint = useCallback(() => {
    if (isPreparingPrintRef.current) return;

    const runPrint = () => {
      applyPrintTitle();
      try {
        window.print();
      } catch (err) {
        restorePrintTitle();
        console.error("Failed to open print dialog:", err);
      }
    };

    const handle = previewPaneRef.current;
    if (handle && !handle.isUpToDate()) {
      isPreparingPrintRef.current = true;
      setIsPreparingPrint(true);
      void handle
        .renderNow()
        .then((res) => {
          if (!isMountedRef.current) return;
          if (res.ok) {
            runPrint();
          }
        })
        .finally(() => {
          isPreparingPrintRef.current = false;
          if (isMountedRef.current) {
            setIsPreparingPrint(false);
          }
        });
      return;
    }

    runPrint();
  }, [applyPrintTitle, restorePrintTitle]);

  const handleDockBack = useCallback(() => {
    notifyClosedOnce();
    window.close();
  }, [notifyClosedOnce]);

  if (connectionState === "unsupported") {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-3 bg-slate-950 p-6 text-center text-slate-200">
        <p className="text-sm font-semibold text-white">
          別ウィンドウプレビューを初期化できませんでした
        </p>
        <p className="max-w-md text-xs leading-relaxed text-slate-400">
          メインのエディタ画面のプレビューツールバーにある「別ウィンドウ」ボタンから開いてください（BroadcastChannel 対応ブラウザが必要です）。
        </p>
        <button
          type="button"
          onClick={() => window.close()}
          className="rounded-md bg-sky-600 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-sky-500"
        >
          ウィンドウを閉じる
        </button>
      </div>
    );
  }

  if (!docState || !parsed) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-2 bg-slate-950 p-6 text-slate-300">
        <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none text-sky-400" />
        <p className="text-xs">エディタ画面と接続しています...</p>
      </div>
    );
  }

  const activePrefs = docState.prefs ?? DEFAULT_SYNCED_PREFS;

  return (
    <div className="print-workspace-shell flex h-dvh flex-col overflow-hidden bg-zinc-800">
      {connectionState === "disconnected" && (
        <div
          role="status"
          aria-live="polite"
          className="no-print flex items-center justify-between gap-2 border-b border-amber-500/40 bg-amber-950/85 px-3 py-1.5 text-[11px] text-amber-200"
        >
          <div className="flex items-center gap-1.5">
            <WifiOff className="h-3.5 w-3.5 shrink-0 text-amber-400" />
            <span>
              エディタとの接続が切れました（メイン画面の再読込を待機しています...）
            </span>
          </div>
          <button
            type="button"
            onClick={handleDockBack}
            className="rounded border border-amber-500/40 bg-amber-900/50 px-2 py-0.5 text-[10px] font-medium text-amber-100 hover:bg-amber-900"
          >
            閉じる
          </button>
        </div>
      )}

      <div className="print-preview-pane min-h-0 flex-1 overflow-hidden">
        <PagedPreviewPane
          ref={previewPaneRef}
          documentId={docState.documentId}
          markdown={docState.markdown}
          frontmatter={parsed.frontmatter}
          assets={assets}
          autoUpdate={activePrefs.autoUpdate}
          onToggleAutoUpdate={(val) => handleUpdatePrefs({ autoUpdate: val })}
          showMarginGuides={activePrefs.showMarginGuides}
          onToggleMarginGuides={(val) =>
            handleUpdatePrefs({ showMarginGuides: val })
          }
          layoutMode={activePrefs.layoutMode}
          onLayoutModeChange={(mode) => handleUpdatePrefs({ layoutMode: mode })}
          unresolvedAssets={unresolvedAssets}
          headerRightExtra={
            <>
              <button
                type="button"
                onClick={handlePrint}
                disabled={isPreparingPrint}
                aria-busy={isPreparingPrint || undefined}
                title="このプレビューを PDF 出力 / 印刷"
                className="inline-flex items-center gap-1 rounded bg-sky-600 px-2 py-1 text-[11px] font-semibold text-white transition hover:bg-sky-500 disabled:cursor-wait disabled:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
              >
                {isPreparingPrint ? (
                  <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" />
                ) : (
                  <Printer className="h-3 w-3" />
                )}
                <span>{isPreparingPrint ? "準備中..." : "印刷"}</span>
              </button>
              <button
                type="button"
                onClick={handleDockBack}
                title="このウィンドウを閉じてメイン画面へ戻す"
                className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-[11px] text-zinc-200 transition hover:bg-zinc-700 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
              >
                <PanelRightClose className="h-3 w-3" />
                <span className="preview-cq-label">メインへ戻す</span>
              </button>
            </>
          }
        />
      </div>
    </div>
  );
}
