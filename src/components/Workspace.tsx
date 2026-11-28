"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DocumentSummary,
  SharedAssetSummary,
  useIndexedDbStorage,
} from "@/hooks/useIndexedDbStorage";
import {
  parseMarkdownDocument,
  updateMarkdownFrontmatter,
} from "@/lib/frontmatter";
import {
  buildExportFilename,
  buildExportFilenameBasename,
} from "@/lib/export-filename";
import {
  formatImageLimitMb,
  MAX_FOLDER_TOTAL_IMAGE_BYTES,
  processUploadedImageFile,
} from "@/lib/image-processing";
import {
  extractOutlineHeadings,
  findActiveOutlineHeadingId,
  type OutlineHeading,
} from "@/lib/outline";
import {
  extractUnresolvedAssetRefs,
  matchDroppedFilesToUnresolvedAssets,
  type UnresolvedAssetRef,
} from "@/lib/unresolved-assets";
import {
  runPreflightCheck,
  type PreflightCategory,
  type PreflightReport,
} from "@/lib/preflight";
import type { DocumentFrontmatter } from "@/types/document";
import { DocumentSettingsDrawer } from "./DocumentSettingsDrawer";
import { DocumentSidebar, SharedAssetRole } from "./DocumentSidebar";
import { EditorJumpRequest, EditorPane } from "./EditorPane";
import {
  PagedPreviewPane,
  type PagedPreviewPaneHandle,
} from "./PagedPreviewPane";
import { TopToolbar, ViewMode } from "./TopToolbar";

const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i;
const MARKDOWN_EXTENSIONS = /\.(md|markdown)$/i;

type ModalState =
  | { kind: "notice"; title: string; message: string }
  | {
      kind: "asset-drop-result";
      restoredCount: number;
      unmatchedFileNames: string[];
      skippedErrors: string[];
      hadUnresolvedPlaceholders: boolean;
    }
  | {
      kind: "print-confirm";
      unresolvedItems: UnresolvedAssetRef[];
      preflightReport: PreflightReport | null;
      showHeaderFooterNotice: boolean;
    }
  | { kind: "reset-sample"; docId: string; title: string }
  | { kind: "delete-doc"; doc: DocumentSummary }
  | { kind: "delete-all-docs"; count: number; totalBytes: number }
  | { kind: "delete-shared-asset"; asset: SharedAssetSummary }
  | { kind: "delete-all-shared-assets"; count: number }
  | null;

const BULK_ASSET_RESTORE_CONCURRENCY = 4;

const PREFLIGHT_CATEGORY_LABELS: Record<PreflightCategory, string> = {
  incomplete: "未記入",
  "unresolved-asset": "画像",
  metadata: "メタ情報",
  "ng-word": "NGワード",
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function downloadMarkdownFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function Workspace() {
  const {
    markdown,
    setMarkdown,
    activeDocId,
    documentList,
    sharedAssetList,
    assets,
    saveAsset,
    saveAssetsBatch,
    removeAsset,
    clearSharedAssets,
    switchDocument,
    createDocument,
    deleteDocument,
    deleteAllDocuments,
    getExpandedMarkdownForDoc,
    prefs,
    updatePrefs,
    resetToSample,
    isLoaded,
    saveStatus,
    storageError,
    clearStorageError,
  } = useIndexedDbStorage();

  const [viewMode, setViewMode] = useState<ViewMode>("split");
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(true);
  const [splitPercent, setSplitPercent] = useState<number>(46);
  const [modalState, setModalState] = useState<ModalState>(null);
  const [importedFilename, setImportedFilename] = useState<string | null>(null);
  const [cursorLine, setCursorLine] = useState<number>(1);
  const [jumpRequest, setJumpRequest] = useState<EditorJumpRequest | null>(null);
  const [restoreProgress, setRestoreProgress] = useState<{
    processed: number;
    total: number;
  } | null>(null);
  const [restoreNotice, setRestoreNotice] = useState<string | null>(null);
  const [assetRestoreNonce, setAssetRestoreNonce] = useState<number>(0);
  const [isPreparingPrint, setIsPreparingPrint] = useState<boolean>(false);
  const [skipPrintNoticeNextTime, setSkipPrintNoticeNextTime] =
    useState<boolean>(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const previewPaneRef = useRef<PagedPreviewPaneHandle>(null);
  const previewWrapperRef = useRef<HTMLDivElement>(null);
  const isResizingRef = useRef<boolean>(false);
  const previousDocumentTitleRef = useRef<string | null>(null);
  const isPreparingPrintRef = useRef<boolean>(false);
  const isMountedRef = useRef<boolean>(true);
  const jumpRequestSeqRef = useRef<number>(0);
  const restoreNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isPreviewHidden = viewMode === "editor";
  const isPreviewHiddenRef = useRef<boolean>(isPreviewHidden);
  isPreviewHiddenRef.current = isPreviewHidden;

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const effectiveModal: ModalState = storageError
    ? {
        kind: "notice",
        title: "保存容量エラー",
        message: storageError,
      }
    : modalState;

  useEffect(() => {
    const dialogEl = dialogRef.current;
    if (!dialogEl) return;
    if (effectiveModal) {
      if (!dialogEl.open) {
        if (typeof dialogEl.showModal === "function") {
          dialogEl.showModal();
        } else {
          dialogEl.setAttribute("open", "");
        }
      }
    } else if (dialogEl.open) {
      if (typeof dialogEl.close === "function") {
        dialogEl.close();
      } else {
        dialogEl.removeAttribute("open");
      }
    }
  }, [effectiveModal]);

  const closeModal = useCallback(() => {
    if (storageError) {
      clearStorageError();
    }
    setModalState(null);
  }, [clearStorageError, storageError]);

  const parsed = useMemo(() => parseMarkdownDocument(markdown), [markdown]);
  const outlineHeadings = useMemo(
    () => extractOutlineHeadings(markdown),
    [markdown]
  );
  const activeOutlineHeadingId = useMemo(
    () => findActiveOutlineHeadingId(outlineHeadings, cursorLine),
    [outlineHeadings, cursorLine]
  );
  const unresolvedAssets = useMemo(
    () => extractUnresolvedAssetRefs(markdown, assets),
    [markdown, assets]
  );

  const showRestoreNotice = useCallback((message: string) => {
    if (restoreNoticeTimerRef.current) {
      clearTimeout(restoreNoticeTimerRef.current);
    }
    setRestoreNotice(message);
    restoreNoticeTimerRef.current = setTimeout(() => {
      setRestoreNotice(null);
      restoreNoticeTimerRef.current = null;
    }, 5000);
  }, []);

  useEffect(() => {
    return () => {
      if (restoreNoticeTimerRef.current) {
        clearTimeout(restoreNoticeTimerRef.current);
        restoreNoticeTimerRef.current = null;
      }
    };
  }, []);

  const exportBasename = useMemo(
    () =>
      buildExportFilenameBasename(markdown, {
        template: prefs.filenameTemplate,
        fallbackFilename: importedFilename,
      }),
    [markdown, prefs.filenameTemplate, importedFilename]
  );

  const printTitleRef = useRef<string>(exportBasename);
  printTitleRef.current = exportBasename;

  useEffect(() => {
    setImportedFilename(null);
    setCursorLine(1);
    setJumpRequest(null);
    setRestoreNotice(null);
  }, [activeDocId]);

  const handleSelectOutlineHeading = useCallback(
    (heading: OutlineHeading) => {
      const requestId = ++jumpRequestSeqRef.current;
      setCursorLine(heading.line);
      setJumpRequest({ line: heading.line, requestId });
      if (viewMode === "preview") {
        setViewMode("split");
      }
    },
    [viewMode]
  );

  const handleFrontmatterChange = useCallback(
    (nextFm: DocumentFrontmatter) => {
      const updated = updateMarkdownFrontmatter(markdown, nextFm);
      setMarkdown(updated);
    },
    [markdown, setMarkdown]
  );

  const handleUploadInlineImage = useCallback(
    async (file: File): Promise<string> => {
      const processed = await processUploadedImageFile(file, "inline");
      const assetId = `asset:img_${Date.now()}`;
      await saveAsset(assetId, processed.dataUrl);
      return assetId;
    },
    [saveAsset]
  );

  const handleDropFileOnPlaceholder = useCallback(
    async (assetKey: string, file: File) => {
      try {
        const processed = await processUploadedImageFile(file, "inline");
        await saveAsset(assetKey, processed.dataUrl);
        setAssetRestoreNonce((n) => n + 1);
        const keyLabel = assetKey.startsWith("asset:")
          ? assetKey.slice(6)
          : assetKey;
        showRestoreNotice(`「${file.name}」を ${keyLabel} として復元しました`);
      } catch (err) {
        setModalState({
          kind: "notice",
          title: "画像復元エラー",
          message:
            err instanceof Error
              ? err.message
              : "画像の読み込みに失敗しました。",
        });
      }
    },
    [saveAsset, showRestoreNotice]
  );

  const handleDropFilesOnPreview = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;

      if (unresolvedAssets.length === 0) {
        setModalState({
          kind: "asset-drop-result",
          restoredCount: 0,
          unmatchedFileNames: files.map((f) => f.name),
          skippedErrors: [],
          hadUnresolvedPlaceholders: false,
        });
        return;
      }

      const { matched, unmatchedFiles, nonImageFiles } =
        matchDroppedFilesToUnresolvedAssets(files, unresolvedAssets);

      const unmatchedFileNames = unmatchedFiles.map((f) => f.name);
      const skippedErrors = nonImageFiles.map(
        (f) => `${f.name}（サポート対象外のファイル形式）`
      );
      const newEntries: Record<string, string> = {};
      let restoredCount = 0;

      if (matched.length > 0) {
        const showProgress = matched.length > 1;
        let processedCount = 0;
        if (showProgress) {
          setRestoreProgress({ processed: 0, total: matched.length });
        }

        try {
          for (
            let i = 0;
            i < matched.length;
            i += BULK_ASSET_RESTORE_CONCURRENCY
          ) {
            const chunk = matched.slice(i, i + BULK_ASSET_RESTORE_CONCURRENCY);
            const results = await Promise.all(
              chunk.map(async (item) => {
                try {
                  const processed = await processUploadedImageFile(
                    item.file,
                    "inline"
                  );
                  return {
                    ok: true as const,
                    assetKeys: item.assetKeys,
                    dataUrl: processed.dataUrl,
                  };
                } catch (err) {
                  return {
                    ok: false as const,
                    error:
                      err instanceof Error
                        ? err.message
                        : `${item.file.name} の読込失敗`,
                  };
                }
              })
            );

            for (const res of results) {
              if (res.ok) {
                for (const key of res.assetKeys) {
                  newEntries[key] = res.dataUrl;
                  restoredCount += 1;
                }
              } else {
                skippedErrors.push(res.error);
              }
            }

            processedCount += chunk.length;
            if (showProgress) {
              setRestoreProgress({
                processed: processedCount,
                total: matched.length,
              });
            }

            if (matched.length > BULK_ASSET_RESTORE_CONCURRENCY) {
              await new Promise<void>((resolve) => setTimeout(resolve, 0));
            }
          }
        } finally {
          setRestoreProgress(null);
        }
      }

      if (Object.keys(newEntries).length > 0) {
        await saveAssetsBatch(newEntries);
        setAssetRestoreNonce((n) => n + 1);
      }

      if (unmatchedFileNames.length > 0 || skippedErrors.length > 0) {
        setModalState({
          kind: "asset-drop-result",
          restoredCount,
          unmatchedFileNames,
          skippedErrors,
          hadUnresolvedPlaceholders: true,
        });
      } else if (restoredCount > 0) {
        showRestoreNotice(`${restoredCount} 件の未解決画像を復元しました`);
      }
    },
    [saveAssetsBatch, showRestoreNotice, unresolvedAssets]
  );

  const handleImportFolder = useCallback(
    async (fileList: FileList) => {
      const allFiles = Array.from(fileList);
      if (allFiles.length === 0) return;

      const mdFiles = allFiles
        .filter((f) => MARKDOWN_EXTENSIONS.test(f.name))
        .sort((a, b) => {
          const depthA = (a.webkitRelativePath || a.name).split("/").length;
          const depthB = (b.webkitRelativePath || b.name).split("/").length;
          if (depthA !== depthB) return depthA - depthB;
          const aIsReadme = a.name.toLowerCase() === "readme.md" ? 1 : 0;
          const bIsReadme = b.name.toLowerCase() === "readme.md" ? 1 : 0;
          return aIsReadme - bIsReadme;
        });

      const imageFiles = allFiles.filter(
        (f) => f.type.startsWith("image/") || IMAGE_EXTENSIONS.test(f.name)
      );

      if (mdFiles.length === 0 && imageFiles.length === 0) {
        setModalState({
          kind: "notice",
          title: "フォルダ読込",
          message: "フォルダ内に .md ファイルおよび画像ファイルが見つかりませんでした。",
        });
        return;
      }

      const newAssets: Record<string, string> = {};
      const skippedReasons: string[] = [];
      let totalAcceptedBytes = 0;

      for (const imgFile of imageFiles) {
        try {
          const processed = await processUploadedImageFile(imgFile, "inline");
          if (
            totalAcceptedBytes + processed.finalBytes >
            MAX_FOLDER_TOTAL_IMAGE_BYTES
          ) {
            skippedReasons.push(
              `${imgFile.name}（合計サイズ上限 ${formatImageLimitMb(MAX_FOLDER_TOTAL_IMAGE_BYTES)} 超過）`
            );
            continue;
          }
          const relRaw = imgFile.webkitRelativePath || imgFile.name;
          const parts = relRaw.split("/");
          const relPath =
            parts.length > 1 ? parts.slice(1).join("/") : relRaw;
          newAssets[`rel:${relPath}`] = processed.dataUrl;
          totalAcceptedBytes += processed.finalBytes;
        } catch (err) {
          skippedReasons.push(
            err instanceof Error ? err.message : `${imgFile.name} の読込失敗`
          );
        }
      }

      if (Object.keys(newAssets).length > 0) {
        await saveAssetsBatch(newAssets);
      }

      if (mdFiles.length > 0) {
        const mainMd = await mdFiles[0].text();
        setImportedFilename(mdFiles[0].name);
        setMarkdown(mainMd);
        if (skippedReasons.length > 0) {
          setModalState({
            kind: "notice",
            title: "一部画像をスキップしました",
            message: `${Object.keys(newAssets).length} 件の画像を取り込み、${skippedReasons.length} 件をスキップしました: ${skippedReasons.slice(0, 3).join(" / ")}`,
          });
        }
      } else {
        const skippedNote =
          skippedReasons.length > 0
            ? `（${skippedReasons.length} 件は上限超過等のためスキップ）`
            : "";
        setModalState({
          kind: "notice",
          title: "画像アセットを取り込みました",
          message: `${Object.keys(newAssets).length} 件の画像を取り込みました${skippedNote}（.md ファイルは見つからなかったため現在の本文を維持します）。`,
        });
      }
    },
    [saveAssetsBatch, setMarkdown]
  );

  const handleExportDocumentById = useCallback(
    async (docId: string) => {
      const exported = await getExpandedMarkdownForDoc(docId);
      if (exported) {
        const filename = buildExportFilename(exported.content, "md", {
          template: prefs.filenameTemplate,
          fallbackFilename: docId === activeDocId ? importedFilename : null,
        });
        downloadMarkdownFile(filename, exported.content);
      }
    },
    [
      activeDocId,
      getExpandedMarkdownForDoc,
      importedFilename,
      prefs.filenameTemplate,
    ]
  );

  const handleExportMarkdown = useCallback(() => {
    if (activeDocId) {
      void handleExportDocumentById(activeDocId);
    }
  }, [activeDocId, handleExportDocumentById]);

  const handleAddSharedAsset = useCallback(
    async (file: File) => {
      try {
        const processed = await processUploadedImageFile(file, "shared");
        const newId = `asset:shared_${Date.now()}_${Math.random()
          .toString(36)
          .slice(2, 5)}`;
        await saveAsset(newId, processed.dataUrl, file.name);
      } catch (err) {
        setModalState({
          kind: "notice",
          title: "共通画像の追加エラー",
          message:
            err instanceof Error
              ? err.message
              : "画像の読み込みに失敗しました。",
        });
      }
    },
    [saveAsset]
  );

  const handleApplySharedAsset = useCallback(
    (role: SharedAssetRole, assetId: string) => {
      const nextFm: DocumentFrontmatter = {
        ...parsed.frontmatter,
        [role]: assetId,
      };
      if (role === "cover_image") {
        nextFm.cover = true;
      } else if (role === "back_cover_image") {
        nextFm.back_cover = true;
      }
      handleFrontmatterChange(nextFm);
    },
    [handleFrontmatterChange, parsed.frontmatter]
  );

  const setPreviewWrapperPrintAccessibility = useCallback(
    (printing: boolean) => {
      const wrapper = previewWrapperRef.current;
      if (!wrapper) return;
      if (printing) {
        wrapper.removeAttribute("aria-hidden");
        wrapper.removeAttribute("inert");
      } else if (isPreviewHiddenRef.current) {
        wrapper.setAttribute("aria-hidden", "true");
        wrapper.setAttribute("inert", "");
      } else {
        wrapper.removeAttribute("aria-hidden");
        wrapper.removeAttribute("inert");
      }
    },
    []
  );

  const applyPrintTitle = useCallback(() => {
    if (previousDocumentTitleRef.current === null) {
      previousDocumentTitleRef.current = document.title;
    }
    document.title = printTitleRef.current;
    setPreviewWrapperPrintAccessibility(true);
  }, [setPreviewWrapperPrintAccessibility]);

  const restorePrintTitle = useCallback(() => {
    if (previousDocumentTitleRef.current !== null) {
      document.title = previousDocumentTitleRef.current;
      previousDocumentTitleRef.current = null;
    }
    setPreviewWrapperPrintAccessibility(false);
  }, [setPreviewWrapperPrintAccessibility]);

  useEffect(() => {
    window.addEventListener("beforeprint", applyPrintTitle);
    window.addEventListener("afterprint", restorePrintTitle);

    const mediaQuery =
      typeof window.matchMedia === "function"
        ? window.matchMedia("print")
        : null;
    const handlePrintMediaChange = (event: MediaQueryListEvent) => {
      if (event.matches) {
        applyPrintTitle();
      } else {
        restorePrintTitle();
      }
    };
    mediaQuery?.addEventListener?.("change", handlePrintMediaChange);

    return () => {
      window.removeEventListener("beforeprint", applyPrintTitle);
      window.removeEventListener("afterprint", restorePrintTitle);
      mediaQuery?.removeEventListener?.("change", handlePrintMediaChange);
      restorePrintTitle();
    };
  }, [applyPrintTitle, restorePrintTitle]);

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

    const previewHandle = previewPaneRef.current;
    if (previewHandle && !previewHandle.isUpToDate()) {
      isPreparingPrintRef.current = true;
      setIsPreparingPrint(true);
      void previewHandle
        .renderNow()
        .then((result) => {
          if (!isMountedRef.current) return;
          if (result.ok) {
            runWindowPrint();
          } else if (!result.cancelled) {
            setModalState({
              kind: "notice",
              title: "PDF出力エラー",
              message:
                result.error ||
                "組版レンダリングに失敗したため、PDF出力を開始できませんでした。プレビュー表示に切り替えて内容を確認してください。",
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

  const handlePrint = useCallback(() => {
    const showHeaderFooterNotice = !prefs.skipPrintHeaderFooterNotice;
    const preflightReport = prefs.enablePreflightCheck
      ? runPreflightCheck(markdown, assets, {
          ngWords: prefs.preflightNgWords,
        })
      : null;
    const hasPreflightIssues = (preflightReport?.issues.length ?? 0) > 0;

    if (
      unresolvedAssets.length > 0 ||
      hasPreflightIssues ||
      showHeaderFooterNotice
    ) {
      setSkipPrintNoticeNextTime(false);
      setModalState({
        kind: "print-confirm",
        unresolvedItems: unresolvedAssets,
        preflightReport,
        showHeaderFooterNotice,
      });
      return;
    }
    executePrint();
  }, [
    assets,
    executePrint,
    markdown,
    prefs.enablePreflightCheck,
    prefs.preflightNgWords,
    prefs.skipPrintHeaderFooterNotice,
    unresolvedAssets,
  ]);

  const handleJumpToPreflightLine = useCallback(
    (line: number) => {
      closeModal();
      const requestId = ++jumpRequestSeqRef.current;
      setCursorLine(line);
      setJumpRequest({ line, requestId });
      if (viewMode === "preview") {
        setViewMode("split");
      }
    },
    [closeModal, viewMode]
  );

  const startResize = useCallback(() => {
    isResizingRef.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onPointerMove = (e: PointerEvent) => {
      if (!isResizingRef.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const rawPercent = ((e.clientX - rect.left) / rect.width) * 100;
      const clamped = Math.min(75, Math.max(25, rawPercent));
      setSplitPercent(clamped);
    };

    const onPointerUp = () => {
      isResizingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }, []);

  const handleResizeKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setSplitPercent((prev) => Math.max(25, prev - 2));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setSplitPercent((prev) => Math.min(75, prev + 2));
      } else if (e.key === "Home") {
        e.preventDefault();
        setSplitPercent(25);
      } else if (e.key === "End") {
        e.preventDefault();
        setSplitPercent(75);
      }
    },
    []
  );

  if (!isLoaded) {
    return (
      <div className="flex h-dvh items-center justify-center bg-slate-950 text-sm text-slate-400">
        ワークスペースを読み込んでいます...
      </div>
    );
  }

  const totalDocsBytes = documentList.reduce((sum, d) => sum + d.totalBytes, 0);

  return (
    <div className="print-workspace-shell flex h-dvh flex-col overflow-hidden bg-slate-950">
      <TopToolbar
        title={parsed.frontmatter.title}
        saveStatus={saveStatus}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onImportMarkdown={(content, filename) => {
          setImportedFilename(filename ?? null);
          setMarkdown(content);
        }}
        onImportFolder={handleImportFolder}
        onExportMarkdown={handleExportMarkdown}
        onPrint={handlePrint}
        isPreparingPrint={isPreparingPrint}
        isSidebarOpen={prefs.isSidebarOpen}
        onToggleSidebar={() =>
          void updatePrefs({ isSidebarOpen: !prefs.isSidebarOpen })
        }
        isSettingsOpen={isSettingsOpen}
        onToggleSettings={() => setIsSettingsOpen((v) => !v)}
      />

      <div className="print-workspace-shell flex min-h-0 flex-1 overflow-hidden">
        <DocumentSidebar
          isOpen={prefs.isSidebarOpen}
          activeDocId={activeDocId}
          activeFrontmatterAssets={{
            logo: parsed.frontmatter.logo,
            cover_image: parsed.frontmatter.cover_image,
            back_cover_image: parsed.frontmatter.back_cover_image,
          }}
          documents={documentList}
          sharedAssets={sharedAssetList}
          headings={outlineHeadings}
          activeHeadingId={activeOutlineHeadingId}
          onSelectHeading={handleSelectOutlineHeading}
          onSelectDocument={(docId) => void switchDocument(docId)}
          onCreateDocument={() => void createDocument()}
          onExportDocument={(docId) => void handleExportDocumentById(docId)}
          onRequestResetSample={() =>
            setModalState({
              kind: "reset-sample",
              docId: activeDocId,
              title: parsed.frontmatter.title.trim() || "無題のドキュメント",
            })
          }
          onRequestDeleteDocument={(doc) =>
            setModalState({ kind: "delete-doc", doc })
          }
          onRequestDeleteAllDocuments={() =>
            setModalState({
              kind: "delete-all-docs",
              count: documentList.length,
              totalBytes: totalDocsBytes,
            })
          }
          onAddSharedAsset={(file) => void handleAddSharedAsset(file)}
          onApplySharedAsset={handleApplySharedAsset}
          onRequestDeleteSharedAsset={(asset) =>
            setModalState({ kind: "delete-shared-asset", asset })
          }
          onRequestDeleteAllSharedAssets={() =>
            setModalState({
              kind: "delete-all-shared-assets",
              count: sharedAssetList.length,
            })
          }
        />

        <div
          ref={containerRef}
          className="print-workspace-shell flex min-w-0 flex-1 overflow-hidden"
        >
          {viewMode !== "preview" && (
            <div
              className="no-print min-h-0 overflow-hidden"
              style={{
                width: viewMode === "split" ? `${splitPercent}%` : "100%",
              }}
            >
              <EditorPane
                value={markdown}
                onChange={setMarkdown}
                onUploadImage={handleUploadInlineImage}
                jumpRequest={jumpRequest}
                onCursorLineChange={setCursorLine}
              />
            </div>
          )}

          {viewMode === "split" && (
            <div
              role="separator"
              tabIndex={0}
              aria-orientation="vertical"
              aria-label="エディタとプレビューの幅を調整"
              aria-valuemin={25}
              aria-valuemax={75}
              aria-valuenow={Math.round(splitPercent)}
              onPointerDown={startResize}
              onKeyDown={handleResizeKeyDown}
              title="ドラッグまたは左右キーで幅を調整"
              className="no-print w-1.5 shrink-0 cursor-col-resize bg-slate-800 transition hover:bg-sky-500 focus:bg-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-400"
            />
          )}

          <div
            ref={previewWrapperRef}
            aria-hidden={isPreviewHidden || undefined}
            inert={isPreviewHidden ? true : undefined}
            className={`print-preview-pane min-h-0 min-w-0 flex-1 overflow-hidden ${
              isPreviewHidden ? "print-preview-pane-screen-hidden" : ""
            }`}
          >
            <PagedPreviewPane
              ref={previewPaneRef}
              documentId={activeDocId}
              markdown={markdown}
              frontmatter={parsed.frontmatter}
              assets={assets}
              autoUpdate={prefs.autoUpdate}
              onToggleAutoUpdate={(val) => updatePrefs({ autoUpdate: val })}
              showMarginGuides={prefs.showMarginGuides}
              onToggleMarginGuides={(val) =>
                updatePrefs({ showMarginGuides: val })
              }
              layoutMode={prefs.layoutMode}
              onLayoutModeChange={(mode) => updatePrefs({ layoutMode: mode })}
              unresolvedAssets={unresolvedAssets}
              onDropFileOnPlaceholder={handleDropFileOnPlaceholder}
              onDropFilesOnPreview={handleDropFilesOnPreview}
              restoreProgress={restoreProgress}
              restoreNotice={restoreNotice}
              onDismissRestoreNotice={() => setRestoreNotice(null)}
              assetRestoreNonce={assetRestoreNonce}
            />
          </div>
        </div>

        <DocumentSettingsDrawer
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          frontmatter={parsed.frontmatter}
          assets={assets}
          sharedAssets={sharedAssetList}
          filenameTemplate={prefs.filenameTemplate}
          onChangeFilenameTemplate={(nextTemplate) =>
            void updatePrefs({ filenameTemplate: nextTemplate })
          }
          exportFilenamePreview={{
            pdf: `${exportBasename}.pdf`,
            md: `${exportBasename}.md`,
          }}
          skipPrintHeaderFooterNotice={prefs.skipPrintHeaderFooterNotice}
          onChangeSkipPrintHeaderFooterNotice={(skip) =>
            void updatePrefs({ skipPrintHeaderFooterNotice: skip })
          }
          enablePreflightCheck={prefs.enablePreflightCheck}
          onChangeEnablePreflightCheck={(enabled) =>
            void updatePrefs({ enablePreflightCheck: enabled })
          }
          preflightNgWords={prefs.preflightNgWords}
          onChangePreflightNgWords={(words) =>
            void updatePrefs({ preflightNgWords: words })
          }
          onChangeFrontmatter={handleFrontmatterChange}
          onSaveAsset={saveAsset}
          onRemoveAsset={removeAsset}
          onNotice={(title, message) =>
            setModalState({ kind: "notice", title, message })
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
        aria-labelledby="mdpub-dialog-title"
      >
        {effectiveModal?.kind === "notice" && (
          <div className="p-5">
            <h2
              id="mdpub-dialog-title"
              className="text-sm font-semibold text-white"
            >
              {effectiveModal.title}
            </h2>
            <p className="mt-2 text-xs leading-relaxed text-slate-300">
              {effectiveModal.message}
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

        {effectiveModal?.kind === "asset-drop-result" && (
          <div className="p-5">
            <h2
              id="mdpub-dialog-title"
              className="text-sm font-semibold text-white"
            >
              {effectiveModal.restoredCount > 0
                ? `${effectiveModal.restoredCount} 件の画像を復元しました`
                : effectiveModal.hadUnresolvedPlaceholders
                  ? "一致するプレースホルダが見つかりませんでした"
                  : "未解決の画像プレースホルダはありません"}
            </h2>
            {!effectiveModal.hadUnresolvedPlaceholders && (
              <p className="mt-2 text-xs leading-relaxed text-slate-300">
                現在の文書には未解決の <code>asset:</code> 画像がありません。新しい画像を本文へ挿入する場合は、エディタ側へドロップしてください。
              </p>
            )}
            {effectiveModal.unmatchedFileNames.length > 0 && (
              <div className="mt-3">
                <p className="text-xs font-medium text-amber-300">
                  一致しなかったファイル（{effectiveModal.unmatchedFileNames.length}件）
                </p>
                <ul className="mt-1.5 max-h-40 space-y-1 overflow-y-auto rounded border border-slate-800 bg-slate-950/70 p-2 font-mono text-[11px] text-slate-200">
                  {effectiveModal.unmatchedFileNames.map((name, idx) => (
                    <li key={`${name}-${idx}`} className="truncate" title={name}>
                      {name}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {effectiveModal.skippedErrors.length > 0 && (
              <div className="mt-3">
                <p className="text-xs font-medium text-red-300">
                  スキップされたファイル（{effectiveModal.skippedErrors.length}件）
                </p>
                <ul className="mt-1.5 max-h-32 space-y-1 overflow-y-auto rounded border border-slate-800 bg-slate-950/70 p-2 text-[11px] text-red-200">
                  {effectiveModal.skippedErrors.map((errMsg, idx) => (
                    <li key={idx} className="leading-relaxed">
                      {errMsg}
                    </li>
                  ))}
                </ul>
              </div>
            )}
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

        {effectiveModal?.kind === "print-confirm" && (() => {
          const preflightIssues = effectiveModal.preflightReport?.issues ?? [];
          const summary = effectiveModal.preflightReport?.summary ?? null;
          const hasWarnings =
            effectiveModal.unresolvedItems.length > 0 ||
            preflightIssues.length > 0;

          return (
            <div className="p-5">
              {effectiveModal.unresolvedItems.length > 0 ? (
                <h2
                  id="mdpub-dialog-title"
                  className="text-sm font-semibold text-amber-300"
                >
                  未解決の画像があります（{effectiveModal.unresolvedItems.length}件）
                </h2>
              ) : preflightIssues.length > 0 ? (
                <h2
                  id="mdpub-dialog-title"
                  className="text-sm font-semibold text-amber-300"
                >
                  出力前プリフライトチェック（{preflightIssues.length}件の確認事項）
                </h2>
              ) : (
                <h2
                  id="mdpub-dialog-title"
                  className="text-sm font-semibold text-sky-300"
                >
                  印刷前の確認（ヘッダー／フッター設定）
                </h2>
              )}

              {summary && (
                <div
                  aria-label="出力設定サマリー"
                  className="mt-2.5 flex flex-wrap items-center gap-1.5 rounded-md border border-slate-800 bg-slate-950/60 px-2.5 py-2 text-[10px] text-slate-300"
                >
                  <span className="rounded bg-slate-800 px-1.5 py-0.5">
                    用紙: {summary.pageLabel}
                  </span>
                  <span className="rounded bg-slate-800 px-1.5 py-0.5">
                    表紙: {summary.cover ? "あり" : "なし"}
                  </span>
                  <span
                    className={`rounded px-1.5 py-0.5 ${
                      summary.logoStatus === "missing"
                        ? "bg-amber-950/80 text-amber-300"
                        : "bg-slate-800"
                    }`}
                  >
                    ロゴ:{" "}
                    {summary.logoStatus === "configured"
                      ? "あり"
                      : summary.logoStatus === "missing"
                        ? "未登録"
                        : "なし"}
                  </span>
                  <span className="rounded bg-slate-800 px-1.5 py-0.5">
                    透かし: {summary.confidentialLabel ?? "なし"}
                  </span>
                </div>
              )}

              {effectiveModal.unresolvedItems.length > 0 && (
                <>
                  <p className="mt-2 text-xs leading-relaxed text-slate-300">
                    以下の画像は現在の文書に登録されていません。このまま出力すると、枠・アイコン・文字を消した空欄のまま箱の寸法を保って出力されます（プレビューと PDF のページ数は一致します）。
                  </p>
                  <ul className="mt-2.5 max-h-36 space-y-1 overflow-y-auto rounded border border-slate-800 bg-slate-950/70 p-2.5 font-mono text-[11px] text-amber-200">
                    {effectiveModal.unresolvedItems.map((item) => (
                      <li
                        key={item.assetKey}
                        className="flex items-center justify-between gap-2"
                        title={item.assetKey}
                      >
                        <span className="min-w-0 truncate">{item.displayName}</span>
                        {item.occurrences > 1 && (
                          <span className="shrink-0 tabular-nums text-[10px] text-slate-400">
                            ×{item.occurrences}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {preflightIssues.length > 0 && (
                <div className="mt-3">
                  {effectiveModal.unresolvedItems.length > 0 && (
                    <p className="mb-1.5 text-xs font-semibold text-amber-300">
                      プリフライトチェック（{preflightIssues.length}件）
                    </p>
                  )}
                  <ul className="max-h-44 space-y-1.5 overflow-y-auto rounded border border-slate-800 bg-slate-950/70 p-2 text-[11px]">
                    {preflightIssues.map((issue) => {
                      const badgeLabel = PREFLIGHT_CATEGORY_LABELS[issue.category];
                      const badgeTone =
                        issue.category === "ng-word"
                          ? "bg-red-950/80 text-red-300 border-red-800/60"
                          : "bg-amber-950/80 text-amber-300 border-amber-800/60";
                      const content = (
                        <div className="flex w-full items-start gap-2 text-left">
                          <span
                            className={`mt-0.5 shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-semibold ${badgeTone}`}
                          >
                            {badgeLabel}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-slate-100">{issue.message}</span>
                              {typeof issue.line === "number" && (
                                <span className="shrink-0 font-mono text-[10px] tabular-nums text-sky-400">
                                  L{issue.line}
                                </span>
                              )}
                            </div>
                            {issue.snippet && (
                              <p className="mt-0.5 truncate font-mono text-[10px] text-slate-400">
                                {issue.snippet}
                              </p>
                            )}
                          </div>
                        </div>
                      );

                      return (
                        <li key={issue.id}>
                          {typeof issue.line === "number" ? (
                            <button
                              type="button"
                              onClick={() =>
                                handleJumpToPreflightLine(issue.line!)
                              }
                              title={`L${issue.line} へ移動して修正する`}
                              className="w-full rounded px-2 py-1.5 transition hover:bg-slate-800/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
                            >
                              {content}
                            </button>
                          ) : (
                            <div className="px-2 py-1.5">{content}</div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  <p className="mt-1 text-[10px] text-slate-400">
                    ※ 項目をクリックするとエディタの該当行へ移動します。
                  </p>
                </div>
              )}

              {effectiveModal.showHeaderFooterNotice && (
                <div
                  className={
                    hasWarnings
                      ? "mt-3 rounded-md border border-sky-500/30 bg-sky-950/25 p-3"
                      : "mt-2.5"
                  }
                >
                  {hasWarnings && (
                    <p className="text-xs font-semibold text-sky-300">
                      ブラウザ印刷設定の確認
                    </p>
                  )}
                  <p
                    className={`${
                      hasWarnings ? "mt-1" : ""
                    } text-xs leading-relaxed text-slate-300`}
                  >
                    ブラウザ印刷の「ヘッダーとフッター」が有効なままだと、社内 URL や印刷日時が PDF の上下余白に印字される恐れがあります。
                  </p>
                  <ul className="mt-2.5 space-y-1.5 rounded-md border border-slate-800 bg-slate-950/70 p-2.5 text-[11px] leading-relaxed text-slate-200">
                    <li className="flex items-start gap-2">
                      <span className="mt-0.5 text-amber-300" aria-hidden="true">
                        •
                      </span>
                      <span>
                        詳細設定 → オプションの{" "}
                        <strong className="text-white">
                          「ヘッダーとフッター」をオフ
                        </strong>{" "}
                        にしてください
                      </span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="mt-0.5 text-sky-400" aria-hidden="true">
                        •
                      </span>
                      <span>
                        <strong className="text-white">
                          「背景のグラフィック」はオン
                        </strong>{" "}
                        を推奨（表紙・色帯の出力に必要）
                      </span>
                    </li>
                  </ul>
                  <label className="mt-3 flex cursor-pointer items-center gap-2 text-[11px] text-slate-300">
                    <input
                      type="checkbox"
                      checked={skipPrintNoticeNextTime}
                      onChange={(e) =>
                        setSkipPrintNoticeNextTime(e.target.checked)
                      }
                      className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-900 accent-sky-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
                    />
                    <span>次回からこの注意喚起を表示しない</span>
                  </label>
                </div>
              )}

              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-300 transition hover:bg-slate-800"
                >
                  キャンセル
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (
                      effectiveModal.showHeaderFooterNotice &&
                      skipPrintNoticeNextTime
                    ) {
                      void updatePrefs({ skipPrintHeaderFooterNotice: true });
                    }
                    if (dialogRef.current?.open) {
                      if (typeof dialogRef.current.close === "function") {
                        dialogRef.current.close();
                      } else {
                        dialogRef.current.removeAttribute("open");
                      }
                    }
                    setModalState(null);
                    executePrint();
                  }}
                  className={`rounded-md px-3.5 py-1.5 text-xs font-semibold text-white transition ${
                    hasWarnings
                      ? "bg-amber-600 hover:bg-amber-500"
                      : "bg-sky-600 hover:bg-sky-500"
                  }`}
                >
                  {hasWarnings ? "このまま出力" : "印刷ダイアログを開く"}
                </button>
              </div>
            </div>
          );
        })()}

        {effectiveModal?.kind === "reset-sample" && (
          <div className="p-5">
            <h2
              id="mdpub-dialog-title"
              className="text-sm font-semibold text-amber-300"
            >
              現在の文書をサンプルで上書きしますか？
            </h2>
            <p className="mt-2 text-xs leading-relaxed text-slate-300">
              編集中の文書「
              <strong className="text-white">{effectiveModal.title}</strong>
              」の本文を初期サンプル Markdown で上書きします。現在の編集内容は失われます。
            </p>
            <p className="mt-1.5 text-[11px] text-slate-400">
              ※ 他の文書および共通画像（ロゴ・表紙・裏表紙）は維持されます。必要に応じて先にバックアップを保存してください。
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={() =>
                  void handleExportDocumentById(effectiveModal.docId)
                }
                className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-slate-700"
              >
                先に .md を保存
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-300 transition hover:bg-slate-800"
                >
                  キャンセル
                </button>
                <button
                  type="button"
                  onClick={() => {
                    closeModal();
                    setImportedFilename(null);
                    void resetToSample();
                  }}
                  className="rounded-md bg-amber-600 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-500"
                >
                  サンプルを復元する
                </button>
              </div>
            </div>
          </div>
        )}

        {effectiveModal?.kind === "delete-doc" && (
          <div className="p-5">
            <h2
              id="mdpub-dialog-title"
              className="text-sm font-semibold text-red-300"
            >
              文書を削除しますか？
            </h2>
            <p className="mt-2 text-xs leading-relaxed text-slate-300">
              「<strong className="text-white">{effectiveModal.doc.title}</strong>」
              およびこの文書に紐づくインライン画像（{effectiveModal.doc.assetCount}件 /{" "}
              {formatBytes(effectiveModal.doc.assetsBytes)}）を削除します。
              この操作は取り消せません。
            </p>
            <p className="mt-1.5 text-[11px] text-slate-400">
              ※ 「先に .md を保存」には本文とインライン画像が含まれます（ロゴ・表紙等の共通画像は含まれません）。
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => void handleExportDocumentById(effectiveModal.doc.id)}
                className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-slate-700"
              >
                先に .md を保存
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-300 transition hover:bg-slate-800"
                >
                  キャンセル
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const id = effectiveModal.doc.id;
                    closeModal();
                    await deleteDocument(id);
                  }}
                  className="rounded-md bg-red-600 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-red-500"
                >
                  削除する
                </button>
              </div>
            </div>
          </div>
        )}

        {effectiveModal?.kind === "delete-all-docs" && (
          <div className="p-5">
            <h2
              id="mdpub-dialog-title"
              className="text-sm font-semibold text-red-300"
            >
              全ドキュメントを消去・初期化しますか？
            </h2>
            <p className="mt-2 text-xs leading-relaxed text-slate-300">
              登録されている {effectiveModal.count} 件の文書と独立画像（合計{" "}
              {formatBytes(effectiveModal.totalBytes)}）を削除し、新しい空の文書 1 件にリセットします。
              この操作は取り消せません。
            </p>
            <p className="mt-1.5 text-[11px] text-slate-400">
              ※ UI設定（表示形式など）および共通画像（ロゴ・表紙・裏表紙）は保持されます。
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeModal}
                className="rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-300 transition hover:bg-slate-800"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={async () => {
                  closeModal();
                  await deleteAllDocuments();
                }}
                className="rounded-md bg-red-600 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-red-500"
              >
                消去・初期化する
              </button>
            </div>
          </div>
        )}

        {effectiveModal?.kind === "delete-shared-asset" && (
          <div className="p-5">
            <h2
              id="mdpub-dialog-title"
              className="text-sm font-semibold text-red-300"
            >
              共通画像を削除しますか？
            </h2>
            <p className="mt-2 text-xs leading-relaxed text-slate-300">
              「<strong className="text-white">{effectiveModal.asset.label}</strong>」を削除します。
              削除すると、この画像を参照しているすべての文書でロゴ・表紙等が表示されなくなります。
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeModal}
                className="rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-300 transition hover:bg-slate-800"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={async () => {
                  const id = effectiveModal.asset.assetId;
                  closeModal();
                  await removeAsset(id);
                }}
                className="rounded-md bg-red-600 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-red-500"
              >
                削除する
              </button>
            </div>
          </div>
        )}

        {effectiveModal?.kind === "delete-all-shared-assets" && (
          <div className="p-5">
            <h2
              id="mdpub-dialog-title"
              className="text-sm font-semibold text-red-300"
            >
              すべての共通画像を削除しますか？
            </h2>
            <p className="mt-2 text-xs leading-relaxed text-slate-300">
              登録されている {effectiveModal.count} 件の共通画像（ロゴ・表紙・裏表紙）をすべて削除します。
              この操作は取り消せません。
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeModal}
                className="rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-300 transition hover:bg-slate-800"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={async () => {
                  closeModal();
                  await clearSharedAssets();
                }}
                className="rounded-md bg-red-600 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-red-500"
              >
                消去・初期化する
              </button>
            </div>
          </div>
        )}
      </dialog>
    </div>
  );
}