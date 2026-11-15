"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useIndexedDbStorage } from "@/hooks/useIndexedDbStorage";
import {
  parseMarkdownDocument,
  updateMarkdownFrontmatter,
} from "@/lib/frontmatter";
import { resolveAssetSrc } from "@/lib/markdown";
import type { DocumentFrontmatter } from "@/types/document";
import { DocumentSettingsDrawer } from "./DocumentSettingsDrawer";
import { EditorPane } from "./EditorPane";
import { PagedPreviewPane } from "./PagedPreviewPane";
import { TopToolbar, ViewMode } from "./TopToolbar";

const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i;
const MARKDOWN_EXTENSIONS = /\.(md|markdown)$/i;

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

export function Workspace() {
  const {
    markdown,
    setMarkdown,
    assets,
    saveAsset,
    saveAssetsBatch,
    removeAsset,
    prefs,
    updatePrefs,
    resetToSample,
    isLoaded,
    saveStatus,
  } = useIndexedDbStorage();

  const [viewMode, setViewMode] = useState<ViewMode>("split");
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(true);
  const [splitPercent, setSplitPercent] = useState<number>(46);

  const [noticeDialog, setNoticeDialog] = useState<{
    title: string;
    message: string;
  } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const isResizingRef = useRef<boolean>(false);

  useEffect(() => {
    const dialogEl = dialogRef.current;
    if (!dialogEl) return;
    if (noticeDialog) {
      if (!dialogEl.open) {
        dialogEl.showModal();
      }
    } else if (dialogEl.open) {
      dialogEl.close();
    }
  }, [noticeDialog]);

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
        setNoticeDialog({
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
          // 先頭の選択フォルダ名（例: "project-dir/images/a.png" -> "images/a.png"）を除去
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
        setNoticeDialog({
          title: "画像アセットを取り込みました",
          message: `${Object.keys(newAssets).length} 件の画像を取り込みました（.md ファイルは見つからなかったため現在の本文を維持します）。`,
        });
      }
    },
    [saveAssetsBatch, setMarkdown]
  );

  const handleExportMarkdown = useCallback(() => {
    const expandedMarkdown = markdown.replace(
      /(!\[[^\]]*\]\()([^)\s]+)(\))/g,
      (match, prefix: string, rawSrc: string, suffix: string) => {
        if (
          rawSrc.startsWith("http://") ||
          rawSrc.startsWith("https://") ||
          rawSrc.startsWith("data:")
        ) {
          return match;
        }
        const resolved = resolveAssetSrc(rawSrc, assets);
        return resolved !== rawSrc ? `${prefix}${resolved}${suffix}` : match;
      }
    );

    const blob = new Blob([expandedMarkdown], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safeTitle = (parsed.frontmatter.title || "document")
      .replace(/[\\/:*?"<>|]/g, "_")
      .trim();
    a.href = url;
    a.download = `${safeTitle}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [assets, markdown, parsed.frontmatter.title]);

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
        isSettingsOpen={isSettingsOpen}
        onToggleSettings={() => setIsSettingsOpen((v) => !v)}
      />

      <div className="print-workspace-shell flex min-h-0 flex-1 overflow-hidden">
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
          onChangeFrontmatter={handleFrontmatterChange}
          onSaveAsset={saveAsset}
          onRemoveAsset={removeAsset}
        />
      </div>
          <dialog
        ref={dialogRef}
        onClose={() => setNoticeDialog(null)}
        onClick={(e) => {
          if (e.target === dialogRef.current) {
            setNoticeDialog(null);
          }
        }}
        className="mdpub-dialog no-print"
        aria-labelledby="mdpub-dialog-title"
      >
        {noticeDialog && (
          <div className="p-5">
            <h2
              id="mdpub-dialog-title"
              className="text-sm font-semibold text-white"
            >
              {noticeDialog.title}
            </h2>
            <p className="mt-2 text-xs leading-relaxed text-slate-300">
              {noticeDialog.message}
            </p>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => setNoticeDialog(null)}
                className="rounded-md bg-sky-600 px-3.5 py-1.5 text-xs font-medium text-white transition hover:bg-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-400"
              >
                閉じる
              </button>
            </div>
          </div>
        )}
      </dialog>
    </div>
  );
}