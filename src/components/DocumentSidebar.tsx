"use client";

import React, { useRef, useState } from "react";
import {
  Download,
  FileText,
  Image as ImageIcon,
  ListTree,
  Plus,
  RotateCcw,
  Trash2,
  Upload,
} from "lucide-react";
import type {
  DocumentSummary,
  SharedAssetSummary,
} from "@/hooks/useIndexedDbStorage";
import type { OutlineHeading } from "@/lib/outline";
import { useI18n } from "./I18nProvider";

export type SharedAssetRole = "logo" | "cover_image" | "back_cover_image";

type SidebarTab = "docs" | "outline" | "assets";

const SIDEBAR_TABS: readonly SidebarTab[] = ["docs", "outline", "assets"] as const;

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400";

interface DocumentSidebarProps {
  isOpen: boolean;
  activeDocId: string;
  activeFrontmatterAssets: {
    logo: string;
    cover_image: string;
    back_cover_image: string;
  };
  documents: DocumentSummary[];
  sharedAssets: SharedAssetSummary[];
  headings?: OutlineHeading[];
  activeHeadingId?: string | null;
  onSelectHeading?: (heading: OutlineHeading) => void;
  onSelectDocument: (docId: string) => void;
  onCreateDocument: () => void;
  onExportDocument: (docId: string) => void;
  onRequestResetSample?: () => void;
  onRequestDeleteDocument: (doc: DocumentSummary) => void;
  onRequestDeleteAllDocuments: () => void;
  onAddSharedAsset: (file: File) => void;
  onApplySharedAsset: (role: SharedAssetRole, assetId: string) => void;
  onRequestDeleteSharedAsset: (asset: SharedAssetSummary) => void;
  onRequestDeleteAllSharedAssets: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDateTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

export function DocumentSidebar({
  isOpen,
  activeDocId,
  activeFrontmatterAssets,
  documents,
  sharedAssets,
  headings = [],
  activeHeadingId = null,
  onSelectHeading,
  onSelectDocument,
  onCreateDocument,
  onExportDocument,
  onRequestResetSample,
  onRequestDeleteDocument,
  onRequestDeleteAllDocuments,
  onAddSharedAsset,
  onApplySharedAsset,
  onRequestDeleteSharedAsset,
  onRequestDeleteAllSharedAssets,
}: DocumentSidebarProps) {
  const { dict, format } = useI18n();
  const sb = dict.sidebar;

  const [activeTab, setActiveTab] = useState<SidebarTab>("docs");
  const sharedInputRef = useRef<HTMLInputElement>(null);
  const tabRefs = useRef<Record<SidebarTab, HTMLButtonElement | null>>({
    docs: null,
    outline: null,
    assets: null,
  });

  if (!isOpen) return null;

  const handleTabKeyDown = (
    e: React.KeyboardEvent<HTMLButtonElement>,
    currentIndex: number
  ) => {
    let nextIndex: number | null = null;
    if (e.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % SIDEBAR_TABS.length;
    } else if (e.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + SIDEBAR_TABS.length) % SIDEBAR_TABS.length;
    } else if (e.key === "Home") {
      nextIndex = 0;
    } else if (e.key === "End") {
      nextIndex = SIDEBAR_TABS.length - 1;
    }
    if (nextIndex === null) return;

    e.preventDefault();
    const nextTab = SIDEBAR_TABS[nextIndex];
    setActiveTab(nextTab);
    tabRefs.current[nextTab]?.focus();
  };

  const totalDocsBytes = documents.reduce((sum, d) => sum + d.totalBytes, 0);
  const totalSharedBytes = sharedAssets.reduce((sum, a) => sum + a.bytes, 0);

  return (
    <aside
      aria-label={sb.asideAria}
      className="no-print flex h-full w-[260px] shrink-0 flex-col border-r border-slate-800 bg-slate-900 text-slate-200"
    >
      <div
        role="tablist"
        aria-label={sb.tabListAria}
        className="grid grid-cols-3 gap-0.5 border-b border-slate-800 bg-slate-950/60 p-1 text-[11px]"
      >
        <button
          ref={(el) => {
            tabRefs.current.docs = el;
          }}
          id="sidebar-tab-docs"
          type="button"
          role="tab"
          aria-selected={activeTab === "docs"}
          aria-controls="sidebar-tabpanel-docs"
          tabIndex={activeTab === "docs" ? 0 : -1}
          onClick={() => setActiveTab("docs")}
          onKeyDown={(e) => handleTabKeyDown(e, 0)}
          className={`flex flex-col items-center justify-center gap-0.5 rounded px-1 py-1.5 font-medium transition ${FOCUS_RING} ${
            activeTab === "docs"
              ? "bg-slate-800 text-white"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          <FileText className="h-3.5 w-3.5 shrink-0" />
          <span className="whitespace-nowrap">
            {format(sb.tabDocs, { count: documents.length })}
          </span>
        </button>
        <button
          ref={(el) => {
            tabRefs.current.outline = el;
          }}
          id="sidebar-tab-outline"
          type="button"
          role="tab"
          aria-selected={activeTab === "outline"}
          aria-controls="sidebar-tabpanel-outline"
          tabIndex={activeTab === "outline" ? 0 : -1}
          title={sb.tabOutlineTitle}
          onClick={() => setActiveTab("outline")}
          onKeyDown={(e) => handleTabKeyDown(e, 1)}
          className={`flex flex-col items-center justify-center gap-0.5 rounded px-1 py-1.5 font-medium transition ${FOCUS_RING} ${
            activeTab === "outline"
              ? "bg-slate-800 text-white"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          <ListTree className="h-3.5 w-3.5 shrink-0" />
          <span className="whitespace-nowrap">
            {format(sb.tabOutline, { count: headings.length })}
          </span>
        </button>
        <button
          ref={(el) => {
            tabRefs.current.assets = el;
          }}
          id="sidebar-tab-assets"
          type="button"
          role="tab"
          aria-selected={activeTab === "assets"}
          aria-controls="sidebar-tabpanel-assets"
          tabIndex={activeTab === "assets" ? 0 : -1}
          onClick={() => setActiveTab("assets")}
          onKeyDown={(e) => handleTabKeyDown(e, 2)}
          className={`flex flex-col items-center justify-center gap-0.5 rounded px-1 py-1.5 font-medium transition ${FOCUS_RING} ${
            activeTab === "assets"
              ? "bg-slate-800 text-white"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          <ImageIcon className="h-3.5 w-3.5 shrink-0" />
          <span className="whitespace-nowrap">
            {format(sb.tabAssets, { count: sharedAssets.length })}
          </span>
        </button>
      </div>

      {activeTab === "docs" ? (
        <div
          id="sidebar-tabpanel-docs"
          role="tabpanel"
          aria-labelledby="sidebar-tab-docs"
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="border-b border-slate-800 p-2.5">
            <button
              type="button"
              onClick={onCreateDocument}
              className={`flex w-full items-center justify-center gap-1.5 rounded-md bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-sky-500 ${FOCUS_RING}`}
            >
              <Plus className="h-3.5 w-3.5" />
              <span>{sb.createNewDoc}</span>
            </button>
          </div>

          <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto [scrollbar-gutter:stable] p-2">
            {documents.map((doc) => {
              const isActive = doc.id === activeDocId;
              const canDeleteSingle = documents.length > 1;
              return (
                <div
                  key={doc.id}
                  className={`group rounded-md border p-2 transition ${
                    isActive
                      ? "border-sky-500/70 bg-sky-950/35"
                      : "border-slate-800 bg-slate-950/50 hover:border-slate-700"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onSelectDocument(doc.id)}
                    className={`w-full rounded text-left ${FOCUS_RING}`}
                  >
                    <div className="truncate text-xs font-medium text-white">
                      {doc.title}
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[10px] text-slate-400">
                      <span>{formatDateTime(doc.updatedAt)}</span>
                      <span className="font-mono">
                        {formatBytes(doc.totalBytes)}
                      </span>
                    </div>
                  </button>

                  <div className="mt-1.5 flex items-center justify-between border-t border-slate-800/80 pt-1.5 text-[10px] text-slate-400">
                    <span>
                      {doc.assetCount > 0
                        ? format(sb.imageCount, { count: doc.assetCount })
                        : sb.noImages}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => onExportDocument(doc.id)}
                        title={sb.exportDocTitle}
                        aria-label={format(sb.exportDocAria, {
                          title: doc.title,
                        })}
                        className={`rounded p-1 text-slate-300 hover:bg-slate-800 hover:text-white ${FOCUS_RING}`}
                      >
                        <Download className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        disabled={!canDeleteSingle}
                        onClick={() => onRequestDeleteDocument(doc)}
                        title={
                          canDeleteSingle
                            ? sb.deleteDocTitle
                            : sb.deleteDocDisabledTitle
                        }
                        aria-label={format(sb.deleteDocAria, {
                          title: doc.title,
                        })}
                        className={`rounded p-1 text-red-400 hover:bg-red-950/60 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-35 ${FOCUS_RING}`}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="border-t border-slate-800 p-2.5 text-[11px]">
            <div className="mb-2 flex items-center justify-between text-slate-400">
              <span>{format(sb.docsTotal, { count: documents.length })}</span>
              <span className="font-mono text-slate-300">
                {formatBytes(totalDocsBytes)}
              </span>
            </div>
            <div className="space-y-1.5">
              {onRequestResetSample && (
                <button
                  type="button"
                  onClick={onRequestResetSample}
                  disabled={documents.length === 0}
                  title={sb.resetSampleTitle}
                  className={`flex w-full items-center justify-center gap-1.5 rounded border border-amber-900/60 bg-amber-950/20 px-2.5 py-1.5 text-xs font-medium text-amber-300 transition hover:bg-amber-950/50 disabled:opacity-40 ${FOCUS_RING}`}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>{sb.resetSampleButton}</span>
                </button>
              )}
              <button
                type="button"
                onClick={onRequestDeleteAllDocuments}
                disabled={documents.length === 0}
                className={`flex w-full items-center justify-center gap-1.5 rounded border border-red-900/70 bg-red-950/30 px-2.5 py-1.5 text-xs font-medium text-red-300 transition hover:bg-red-950/70 disabled:opacity-40 ${FOCUS_RING}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>{sb.deleteAllDocs}</span>
              </button>
            </div>
          </div>
        </div>
      ) : activeTab === "outline" ? (
        <div
          id="sidebar-tabpanel-outline"
          role="tabpanel"
          aria-labelledby="sidebar-tab-outline"
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="border-b border-slate-800 px-2.5 py-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-200">
                {sb.outlineTitle}
              </span>
              <span className="font-mono text-[10px] text-slate-400">
                {format(sb.outlineCount, { count: headings.length })}
              </span>
            </div>
            <p className="mt-1 text-[10px] leading-relaxed text-slate-400">
              {sb.outlineHint}
            </p>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable] p-2">
            {headings.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs leading-relaxed text-slate-500">
                {sb.outlineEmpty}
              </p>
            ) : (
              <nav aria-label={sb.outlineNavAria}>
                <ul className="space-y-0.5">
                  {headings.map((heading) => {
                    const isActive = heading.id === activeHeadingId;
                    const indentPx = 8 + (heading.level - 1) * 10;
                    const levelTextClass =
                      heading.level === 1
                        ? "font-semibold text-slate-100 text-xs"
                        : heading.level === 2
                          ? "font-medium text-slate-200 text-xs"
                          : heading.level === 3
                            ? "text-slate-300 text-[11px]"
                            : "text-slate-400 text-[11px]";

                    return (
                      <li key={heading.id}>
                        <button
                          type="button"
                          onClick={() => onSelectHeading?.(heading)}
                          aria-current={isActive ? "location" : undefined}
                          data-heading-level={heading.level}
                          data-heading-line={heading.line}
                          title={format(sb.outlineHeadingTitle, {
                            level: heading.level,
                            line: heading.line,
                            text: heading.text,
                          })}
                          style={{ paddingLeft: `${indentPx}px` }}
                          className={`group flex w-full items-center gap-1.5 rounded-md border py-1.5 pr-2 text-left transition ${FOCUS_RING} ${
                            isActive
                              ? "border-sky-500/60 bg-sky-950/45 text-sky-200"
                              : "border-transparent hover:border-slate-800 hover:bg-slate-800/60"
                          }`}
                        >
                          <span
                            className={`shrink-0 font-mono text-[9px] uppercase ${
                              isActive
                                ? "text-sky-400"
                                : "text-slate-500 group-hover:text-slate-400"
                            }`}
                          >
                            H{heading.level}
                          </span>
                          <span
                            className={`min-w-0 flex-1 truncate ${
                              isActive
                                ? "font-semibold text-sky-100"
                                : levelTextClass
                            }`}
                          >
                            {heading.text}
                          </span>
                          <span
                            className={`shrink-0 font-mono text-[10px] ${
                              isActive
                                ? "text-sky-400/90"
                                : "text-slate-600 group-hover:text-slate-400"
                            }`}
                          >
                            L{heading.line}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </nav>
            )}
          </div>
        </div>
      ) : (
        <div
          id="sidebar-tabpanel-assets"
          role="tabpanel"
          aria-labelledby="sidebar-tab-assets"
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="space-y-2 border-b border-slate-800 p-2.5">
            <input
              ref={sharedInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onAddSharedAsset(file);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => sharedInputRef.current?.click()}
              className={`flex w-full items-center justify-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-100 transition hover:bg-slate-700 ${FOCUS_RING}`}
            >
              <Upload className="h-3.5 w-3.5 text-sky-400" />
              <span>{sb.addSharedAsset}</span>
            </button>
            <p className="text-[10px] leading-relaxed text-slate-400">
              {sb.sharedAssetHint}
            </p>
          </div>

          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto [scrollbar-gutter:stable] p-2">
            {sharedAssets.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs text-slate-500">
                {sb.sharedAssetEmpty}
              </p>
            ) : (
              sharedAssets.map((asset) => {
                const isLogo = activeFrontmatterAssets.logo === asset.assetId;
                const isCover =
                  activeFrontmatterAssets.cover_image === asset.assetId;
                const isBackCover =
                  activeFrontmatterAssets.back_cover_image === asset.assetId;

                return (
                  <div
                    key={asset.assetId}
                    className="rounded-md border border-slate-800 bg-slate-950/60 p-2"
                  >
                    <div className="flex items-center gap-2">
                      <img
                        src={asset.dataUrl}
                        alt={asset.label}
                        className="h-10 w-12 shrink-0 rounded border border-slate-800 bg-white object-contain p-0.5"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium text-white">
                          {asset.label}
                        </div>
                        <div className="font-mono text-[10px] text-slate-400">
                          {formatBytes(asset.bytes)}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => onRequestDeleteSharedAsset(asset)}
                        title={sb.deleteSharedAssetTitle}
                        aria-label={format(sb.deleteSharedAssetAria, {
                          label: asset.label,
                        })}
                        className={`rounded p-1.5 text-red-400 hover:bg-red-950/60 ${FOCUS_RING}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    <div className="mt-2 grid grid-cols-3 gap-1 border-t border-slate-800/80 pt-1.5 text-[10px]">
                      <button
                        type="button"
                        aria-pressed={isLogo}
                        onClick={() => onApplySharedAsset("logo", asset.assetId)}
                        className={`rounded border px-1 py-0.5 transition ${FOCUS_RING} ${
                          isLogo
                            ? "border-sky-500 bg-sky-600/25 font-semibold text-sky-300"
                            : "border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800"
                        }`}
                      >
                        {isLogo ? sb.roleLogoActive : sb.roleLogo}
                      </button>
                      <button
                        type="button"
                        aria-pressed={isCover}
                        onClick={() =>
                          onApplySharedAsset("cover_image", asset.assetId)
                        }
                        className={`rounded border px-1 py-0.5 transition ${FOCUS_RING} ${
                          isCover
                            ? "border-sky-500 bg-sky-600/25 font-semibold text-sky-300"
                            : "border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800"
                        }`}
                      >
                        {isCover ? sb.roleCoverActive : sb.roleCover}
                      </button>
                      <button
                        type="button"
                        aria-pressed={isBackCover}
                        onClick={() =>
                          onApplySharedAsset("back_cover_image", asset.assetId)
                        }
                        className={`rounded border px-1 py-0.5 transition ${FOCUS_RING} ${
                          isBackCover
                            ? "border-sky-500 bg-sky-600/25 font-semibold text-sky-300"
                            : "border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800"
                        }`}
                      >
                        {isBackCover ? sb.roleBackCoverActive : sb.roleBackCover}
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="border-t border-slate-800 p-2.5 text-[11px]">
            <div className="mb-2 flex items-center justify-between text-slate-400">
              <span>
                {format(sb.sharedAssetsTotal, { count: sharedAssets.length })}
              </span>
              <span className="font-mono text-slate-300">
                {formatBytes(totalSharedBytes)}
              </span>
            </div>
            <button
              type="button"
              onClick={onRequestDeleteAllSharedAssets}
              disabled={sharedAssets.length === 0}
              className={`flex w-full items-center justify-center gap-1.5 rounded border border-red-900/70 bg-red-950/30 px-2.5 py-1.5 text-xs font-medium text-red-300 transition hover:bg-red-950/70 disabled:opacity-40 ${FOCUS_RING}`}
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>{sb.deleteAllSharedAssets}</span>
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}
