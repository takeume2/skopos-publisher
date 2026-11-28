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
import type { PreflightReport } from "@/lib/preflight";
import {
  createPreviewSyncChannel,
  parsePreviewSyncMessage,
  type PreviewSyncMessage,
  type SyncedPreviewPrefs,
} from "@/lib/preview-sync";
import {
  extractUnresolvedAssetRefs,
  type UnresolvedAssetRef,
} from "@/lib/unresolved-assets";
import {
  PagedPreviewPane,
  type PagedPreviewPaneHandle,
} from "./PagedPreviewPane";
import {
  evaluatePrintConfirm,
  PrintConfirmDialogContent,
} from "./PrintConfirmDialogContent";

type ConnectionState = "connecting" | "connected" | "disconnected" | "unsupported";

type ResolvedSyncedPrefs = Required<SyncedPreviewPrefs>;

interface SyncedDocState {
  documentId: string;
  markdown: string;
  exportBasename: string;
  prefs: ResolvedSyncedPrefs;
}

type PopoutModalState =
  | { kind: "notice"; title: string; message: string }
  | {
      kind: "print-confirm";
      unresolvedItems: UnresolvedAssetRef[];
      preflightReport: PreflightReport | null;
      showHeaderFooterNotice: boolean;
    }
  | null;

interface PopoutPreviewProps {
  /** Optional explicit session ID override (primarily for unit tests) */
  sessionId?: string | null;
}

const DEFAULT_SYNCED_PREFS: ResolvedSyncedPrefs = {
  autoUpdate: true,
  showMarginGuides: false,
  layoutMode: "single",
  skipPrintHeaderFooterNotice: false,
  enablePreflightCheck: true,
  preflightNgWords: "",
};

const RECONNECT_PING_INTERVAL_MS = 1500;

function resolveSyncedPrefs(prefs: SyncedPreviewPrefs): ResolvedSyncedPrefs {
  return {
    autoUpdate: prefs.autoUpdate,
    showMarginGuides: prefs.showMarginGuides,
    layoutMode: prefs.layoutMode,
    skipPrintHeaderFooterNotice:
      prefs.skipPrintHeaderFooterNotice ??
      DEFAULT_SYNCED_PREFS.skipPrintHeaderFooterNotice,
    enablePreflightCheck:
      prefs.enablePreflightCheck ?? DEFAULT_SYNCED_PREFS.enablePreflightCheck,
    preflightNgWords:
      prefs.preflightNgWords ?? DEFAULT_SYNCED_PREFS.preflightNgWords,
  };
}

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
  const [modalState, setModalState] = useState<PopoutModalState>(null);
  const [skipPrintNoticeNextTime, setSkipPrintNoticeNextTime] =
    useState<boolean>(false);

  const channelRef = useRef<BroadcastChannel | null>(null);
  const previewPaneRef = useRef<PagedPreviewPaneHandle>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const assetLoadSeqRef = useRef<number>(0);
  const lastLoadedAssetKeyRef = useRef<string>("");
  const pendingAssetLoadRef = useRef<Promise<void> | null>(null);
  const latestAssetsRef = useRef<Record<string, string>>(assets);
  latestAssetsRef.current = assets;
  const latestDocStateRef = useRef<SyncedDocState | null>(docState);
  latestDocStateRef.current = docState;
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

  const closeDialogSync = useCallback(() => {
    const dialogEl = dialogRef.current;
    if (!dialogEl) return;
    if (typeof dialogEl.close === "function" && dialogEl.open) {
      dialogEl.close();
    }
    if (dialogEl.hasAttribute("open")) {
      dialogEl.removeAttribute("open");
    }
  }, []);

  useEffect(() => {
    const dialogEl = dialogRef.current;
    if (!dialogEl) return;
    if (modalState) {
      if (!dialogEl.open) {
        if (typeof dialogEl.showModal === "function") {
          dialogEl.showModal();
        } else {
          dialogEl.setAttribute("open", "");
        }
      }
    } else {
      closeDialogSync();
    }
  }, [closeDialogSync, modalState]);

  const closeModal = useCallback(() => {
    closeDialogSync();
    setModalState(null);
  }, [closeDialogSync]);

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
    (docId: string, assetsVersion: number, force = false): Promise<void> => {
      const loadKey = `${docId}:${assetsVersion}`;
      if (!force && lastLoadedAssetKeyRef.current === loadKey) {
        return pendingAssetLoadRef.current ?? Promise.resolve();
      }
      lastLoadedAssetKeyRef.current = loadKey;
      const reqSeq = ++assetLoadSeqRef.current;

      const loadPromise = (async () => {
        try {
          const merged = await loadMergedAssetsForDoc(docId);
          if (!isMountedRef.current || reqSeq !== assetLoadSeqRef.current) {
            return;
          }
          latestAssetsRef.current = merged;
          setAssets(merged);
        } catch (err) {
          console.error("Failed to load assets for popout preview:", err);
        } finally {
          if (reqSeq === assetLoadSeqRef.current) {
            pendingAssetLoadRef.current = null;
          }
        }
      })();

      pendingAssetLoadRef.current = loadPromise;
      return loadPromise;
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
        const nextDocState: SyncedDocState = {
          documentId: msg.documentId,
          markdown: msg.markdown,
          exportBasename: msg.exportBasename,
          prefs: resolveSyncedPrefs(msg.prefs),
        };
        latestDocStateRef.current = nextDocState;
        setDocState(nextDocState);
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
      setDocState((prev) => {
        if (!prev) return prev;
        const nextState: SyncedDocState = {
          ...prev,
          prefs: { ...prev.prefs, ...patch },
        };
        latestDocStateRef.current = nextState;
        return nextState;
      });
      if (sessionId) {
        postMessageSafely({ type: "update-prefs", sessionId, patch });
      }
    },
    [postMessageSafely, sessionId]
  );

  const runWindowPrint = useCallback(() => {
    applyPrintTitle();
    try {
      window.print();
    } catch (err) {
      restorePrintTitle();
      console.error("Failed to open print dialog:", err);
    }
  }, [applyPrintTitle, restorePrintTitle]);

  const executePrint = useCallback(() => {
    if (isPreparingPrintRef.current) return;

    const handle = previewPaneRef.current;
    if (handle && !handle.isUpToDate()) {
      isPreparingPrintRef.current = true;
      setIsPreparingPrint(true);
      void handle
        .renderNow()
        .then((res) => {
          if (!isMountedRef.current) return;
          if (res.ok) {
            runWindowPrint();
          } else if (!res.cancelled) {
            setModalState({
              kind: "notice",
              title: "PDF出力エラー",
              message:
                res.error ||
                "組版レンダリングに失敗したため、PDF出力を開始できませんでした。",
            });
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

    runWindowPrint();
  }, [runWindowPrint]);

  const evaluateAndProceedPrint = useCallback(() => {
    const currentDoc = latestDocStateRef.current;
    if (!currentDoc) return;

    const currentAssets = latestAssetsRef.current;
    const currentUnresolved = extractUnresolvedAssetRefs(
      currentDoc.markdown,
      currentAssets
    );
    const evaluation = evaluatePrintConfirm({
      markdown: currentDoc.markdown,
      assets: currentAssets,
      unresolvedAssets: currentUnresolved,
      enablePreflightCheck: currentDoc.prefs.enablePreflightCheck,
      preflightNgWords: currentDoc.prefs.preflightNgWords,
      skipPrintHeaderFooterNotice: currentDoc.prefs.skipPrintHeaderFooterNotice,
    });

    if (evaluation.shouldShowDialog) {
      setSkipPrintNoticeNextTime(false);
      setModalState({
        kind: "print-confirm",
        unresolvedItems: evaluation.unresolvedItems,
        preflightReport: evaluation.preflightReport,
        showHeaderFooterNotice: evaluation.showHeaderFooterNotice,
      });
      return;
    }

    executePrint();
  }, [executePrint]);

  const handlePrint = useCallback(() => {
    if (isPreparingPrintRef.current) return;

    if (pendingAssetLoadRef.current) {
      isPreparingPrintRef.current = true;
      setIsPreparingPrint(true);
      void (async () => {
        try {
          while (pendingAssetLoadRef.current) {
            await pendingAssetLoadRef.current;
          }
        } finally {
          isPreparingPrintRef.current = false;
          if (isMountedRef.current) {
            setIsPreparingPrint(false);
          }
        }
        if (!isMountedRef.current) return;
        evaluateAndProceedPrint();
      })();
      return;
    }

    evaluateAndProceedPrint();
  }, [evaluateAndProceedPrint]);

  const handleJumpToPreflightLine = useCallback(
    (line: number) => {
      closeModal();
      if (sessionId) {
        postMessageSafely({ type: "jump-to-line", sessionId, line });
      }
      try {
        if (window.opener && !window.opener.closed) {
          window.opener.focus?.();
        }
      } catch {
        // Ignore cross-window focus restriction errors
      }
    },
    [closeModal, postMessageSafely, sessionId]
  );

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

      <dialog
        ref={dialogRef}
        {...({ closedby: "any" } as Record<string, string>)}
        onClose={closeModal}
        onClick={(e) => {
          if (e.target === dialogRef.current) {
            closeModal();
          }
        }}
        className="mdpub-dialog no-print"
        aria-labelledby="mdpub-popout-dialog-title"
      >
        {modalState?.kind === "notice" && (
          <div className="p-5">
            <h2
              id="mdpub-popout-dialog-title"
              className="text-sm font-semibold text-white"
            >
              {modalState.title}
            </h2>
            <p className="mt-2 text-xs leading-relaxed text-slate-300">
              {modalState.message}
            </p>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={closeModal}
                className="rounded-md bg-sky-600 px-3.5 py-1.5 text-xs font-medium text-white transition hover:bg-sky-500"
              >
                閉じる
              </button>
            </div>
          </div>
        )}

        {modalState?.kind === "print-confirm" && (
          <PrintConfirmDialogContent
            titleId="mdpub-popout-dialog-title"
            unresolvedItems={modalState.unresolvedItems}
            preflightReport={modalState.preflightReport}
            showHeaderFooterNotice={modalState.showHeaderFooterNotice}
            skipPrintNoticeNextTime={skipPrintNoticeNextTime}
            onChangeSkipPrintNoticeNextTime={setSkipPrintNoticeNextTime}
            onJumpToLine={
              connectionState === "connected"
                ? handleJumpToPreflightLine
                : undefined
            }
            jumpHintText={
              connectionState === "connected"
                ? "※ 項目をクリックするとメイン画面のエディタ該当行へ移動します。"
                : "※ メイン画面と未接続のため、行ジャンプは利用できません。"
            }
            onCancel={closeModal}
            onConfirm={() => {
              if (
                modalState.showHeaderFooterNotice &&
                skipPrintNoticeNextTime
              ) {
                handleUpdatePrefs({ skipPrintHeaderFooterNotice: true });
              }
              closeDialogSync();
              setModalState(null);
              executePrint();
            }}
          />
        )}
      </dialog>
    </div>
  );
}
