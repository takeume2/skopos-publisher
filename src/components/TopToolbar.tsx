"use client";

import React, { useRef } from "react";
import {
  CheckCircle2,
  Columns2,
  Download,
  ExternalLink,
  Eye,
  FileCode2,
  FolderOpen,
  Loader2,
  PanelLeft,
  Printer,
  Settings,
  Upload,
} from "lucide-react";
import type { SaveStatus } from "@/hooks/useIndexedDbStorage";
import type { Locale } from "@/lib/i18n";
import { useI18n } from "./I18nProvider";

export type ViewMode = "editor" | "split" | "preview";

interface TopToolbarProps {
  title: string;
  saveStatus: SaveStatus;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  isPreviewPoppedOut?: boolean;
  onOpenPopoutPreview?: () => void;
  onFocusPopoutPreview?: () => void;
  onDockPopoutPreview?: () => void;
  onImportMarkdown: (content: string, filename?: string) => void;
  onImportFolder: (files: FileList) => void;
  onExportMarkdown: () => void;
  onPrint: () => void;
  isPreparingPrint?: boolean;
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
  isSettingsOpen: boolean;
  onToggleSettings: () => void;
  locale?: Locale;
  onLocaleChange?: (locale: Locale) => void;
}

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400";

export function TopToolbar({
  title,
  saveStatus,
  viewMode,
  onViewModeChange,
  isPreviewPoppedOut = false,
  onOpenPopoutPreview,
  onFocusPopoutPreview,
  onDockPopoutPreview,
  onImportMarkdown,
  onImportFolder,
  onExportMarkdown,
  onPrint,
  isPreparingPrint = false,
  isSidebarOpen,
  onToggleSidebar,
  isSettingsOpen,
  onToggleSettings,
  locale: propLocale,
  onLocaleChange,
}: TopToolbarProps) {
  const { locale: ctxLocale, dict } = useI18n();
  const activeLocale = propLocale ?? ctxLocale;
  const tb = dict.toolbar;

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
          aria-label={tb.toggleSidebarAria}
          title={tb.toggleSidebarAria}
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
          {title || dict.common.untitledDocument}
        </span>

        <span className="inline-flex items-center gap-1 rounded-full bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300">
          {saveStatus === "saving" || saveStatus === "loading" ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none text-amber-400" />
              <span>{tb.editingStatus}</span>
            </>
          ) : (
            <>
              <CheckCircle2 className="h-3 w-3 text-emerald-400" />
              <span>{tb.savedStatus}</span>
            </>
          )}
        </span>
      </div>

      <div className="flex items-center gap-2">
        {isPreviewPoppedOut ? (
          <div
            role="status"
            className="inline-flex items-center gap-1.5 rounded-md border border-sky-500/50 bg-sky-500/15 px-2.5 py-1 text-xs text-sky-200"
          >
            <ExternalLink className="h-3.5 w-3.5 shrink-0 text-sky-400" />
            <span className="font-medium">{tb.popoutActiveLabel}</span>
            {onFocusPopoutPreview && (
              <button
                type="button"
                onClick={onFocusPopoutPreview}
                title={tb.focusPopoutTitle}
                className={`rounded px-2 py-0.5 text-[11px] font-medium text-sky-200 transition hover:bg-sky-500/25 hover:text-white ${FOCUS_RING}`}
              >
                {tb.focusPopoutButton}
              </button>
            )}
            {onDockPopoutPreview && (
              <button
                type="button"
                onClick={onDockPopoutPreview}
                title={tb.dockPopoutTitle}
                className={`rounded bg-sky-600/50 px-2 py-0.5 text-[11px] font-semibold text-white transition hover:bg-sky-600/80 ${FOCUS_RING}`}
              >
                {tb.dockPopoutButton}
              </button>
            )}
          </div>
        ) : (
          <>
            <div
              role="group"
              aria-label={tb.viewModeGroupAria}
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
                <span className="hidden md:inline">{tb.viewEditorOnly}</span>
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
                <span className="hidden md:inline">{tb.viewSplit}</span>
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
                <span className="hidden md:inline">{tb.viewPreviewOnly}</span>
              </button>
            </div>

            {onOpenPopoutPreview && (
              <button
                type="button"
                onClick={onOpenPopoutPreview}
                title={tb.openPopoutTitle}
                aria-label={tb.openPopoutAria}
                className={`rounded-md border border-slate-700 bg-slate-800 p-1.5 text-slate-300 transition hover:border-sky-500/60 hover:bg-slate-700 hover:text-white ${FOCUS_RING}`}
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </button>
            )}
          </>
        )}
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
          title={tb.importFolderTitle}
          className={`inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-slate-700 ${FOCUS_RING}`}
        >
          <FolderOpen className="h-3.5 w-3.5 text-sky-400" />
          <span className="hidden sm:inline">{tb.importFolder}</span>
        </button>

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className={`inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-slate-700 ${FOCUS_RING}`}
        >
          <Upload className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{tb.importMd}</span>
        </button>

        <button
          type="button"
          onClick={onExportMarkdown}
          className={`inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-slate-700 ${FOCUS_RING}`}
        >
          <Download className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{tb.exportMd}</span>
        </button>

        {onLocaleChange && (
          <div
            role="group"
            aria-label={tb.languageGroupAria}
            className="flex items-center rounded-md border border-slate-700 bg-slate-950 p-0.5 text-[11px]"
          >
            <button
              type="button"
              aria-pressed={activeLocale === "ja"}
              title={tb.languageJaTitle}
              onClick={() => onLocaleChange("ja")}
              className={`rounded px-1.5 py-1 font-semibold transition ${FOCUS_RING} ${
                activeLocale === "ja"
                  ? "bg-slate-800 text-white"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              JA
            </button>
            <button
              type="button"
              aria-pressed={activeLocale === "en"}
              title={tb.languageEnTitle}
              onClick={() => onLocaleChange("en")}
              className={`rounded px-1.5 py-1 font-semibold transition ${FOCUS_RING} ${
                activeLocale === "en"
                  ? "bg-slate-800 text-white"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              EN
            </button>
          </div>
        )}

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
          <span className="hidden sm:inline">{tb.settings}</span>
        </button>

        <button
          type="button"
          onClick={onPrint}
          disabled={isPreparingPrint}
          aria-busy={isPreparingPrint || undefined}
          className={`inline-flex items-center gap-1.5 rounded-md bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-sky-500 disabled:cursor-wait disabled:opacity-70 ${FOCUS_RING}`}
        >
          {isPreparingPrint ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
          ) : (
            <Printer className="h-3.5 w-3.5" />
          )}
          <span>{isPreparingPrint ? tb.preparingPrint : tb.printPdf}</span>
        </button>
      </div>
    </header>
  );
}
