"use client";

import React, { useRef, useState } from "react";
import {
  Download,
  FileText,
  Image as ImageIcon,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import type {
  DocumentSummary,
  SharedAssetSummary,
} from "@/hooks/useIndexedDbStorage";

export type SharedAssetRole = "logo" | "cover_image" | "back_cover_image";

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
  onSelectDocument: (docId: string) => void;
  onCreateDocument: () => void;
  onExportDocument: (docId: string) => void;
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
  onSelectDocument,
  onCreateDocument,
  onExportDocument,
  onRequestDeleteDocument,
  onRequestDeleteAllDocuments,
  onAddSharedAsset,
  onApplySharedAsset,
  onRequestDeleteSharedAsset,
  onRequestDeleteAllSharedAssets,
}: DocumentSidebarProps) {
  const [activeTab, setActiveTab] = useState<"docs" | "assets">("docs");
  const sharedInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const totalDocsBytes = documents.reduce((sum, d) => sum + d.totalBytes, 0);
  const totalSharedBytes = sharedAssets.reduce((sum, a) => sum + a.bytes, 0);

  return (
    <aside
      aria-label="文書と共通画像の管理"
      className="no-print flex h-full w-[260px] shrink-0 flex-col border-r border-slate-800 bg-slate-900 text-slate-200"
    >
      <div
        role="tablist"
        aria-label="管理カテゴリ"
        className="grid grid-cols-2 border-b border-slate-800 bg-slate-950/60 p-1 text-xs"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "docs"}
          onClick={() => setActiveTab("docs")}
          className={`flex items-center justify-center gap-1.5 rounded py-1.5 font-medium transition ${
            activeTab === "docs"
              ? "bg-slate-800 text-white"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          <FileText className="h-3.5 w-3.5" />
          <span>文書 ({documents.length})</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "assets"}
          onClick={() => setActiveTab("assets")}
          className={`flex items-center justify-center gap-1.5 rounded py-1.5 font-medium transition ${
            activeTab === "assets"
              ? "bg-slate-800 text-white"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          <ImageIcon className="h-3.5 w-3.5" />
          <span>共通画像 ({sharedAssets.length})</span>
        </button>
      </div>

      {activeTab === "docs" ? (
        <>
          <div className="border-b border-slate-800 p-2.5">
            <button
              type="button"
              onClick={onCreateDocument}
              className="flex w-full items-center justify-center gap-1.5 rounded-md bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-sky-500"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>新規文書を作成</span>
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
                    className="w-full text-left"
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
                        ? `画像 ${doc.assetCount}件`
                        : "画像なし"}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => onExportDocument(doc.id)}
                        title="この文書を .md として保存"
                        aria-label={`${doc.title} を .md として保存`}
                        className="rounded p-1 text-slate-300 hover:bg-slate-800 hover:text-white"
                      >
                        <Download className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        disabled={!canDeleteSingle}
                        onClick={() => onRequestDeleteDocument(doc)}
                        title={
                          canDeleteSingle
                            ? "この文書を削除"
                            : "最後の1件は個別削除できません（リセットは「全ドキュメントを消去・初期化」を使用）"
                        }
                        aria-label={`${doc.title} を削除`}
                        className="rounded p-1 text-red-400 hover:bg-red-950/60 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-35"
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
              <span>文書合計 ({documents.length}件)</span>
              <span className="font-mono text-slate-300">
                {formatBytes(totalDocsBytes)}
              </span>
            </div>
            <button
              type="button"
              onClick={onRequestDeleteAllDocuments}
              disabled={documents.length === 0}
              className="flex w-full items-center justify-center gap-1.5 rounded border border-red-900/70 bg-red-950/30 px-2.5 py-1.5 text-xs font-medium text-red-300 transition hover:bg-red-950/70 disabled:opacity-40"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>全ドキュメントを消去・初期化</span>
            </button>
          </div>
        </>
      ) : (
        <>
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
              className="flex w-full items-center justify-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-100 transition hover:bg-slate-700"
            >
              <Upload className="h-3.5 w-3.5 text-sky-400" />
              <span>共通画像を追加</span>
            </button>
            <p className="text-[10px] leading-relaxed text-slate-400">
              登録した画像は全文書で使いまわせます。ボタンから編集中の文書へ適用できます。
            </p>
          </div>

          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto [scrollbar-gutter:stable] p-2">
            {sharedAssets.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs text-slate-500">
                登録済みの共通画像はありません。上のボタンまたは設定パネルから登録できます。
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
                        title="共通画像をライブラリから削除"
                        aria-label={`${asset.label} を削除`}
                        className="rounded p-1.5 text-red-400 hover:bg-red-950/60"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    <div className="mt-2 grid grid-cols-3 gap-1 border-t border-slate-800/80 pt-1.5 text-[10px]">
                      <button
                        type="button"
                        onClick={() => onApplySharedAsset("logo", asset.assetId)}
                        className={`rounded border px-1 py-0.5 transition ${
                          isLogo
                            ? "border-sky-500 bg-sky-600/25 font-semibold text-sky-300"
                            : "border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800"
                        }`}
                      >
                        {isLogo ? "✓ ロゴ" : "ロゴ"}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          onApplySharedAsset("cover_image", asset.assetId)
                        }
                        className={`rounded border px-1 py-0.5 transition ${
                          isCover
                            ? "border-sky-500 bg-sky-600/25 font-semibold text-sky-300"
                            : "border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800"
                        }`}
                      >
                        {isCover ? "✓ 表紙" : "表紙"}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          onApplySharedAsset("back_cover_image", asset.assetId)
                        }
                        className={`rounded border px-1 py-0.5 transition ${
                          isBackCover
                            ? "border-sky-500 bg-sky-600/25 font-semibold text-sky-300"
                            : "border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800"
                        }`}
                      >
                        {isBackCover ? "✓ 裏表紙" : "裏表紙"}
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="border-t border-slate-800 p-2.5 text-[11px]">
            <div className="mb-2 flex items-center justify-between text-slate-400">
              <span>共通画像合計 ({sharedAssets.length}件)</span>
              <span className="font-mono text-slate-300">
                {formatBytes(totalSharedBytes)}
              </span>
            </div>
            <button
              type="button"
              onClick={onRequestDeleteAllSharedAssets}
              disabled={sharedAssets.length === 0}
              className="flex w-full items-center justify-center gap-1.5 rounded border border-red-900/70 bg-red-950/30 px-2.5 py-1.5 text-xs font-medium text-red-300 transition hover:bg-red-950/70 disabled:opacity-40"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>共通画像を全削除</span>
            </button>
          </div>
        </>
      )}
    </aside>
  );
}
