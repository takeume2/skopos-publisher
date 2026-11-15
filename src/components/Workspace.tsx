"use client";

import React, { useCallback, useMemo, useRef, useState } from "react";
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

  const containerRef = useRef<HTMLDivElement>(null);
  const isResizingRef = useRef<boolean>(false);

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
        alert("フォルダ内に .md ファイルおよび画像ファイルが見つかりませんでした。");
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
        alert(
          `${Object.keys(newAssets).length} 件の画像を取り込みました（.md ファイルは見つからなかったため現在の本文を維持します）。`
        );
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

    const onMouseMove = (e: MouseEvent) => {
      if (!isResizingRef.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const rawPercent = ((e.clientX - rect.left) / rect.width) * 100;
      const clamped = Math.min(75, Math.max(25, rawPercent));
      setSplitPercent(clamped);
    };

    const onMouseUp = () => {
      isResizingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, []);

  if (!isLoaded) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950 text-sm text-slate-400">
        ワークスペースを読み込んでいます...
      </div>
    );
  }

  return (
    <div className="print-workspace-shell flex h-screen flex-col overflow-hidden bg-slate-950">
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
              onMouseDown={startResize}
              title="ドラッグして幅を調整"
              className="no-print w-1.5 shrink-0 cursor-col-resize bg-slate-800 transition hover:bg-sky-500"
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
    </div>
  );
}
