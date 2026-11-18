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
import type { DocumentFrontmatter } from "@/types/document";
import { DocumentSettingsDrawer } from "./DocumentSettingsDrawer";
import { DocumentSidebar, SharedAssetRole } from "./DocumentSidebar";
import { EditorPane } from "./EditorPane";
import { PagedPreviewPane } from "./PagedPreviewPane";
import { TopToolbar, ViewMode } from "./TopToolbar";

const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i;
const MARKDOWN_EXTENSIONS = /\.(md|markdown)$/i;

type ModalState =
  | { kind: "notice"; title: string; message: string }
  | { kind: "delete-doc"; doc: DocumentSummary }
  | { kind: "delete-all-docs"; count: number; totalBytes: number }
  | { kind: "delete-shared-asset"; asset: SharedAssetSummary }
  | { kind: "delete-all-shared-assets"; count: number }
  | null;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error(`Failed to read ${file.name}`));
      }
    };
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

function downloadMarkdownFile(title: string, content: string) {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const safeTitle = (title || "document").replace(/[\\/:*?"<>|]/g, "_").trim();
  a.href = url;
  a.download = `${safeTitle || "document"}.md`;
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

  const containerRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const isResizingRef = useRef<boolean>(false);

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
        dialogEl.showModal();
      }
    } else if (dialogEl.open) {
      dialogEl.close();
    }
  }, [effectiveModal]);

  const closeModal = useCallback(() => {
    if (storageError) {
      clearStorageError();
    }
    setModalState(null);
  }, [clearStorageError, storageError]);

  const parsed = useMemo(() => parseMarkdownDocument(markdown), [markdown]);

  const handleFrontmatterChange = useCallback(
    (nextFm: DocumentFrontmatter) => {
      const updated = updateMarkdownFrontmatter(markdown, nextFm);
      setMarkdown(updated);
    },
    [markdown, setMarkdown]
  );

  const handleUploadInlineImage = useCallback(
    async (file: File): Promise<string> => {
      const dataUrl = await readFileAsDataUrl(file);
      const assetId = `asset:img_${Date.now()}`;
      await saveAsset(assetId, dataUrl);
      return assetId;
    },
    [saveAsset]
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
      await Promise.all(
        imageFiles.map(async (imgFile) => {
          const dataUrl = await readFileAsDataUrl(imgFile);
          const relRaw = imgFile.webkitRelativePath || imgFile.name;
          const parts = relRaw.split("/");
          const relPath =
            parts.length > 1 ? parts.slice(1).join("/") : relRaw;
          newAssets[`rel:${relPath}`] = dataUrl;
        })
      );

      if (Object.keys(newAssets).length > 0) {
        await saveAssetsBatch(newAssets);
      }

      if (mdFiles.length > 0) {
        const mainMd = await mdFiles[0].text();
        setMarkdown(mainMd);
      } else {
        setModalState({
          kind: "notice",
          title: "画像アセットを取り込みました",
          message: `${Object.keys(newAssets).length} 件の画像を取り込みました（.md ファイルは見つからなかったため現在の本文を維持します）。`,
        });
      }
    },
    [saveAssetsBatch, setMarkdown]
  );

  const handleExportDocumentById = useCallback(
    async (docId: string) => {
      const exported = await getExpandedMarkdownForDoc(docId);
      if (exported) {
        downloadMarkdownFile(exported.title, exported.content);
      }
    },
    [getExpandedMarkdownForDoc]
  );

  const handleExportMarkdown = useCallback(() => {
    if (activeDocId) {
      void handleExportDocumentById(activeDocId);
    }
  }, [activeDocId, handleExportDocumentById]);

  const handleAddSharedAsset = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/")) return;
      const dataUrl = await readFileAsDataUrl(file);
      const newId = `asset:shared_${Date.now()}_${Math.random()
        .toString(36)
        .slice(2, 5)}`;
      await saveAsset(newId, dataUrl, file.name);
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

  const handlePrint = useCallback(() => {
    window.print();
  }, []);

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
        onResetSample={resetToSample}
        onImportMarkdown={(content) => setMarkdown(content)}
        onImportFolder={handleImportFolder}
        onExportMarkdown={handleExportMarkdown}
        onPrint={handlePrint}
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
          onSelectDocument={(docId) => void switchDocument(docId)}
          onCreateDocument={() => void createDocument()}
          onExportDocument={(docId) => void handleExportDocumentById(docId)}
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

          {viewMode !== "editor" && (
            <div className="print-preview-pane min-h-0 min-w-0 flex-1 overflow-hidden">
              <PagedPreviewPane
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
              />
            </div>
          )}
        </div>

        <DocumentSettingsDrawer
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          frontmatter={parsed.frontmatter}
          assets={assets}
          sharedAssets={sharedAssetList}
          onChangeFrontmatter={handleFrontmatterChange}
          onSaveAsset={saveAsset}
          onRemoveAsset={removeAsset}
        />
      </div>

      <dialog
        ref={dialogRef}
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