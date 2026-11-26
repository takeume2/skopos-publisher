"use client";

import React, { useRef } from "react";
import {
  CheckCircle2,
  Columns2,
  Download,
  Eye,
  FileCode2,
  FolderOpen,
  Loader2,
  PanelLeft,
  Printer,
  RotateCcw,
  Settings,
  Upload,
} from "lucide-react";
import type { SaveStatus } from "@/hooks/useIndexedDbStorage";

export type ViewMode = "editor" | "split" | "preview";

interface TopToolbarProps {
  title: string;
  saveStatus: SaveStatus;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  onResetSample: () => void;
  onImportMarkdown: (content: string, filename?: string) => void;
  onImportFolder: (files: FileList) => void;
  onExportMarkdown: () => void;
  onPrint: () => void;
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
  isSettingsOpen: boolean;
  onToggleSettings: () => void;
}

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400";

export function TopToolbar({
  title,
  saveStatus,
  viewMode,
  onViewModeChange,
  onResetSample,
  onImportMarkdown,
  onImportFolder,
  onExportMarkdown,
  onPrint,
  isSidebarOpen,
  onToggleSidebar,
  isSettingsOpen,
  onToggleSettings,
}: TopToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    onImportMarkdown(text, file.name);
    e.target.value = "";
  };

  const handleFolderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    onImportFolder(files);
    e.target.value = "";
  };

  return (
    <header className="no-print flex h-[52px] shrink-0 items-center justify-between border-b border-slate-800 bg-slate-900 px-4 text-slate-100">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={onToggleSidebar}
          aria-expanded={isSidebarOpen}
          aria-label="サイドバー（文書・見出し・共通画像）を開閉"
          title="サイドバー（文書・見出し・共通画像）を開閉"
          className={`rounded-md border p-1.5 transition ${FOCUS_RING} ${
            isSidebarOpen
              ? "border-sky-500/60 bg-sky-600/20 text-sky-300"
              : "border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white"
          }`}
        >
          <PanelLeft className="h-4 w-4" />
        </button>

        <div className="flex items-center">
          <img
            src="/skopos-logo.svg"
            alt="Skopos Publisher"
            className="h-9 w-auto shrink-0"
          />
        </div>

        <span className="text-slate-700">/</span>

        <span className="max-w-[200px] truncate text-sm font-medium text-slate-200">
          {title || "無題のドキュメント"}
        </span>

        <span className="inline-flex items-center gap-1 rounded-full bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300">
          {saveStatus === "saving" || saveStatus === "loading" ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none text-amber-400" />
              <span>編集中...</span>
            </>
          ) : (
            <>
              <CheckCircle2 className="h-3 w-3 text-emerald-400" />
              <span>保存済み</span>
            </>
          )}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <div
          role="group"
          aria-label="表示モード切替"
          className="flex items-center rounded-md border border-slate-700 bg-slate-950 p-0.5"
        >
          <button
            type="button"
            aria-pressed={viewMode === "editor"}
            onClick={() => onViewModeChange("editor")}
            className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition ${FOCUS_RING} ${
              viewMode === "editor"
                ? "bg-slate-800 text-white"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <FileCode2 className="h-3.5 w-3.5" />
            <span className="hidden md:inline">エディタのみ</span>
          </button>
          <button
            type="button"
            aria-pressed={viewMode === "split"}
            onClick={() => onViewModeChange("split")}
            className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition ${FOCUS_RING} ${
              viewMode === "split"
                ? "bg-slate-800 text-white"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Columns2 className="h-3.5 w-3.5" />
            <span className="hidden md:inline">分割表示</span>
          </button>
          <button
            type="button"
            aria-pressed={viewMode === "preview"}
            onClick={() => onViewModeChange("preview")}
            className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition ${FOCUS_RING} ${
              viewMode === "preview"
                ? "bg-slate-800 text-white"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Eye className="h-3.5 w-3.5" />
            <span className="hidden md:inline">プレビューのみ</span>
          </button>
        </div>

        <button
          type="button"
          onClick={onResetSample}
          title="初期サンプルMarkdownへ復元"
          className={`inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800/70 px-2.5 py-1.5 text-xs text-slate-300 transition hover:bg-slate-800 hover:text-white ${FOCUS_RING}`}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          <span className="hidden lg:inline">サンプル復元</span>
        </button>
      </div>

      <div className="flex items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept=".md,.markdown,.txt"
          className="hidden"
          onChange={handleFileChange}
        />

        <input
          ref={folderInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFolderChange}
          {...({
            webkitdirectory: "",
            directory: "",
          } as React.InputHTMLAttributes<HTMLInputElement>)}
        />

        <button
          type="button"
          onClick={() => folderInputRef.current?.click()}
          title="原稿フォルダ（.md＋画像一式）を読み込む"
          className={`inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-slate-700 ${FOCUS_RING}`}
        >
          <FolderOpen className="h-3.5 w-3.5 text-sky-400" />
          <span className="hidden sm:inline">フォルダ読込</span>
        </button>

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className={`inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-slate-700 ${FOCUS_RING}`}
        >
          <Upload className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">.md読込</span>
        </button>

        <button
          type="button"
          onClick={onExportMarkdown}
          className={`inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-slate-700 ${FOCUS_RING}`}
        >
          <Download className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">.md保存</span>
        </button>

        <button
          type="button"
          onClick={onToggleSettings}
          aria-expanded={isSettingsOpen}
          className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition ${FOCUS_RING} ${
            isSettingsOpen
              ? "border-sky-500 bg-sky-600/20 text-sky-300"
              : "border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700"
          }`}
        >
          <Settings className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">設定</span>
        </button>

        <button
          type="button"
          onClick={onPrint}
          className={`inline-flex items-center gap-1.5 rounded-md bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-sky-500 ${FOCUS_RING}`}
        >
          <Printer className="h-3.5 w-3.5" />
          <span>PDF出力 / 印刷</span>
        </button>
      </div>
    </header>
  );
}
