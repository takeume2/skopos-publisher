"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronRight,
  Copy,
  FileDown,
  ImagePlus,
  LayoutTemplate,
  Palette,
  RotateCcw,
  Settings2,
  ShieldAlert,
  Trash2,
  Type,
  X,
} from "lucide-react";
import {
  DEFAULT_FILENAME_TEMPLATE,
  FILENAME_TEMPLATE_PRESETS,
  FILENAME_VARIABLE_CHIPS,
  resolveFilenamePresetId,
} from "@/lib/export-filename";
import {
  processUploadedImageFile,
  type ImageUploadPurpose,
} from "@/lib/image-processing";
import { resolveAssetSrc } from "@/lib/markdown";
import type { SharedAssetSummary } from "@/hooks/useIndexedDbStorage";
import type {
  ConfidentialMode,
  CoverOverlayMode,
  DocumentFrontmatter,
  DocumentTheme,
  FontFamilyOption,
  HeadingHighlightMode,
  LogoPosition,
  PageOrientation,
  PageSize,
  TocDepth,
} from "@/types/document";

interface DocumentSettingsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  frontmatter: DocumentFrontmatter;
  assets: Record<string, string>;
  sharedAssets?: SharedAssetSummary[];
  filenameTemplate?: string;
  onChangeFilenameTemplate?: (nextTemplate: string) => void;
  exportFilenamePreview?: {
    pdf: string;
    md: string;
  };
  skipPrintHeaderFooterNotice?: boolean;
  onChangeSkipPrintHeaderFooterNotice?: (skip: boolean) => void;
  enablePreflightCheck?: boolean;
  onChangeEnablePreflightCheck?: (enabled: boolean) => void;
  preflightNgWords?: string;
  onChangePreflightNgWords?: (words: string) => void;
  onChangeFrontmatter: (next: DocumentFrontmatter) => void;
  onSaveAsset: (assetId: string, dataUrl: string, label?: string) => Promise<void>;
  onRemoveAsset: (assetId: string) => Promise<void>;
  onNotice?: (title: string, message: string) => void;
}

const VARIABLE_CHIPS = [
  "{title}",
  "{date}",
  "{author}",
  "{recipient}",
  "{page}",
  "{pages}",
] as const;

const CONFIDENTIAL_LABEL_PRESETS = [
  "CONFIDENTIAL",
  "社外秘",
  "取扱注意",
  "極秘",
] as const;

const THEME_CARDS: Array<{
  id: DocumentTheme;
  name: string;
  desc: string;
  coverBg: string;
  accentBg: string;
  lineColor: string;
  defaultPrimary: string;
  defaultAccent: string;
}> = [
  {
    id: "business",
    name: "Business",
    desc: "ネイビー基調のビジネス報告書",
    coverBg: "bg-[#1e3a5f]",
    accentBg: "bg-[#2563eb]",
    lineColor: "bg-slate-300",
    defaultPrimary: "#1e3a5f",
    defaultAccent: "#2563eb",
  },
  {
    id: "technical",
    name: "Technical",
    desc: "スレート＋シアンの技術仕様書",
    coverBg: "bg-slate-900",
    accentBg: "bg-sky-500",
    lineColor: "bg-slate-300",
    defaultPrimary: "#0f172a",
    defaultAccent: "#0284c7",
  },
  {
    id: "minimal",
    name: "Minimal",
    desc: "明朝・余白重視のミニマルデザイン",
    coverBg: "bg-white border border-zinc-300",
    accentBg: "bg-zinc-900",
    lineColor: "bg-zinc-300",
    defaultPrimary: "#18181b",
    defaultAccent: "#52525b",
  },
];

interface ImageDropFieldProps {
  label: string;
  value: string;
  resolvedSrc: string;
  assetPrefix: string;
  uploadPurpose: ImageUploadPurpose;
  sharedAssets?: SharedAssetSummary[];
  onSave: (assetId: string, dataUrl: string, label?: string) => Promise<void>;
  onChangeValue: (nextVal: string) => void;
  onError?: (title: string, message: string) => void;
}

function ImageDropField({
  label,
  value,
  resolvedSrc,
  assetPrefix,
  uploadPurpose,
  sharedAssets = [],
  onSave,
  onChangeValue,
  onError,
}: ImageDropFieldProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const processFile = async (file: File) => {
    setLocalError(null);
    try {
      const processed = await processUploadedImageFile(file, uploadPurpose);
      const newId = `${assetPrefix}${Date.now()}_${Math.random()
        .toString(36)
        .slice(2, 5)}`;
      await onSave(newId, processed.dataUrl, file.name);
      onChangeValue(newId);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "画像の読み込みに失敗しました。";
      setLocalError(message);
      onError?.("画像読み込みエラー", message);
    }
  };

  return (
    <div className="space-y-1.5">
      <label className="block text-[11px] text-slate-400">{label}</label>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) processFile(file);
          e.target.value = "";
        }}
      />

      {resolvedSrc ? (
        <div className="flex items-center justify-between rounded border border-slate-700 bg-slate-950 p-2">
          <img
            src={resolvedSrc}
            alt={label}
            className="max-h-10 max-w-[160px] object-contain"
          />
          <button
            type="button"
            onClick={() => onChangeValue("")}
            title="この文書から解除（共通画像は保持）"
            aria-label={`${label}をこの文書から解除`}
            className="rounded p-1.5 text-red-400 hover:bg-red-950/50"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            const file = e.dataTransfer.files?.[0];
            if (file) processFile(file);
          }}
          role="button"
          tabIndex={0}
          aria-label={`${label}を選択またはドラッグ＆ドロップ`}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-md border border-dashed px-3 py-3 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${
            isDragging
              ? "border-sky-400 bg-sky-500/10"
              : "border-slate-700 bg-slate-950/60 hover:border-slate-500"
          }`}
        >
          <ImagePlus className="mb-1 h-4 w-4 text-slate-400" />
          <span className="text-[10px] text-slate-300">
            ドラッグ＆ドロップ または クリックして選択
          </span>
        </div>
      )}
      {!resolvedSrc && sharedAssets.length > 0 && (
        <select
          value=""
          aria-label={`${label}を共通画像から選択`}
          onChange={(e) => {
            if (e.target.value) {
              setLocalError(null);
              onChangeValue(e.target.value);
            }
          }}
          className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-200 focus:border-sky-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
        >
          <option value="">登録済みの共通画像から選択...</option>
          {sharedAssets.map((item) => (
            <option key={item.assetId} value={item.assetId}>
              {item.label}
            </option>
          ))}
        </select>
      )}
      {localError && (
        <p role="alert" className="text-[10px] leading-relaxed text-amber-300">
          {localError}
        </p>
      )}
    </div>
  );
}

export function DocumentSettingsDrawer({
  isOpen,
  onClose,
  frontmatter,
  assets,
  sharedAssets = [],
  filenameTemplate = DEFAULT_FILENAME_TEMPLATE,
  onChangeFilenameTemplate,
  exportFilenamePreview,
  skipPrintHeaderFooterNotice = false,
  onChangeSkipPrintHeaderFooterNotice,
  enablePreflightCheck = true,
  onChangeEnablePreflightCheck,
  preflightNgWords = "",
  onChangePreflightNgWords,
  onChangeFrontmatter,
  onSaveAsset,
  onNotice,
}: DocumentSettingsDrawerProps) {
  const [focusedField, setFocusedField] = useState<
    "header_left" | "header_right" | "footer_left" | "footer_right"
  >("header_left");
  const [copiedTarget, setCopiedTarget] = useState<"pdf" | "md" | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) {
        clearTimeout(copyTimerRef.current);
        copyTimerRef.current = null;
      }
    };
  }, []);

  if (!isOpen) return null;

  const activeFilenamePreset = resolveFilenamePresetId(filenameTemplate);

  const handleInsertFilenameChip = (chip: string) => {
    if (!onChangeFilenameTemplate) return;
    const current = filenameTemplate;
    if (!current.trim()) {
      onChangeFilenameTemplate(chip);
      return;
    }
    const separator = /[_\-.\s]$/.test(current) ? "" : "_";
    onChangeFilenameTemplate(`${current}${separator}${chip}`);
  };

  const handleCopyFilename = async (kind: "pdf" | "md", value: string) => {
    if (!value) return;
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      }
      if (copyTimerRef.current) {
        clearTimeout(copyTimerRef.current);
      }
      setCopiedTarget(kind);
      copyTimerRef.current = setTimeout(() => {
        setCopiedTarget(null);
        copyTimerRef.current = null;
      }, 1800);
    } catch {
      // Clipboard API unavailable or denied
    }
  };

  const updateField = <K extends keyof DocumentFrontmatter>(
    key: K,
    value: DocumentFrontmatter[K]
  ) => {
    onChangeFrontmatter({ ...frontmatter, [key]: value });
  };

  const resetThemeCustomization = () => {
    onChangeFrontmatter({
      ...frontmatter,
      primary_color: "",
      accent_color: "",
      heading_highlight: "tinted",
      font_family: "theme",
      font_size: 10,
      line_height: 1.7,
    });
  };

  const handleInsertChip = (chip: string) => {
    const current = frontmatter[focusedField] || "";
    updateField(focusedField, current ? `${current} ${chip}` : chip);
  };

  const resolvedLogoSrc = frontmatter.logo
    ? resolveAssetSrc(frontmatter.logo, assets)
    : "";
  const resolvedCoverImageSrc = frontmatter.cover_image
    ? resolveAssetSrc(frontmatter.cover_image, assets)
    : "";
  const resolvedBackCoverImageSrc = frontmatter.back_cover_image
    ? resolveAssetSrc(frontmatter.back_cover_image, assets)
    : "";

  const activeThemeDefaults =
    THEME_CARDS.find((t) => t.id === frontmatter.theme) ?? THEME_CARDS[0];
  const displayPrimaryColor =
    frontmatter.primary_color || activeThemeDefaults.defaultPrimary;
  const displayAccentColor =
    frontmatter.accent_color || activeThemeDefaults.defaultAccent;

  return (
    <aside className="no-print flex h-full w-[320px] shrink-0 flex-col border-l border-slate-800 bg-slate-900 text-slate-200">
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2.5">
        <div className="flex items-center gap-2 text-xs font-semibold tracking-wide text-white">
          <Settings2 className="h-4 w-4 text-sky-400" />
          <span>ドキュメント設定</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="ドキュメント設定を閉じる"
          className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable] divide-y divide-slate-800 text-xs">
        {/* 1. 基本・用紙設定 */}
        <details open className="mdpub-settings-details">
          <summary className="mdpub-settings-summary flex cursor-pointer select-none items-center justify-between px-4 py-2.5 font-semibold text-slate-100 hover:bg-slate-800/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-400">
            <span className="flex items-center gap-2">
              <Type className="h-3.5 w-3.5 text-sky-400" />
              基本・用紙設定
            </span>
            <ChevronRight className="mdpub-details-chevron h-3.5 w-3.5 text-slate-400" />
          </summary>

          <div className="space-y-3 px-4 pb-4 pt-1">
            <div>
              <label className="mb-1 flex items-center justify-between text-[11px] text-slate-400">
                <span>タイトル</span>
                <span className="text-[10px] text-slate-500">
                  Enter / \n / &lt;br&gt; で改行可
                </span>
              </label>
              <textarea
                rows={2}
                value={frontmatter.title}
                onChange={(e) => updateField("title", e.target.value)}
                className="mdpub-auto-textarea w-full resize-y rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs leading-relaxed text-white focus:border-sky-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
              />
            </div>

              <div>
                <label className="mb-1 block text-[11px] text-slate-400">
                  サブタイトル
                </label>
                <input
                  type="text"
                  value={frontmatter.subtitle}
                  onChange={(e) => updateField("subtitle", e.target.value)}
                  className="w-full rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white focus:border-sky-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-[11px] text-slate-400">
                    作成者・組織名
                  </label>
                  <input
                    type="text"
                    value={frontmatter.author}
                    onChange={(e) => updateField("author", e.target.value)}
                    className="w-full rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white focus:border-sky-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-slate-400">
                    日付
                  </label>
                  <input
                    type="text"
                    value={frontmatter.date}
                    onChange={(e) => updateField("date", e.target.value)}
                    className="w-full rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white focus:border-sky-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-[11px] text-slate-400">
                  配布先（顧客名・担当者名）
                </label>
                <input
                  type="text"
                  placeholder="例: 株式会社〇〇 セキュリティ推進部 御中"
                  value={frontmatter.recipient}
                  onChange={(e) => updateField("recipient", e.target.value)}
                  className="w-full rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white focus:border-sky-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-[11px] text-slate-400">
                    用紙サイズ
                  </label>
                  <select
                    value={frontmatter.page_size}
                    onChange={(e) =>
                      updateField("page_size", e.target.value as PageSize)
                    }
                    className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white focus:border-sky-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
                  >
                    <option value="A4">A4 (210×297mm)</option>
                    <option value="A5">A5 (148×210mm)</option>
                    <option value="B5">B5 (182×257mm)</option>
                    <option value="Letter">Letter</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-[11px] text-slate-400">
                    印刷の向き
                  </label>
                  <select
                    value={frontmatter.orientation}
                    onChange={(e) =>
                      updateField(
                        "orientation",
                        e.target.value as PageOrientation
                      )
                    }
                    className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white focus:border-sky-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
                  >
                    <option value="portrait">縦 (Portrait)</option>
                    <option value="landscape">横 (Landscape)</option>
                  </select>
                </div>
              </div>
            </div>
        </details>

        {/* 2. 機密表示・透かし設定 */}
        <details open className="mdpub-settings-details">
          <summary className="mdpub-settings-summary flex cursor-pointer select-none items-center justify-between px-4 py-2.5 font-semibold text-slate-100 hover:bg-slate-800/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-400">
            <span className="flex items-center gap-2">
              <ShieldAlert className="h-3.5 w-3.5 text-amber-400" />
              機密表示・透かし設定
            </span>
            <ChevronRight className="mdpub-details-chevron h-3.5 w-3.5 text-slate-400" />
          </summary>

          <div className="space-y-3 px-4 pb-4 pt-1">
              <div className="space-y-1.5">
                {(
                  [
                    {
                      value: "none",
                      label: "1. 機密表示なし",
                      desc: "ラベル・透かしを表示しません",
                    },
                    {
                      value: "standard",
                      label: "2. 標準モード",
                      desc: "右ヘッダー・左フッターへ機密ラベルを自動合成",
                    },
                    {
                      value: "strict",
                      label: "3. 厳格モード",
                      desc: "ヘッダー/フッター＋目次・本文に対角線透かしを描画",
                    },
                  ] as Array<{
                    value: ConfidentialMode;
                    label: string;
                    desc: string;
                  }>
                ).map((opt) => {
                  const active = frontmatter.confidential_mode === opt.value;
                  return (
                    <label
                      key={opt.value}
                      className={`flex cursor-pointer items-start gap-2 rounded border p-2 transition ${
                        active
                          ? "border-amber-500/70 bg-amber-500/10"
                          : "border-slate-800 bg-slate-950/60 hover:border-slate-700"
                      }`}
                    >
                      <input
                        type="radio"
                        name="confidential_mode"
                        value={opt.value}
                        checked={active}
                        onChange={() =>
                          updateField("confidential_mode", opt.value)
                        }
                        className="mt-0.5 accent-amber-500"
                      />
                      <div className="min-w-0">
                        <div className="font-medium text-white">
                          {opt.label}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {opt.desc}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>

              {frontmatter.confidential_mode !== "none" && (
                <div className="space-y-2 rounded border border-slate-800 bg-slate-950/60 p-2.5">
                  <div>
                    <label className="mb-1 block text-[10px] text-slate-400">
                      機密ラベル文字列
                    </label>
                    <input
                      type="text"
                      value={frontmatter.confidential_label}
                      onChange={(e) =>
                        updateField("confidential_label", e.target.value)
                      }
                      className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white focus:border-amber-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                    />
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {CONFIDENTIAL_LABEL_PRESETS.map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => updateField("confidential_label", preset)}
                        className="rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-[10px] text-amber-300 hover:bg-slate-700"
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
        </details>

        {/* 3. 出力ファイル名規則・ガイド */}
        <details open className="mdpub-settings-details">
          <summary className="mdpub-settings-summary flex cursor-pointer select-none items-center justify-between px-4 py-2.5 font-semibold text-slate-100 hover:bg-slate-800/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-400">
            <span className="flex items-center gap-2">
              <FileDown className="h-3.5 w-3.5 text-sky-400" />
              出力ファイル名
            </span>
            <ChevronRight className="mdpub-details-chevron h-3.5 w-3.5 text-slate-400" />
          </summary>

          <div className="space-y-3 px-4 pb-4 pt-1">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-slate-400">
                    命名規則プリセット
                  </span>
                  {filenameTemplate !== DEFAULT_FILENAME_TEMPLATE &&
                    onChangeFilenameTemplate && (
                      <button
                        type="button"
                        onClick={() =>
                          onChangeFilenameTemplate(DEFAULT_FILENAME_TEMPLATE)
                        }
                        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-slate-400 hover:bg-slate-800 hover:text-white"
                      >
                        <RotateCcw className="h-3 w-3" />
                        <span>標準に戻す</span>
                      </button>
                    )}
                </div>
                <div className="space-y-1">
                  {FILENAME_TEMPLATE_PRESETS.map((preset) => {
                    const active = activeFilenamePreset === preset.id;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        aria-pressed={active}
                        onClick={() =>
                          onChangeFilenameTemplate?.(preset.template)
                        }
                        className={`flex w-full items-center justify-between rounded border px-2.5 py-1.5 text-left text-[11px] transition ${
                          active
                            ? "border-sky-500/70 bg-sky-500/15 font-medium text-sky-200"
                            : "border-slate-800 bg-slate-950/60 text-slate-300 hover:border-slate-700 hover:text-white"
                        }`}
                      >
                        <span>{preset.label}</span>
                        <span className="font-mono text-[9px] text-slate-400">
                          {preset.template}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label
                  htmlFor="export-filename-template-input"
                  className="mb-1 flex items-center justify-between text-[11px] text-slate-400"
                >
                  <span>テンプレート</span>
                  {activeFilenamePreset === "custom" && (
                    <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[9px] text-sky-300">
                      カスタム
                    </span>
                  )}
                </label>
                <input
                  id="export-filename-template-input"
                  type="text"
                  value={filenameTemplate}
                  placeholder={DEFAULT_FILENAME_TEMPLATE}
                  onChange={(e) => onChangeFilenameTemplate?.(e.target.value)}
                  className="w-full rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 font-mono text-[11px] text-white focus:border-sky-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
                />
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {FILENAME_VARIABLE_CHIPS.map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => handleInsertFilenameChip(chip)}
                      className="rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-sky-300 hover:bg-slate-700"
                    >
                      {chip}
                    </button>
                  ))}
                </div>
              </div>

              {exportFilenamePreview && (
                <div className="space-y-1.5 rounded-md border border-slate-800 bg-slate-950/70 p-2.5">
                  <div className="text-[10px] font-semibold text-slate-300">
                    生成ファイル名プレビュー
                  </div>
                  {(
                    [
                      {
                        kind: "pdf" as const,
                        label: "PDF",
                        value: exportFilenamePreview.pdf,
                      },
                      {
                        kind: "md" as const,
                        label: "MD",
                        value: exportFilenamePreview.md,
                      },
                    ] as const
                  ).map((item) => {
                    const isCopied = copiedTarget === item.kind;
                    return (
                      <div
                        key={item.kind}
                        className="flex items-center gap-1.5 rounded border border-slate-800/90 bg-slate-900/70 px-2 py-1"
                      >
                        <span className="shrink-0 rounded bg-slate-800 px-1 py-0.5 font-mono text-[9px] font-semibold text-slate-300">
                          {item.label}
                        </span>
                        <span
                          title={item.value}
                          data-testid={`export-filename-preview-${item.kind}`}
                          className="min-w-0 flex-1 truncate font-mono text-[10px] text-slate-200"
                        >
                          {item.value}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            void handleCopyFilename(item.kind, item.value)
                          }
                          aria-label={`${item.label}ファイル名をコピー`}
                          title={`${item.label}ファイル名をコピー`}
                          className="shrink-0 rounded p-1 text-slate-400 transition hover:bg-slate-800 hover:text-white"
                        >
                          {isCopied ? (
                            <Check className="h-3 w-3 text-emerald-400" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                        </button>
                      </div>
                    );
                  })}
                  <p className="pt-0.5 text-[10px] leading-relaxed text-slate-400">
                    PDF出力時の初期ファイル名・.md保存時のファイル名へ自動適用されます（機密表示なし時は{" "}
                    <code className="font-mono text-slate-300">
                      {"{confidential}"}
                    </code>{" "}
                    を自動省略）。
                  </p>
                </div>
              )}

              {(onChangeSkipPrintHeaderFooterNotice ||
                onChangeEnablePreflightCheck ||
                onChangePreflightNgWords) && (
                <div className="space-y-2.5 border-t border-slate-800/80 pt-2.5">
                  {onChangeSkipPrintHeaderFooterNotice && (
                    <label className="flex cursor-pointer items-start gap-2 text-[11px] text-slate-300">
                      <input
                        type="checkbox"
                        checked={!skipPrintHeaderFooterNotice}
                        onChange={(e) =>
                          onChangeSkipPrintHeaderFooterNotice(!e.target.checked)
                        }
                        className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-slate-600 bg-slate-900 accent-sky-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
                      />
                      <span className="leading-relaxed">
                        印刷前にヘッダー／フッター無効化の注意喚起を表示する
                      </span>
                    </label>
                  )}

                  {onChangeEnablePreflightCheck && (
                    <label className="flex cursor-pointer items-start gap-2 text-[11px] text-slate-300">
                      <input
                        type="checkbox"
                        checked={enablePreflightCheck}
                        onChange={(e) =>
                          onChangeEnablePreflightCheck(e.target.checked)
                        }
                        className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-slate-600 bg-slate-900 accent-sky-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
                      />
                      <span className="leading-relaxed">
                        印刷前にプリフライトチェック（TBD・仮値・NGワード）を実行する
                      </span>
                    </label>
                  )}

                  {onChangePreflightNgWords && enablePreflightCheck && (
                    <div>
                      <label
                        htmlFor="preflight-ng-words-input"
                        className="mb-1 block text-[11px] text-slate-400"
                      >
                        カスタム NG ワード（改行・カンマ区切り）
                      </label>
                      <textarea
                        id="preflight-ng-words-input"
                        rows={2}
                        value={preflightNgWords}
                        placeholder="例: 社内限定, ProjectX, internal.example.com"
                        onChange={(e) =>
                          onChangePreflightNgWords(e.target.value)
                        }
                        className="mdpub-auto-textarea w-full rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-[11px] text-white placeholder:text-slate-600 focus:border-sky-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
        </details>

        {/* 4. デザインテーマ & カスタマイズ */}
        <details open className="mdpub-settings-details">
          <summary className="mdpub-settings-summary flex cursor-pointer select-none items-center justify-between px-4 py-2.5 font-semibold text-slate-100 hover:bg-slate-800/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-400">
            <span className="flex items-center gap-2">
              <Palette className="h-3.5 w-3.5 text-sky-400" />
              デザインテーマ & カスタマイズ
            </span>
            <ChevronRight className="mdpub-details-chevron h-3.5 w-3.5 text-slate-400" />
          </summary>

          <div className="space-y-3 px-4 pb-4 pt-1">
              <div className="space-y-2">
                {THEME_CARDS.map((card) => {
                  const selected = frontmatter.theme === card.id;
                  return (
                    <button
                      key={card.id}
                      type="button"
                      onClick={() => updateField("theme", card.id)}
                      className={`flex w-full items-center gap-3 rounded-md border p-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${
                        selected
                          ? "border-sky-500 bg-sky-500/10"
                          : "border-slate-700 bg-slate-950/70 hover:border-slate-600"
                      }`}
                    >
                      <div className="flex h-12 w-9 shrink-0 flex-col overflow-hidden rounded-sm bg-white shadow-sm">
                        <div className={`h-4 w-full ${card.coverBg}`} />
                        <div className="flex flex-1 flex-col justify-center gap-1 p-1">
                          <div
                            className={`h-1 w-5 rounded-full ${card.accentBg}`}
                          />
                          <div className={`h-0.5 w-full ${card.lineColor}`} />
                          <div className={`h-0.5 w-4/5 ${card.lineColor}`} />
                        </div>
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-white">
                          {card.name}
                        </div>
                        <div className="truncate text-[11px] text-slate-400">
                          {card.desc}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="space-y-2.5 rounded-md border border-slate-800 bg-slate-950/60 p-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-slate-300">
                    テーマ詳細カスタマイズ
                  </span>
                  <button
                    type="button"
                    onClick={resetThemeCustomization}
                    title="カラー・タイポグラフィを標準に戻す"
                    className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-slate-400 hover:bg-slate-800 hover:text-white"
                  >
                    <RotateCcw className="h-3 w-3" />
                    <span>標準に戻す</span>
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="mb-1 block text-[10px] text-slate-400">
                      プライマリカラー
                    </label>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="color"
                        value={displayPrimaryColor}
                        onChange={(e) =>
                          updateField("primary_color", e.target.value)
                        }
                        className="h-6 w-7 shrink-0 cursor-pointer rounded border border-slate-700 bg-transparent p-0"
                      />
                      <input
                        type="text"
                        placeholder={activeThemeDefaults.defaultPrimary}
                        value={frontmatter.primary_color}
                        onChange={(e) =>
                          updateField("primary_color", e.target.value)
                        }
                        className="w-full min-w-0 rounded border border-slate-700 bg-slate-950 px-1.5 py-1 font-mono text-[10px] text-white focus:border-sky-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block text-[10px] text-slate-400">
                      アクセントカラー
                    </label>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="color"
                        value={displayAccentColor}
                        onChange={(e) =>
                          updateField("accent_color", e.target.value)
                        }
                        className="h-6 w-7 shrink-0 cursor-pointer rounded border border-slate-700 bg-transparent p-0"
                      />
                      <input
                        type="text"
                        placeholder={activeThemeDefaults.defaultAccent}
                        value={frontmatter.accent_color}
                        onChange={(e) =>
                          updateField("accent_color", e.target.value)
                        }
                        className="w-full min-w-0 rounded border border-slate-700 bg-slate-950 px-1.5 py-1 font-mono text-[10px] text-white focus:border-sky-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-[10px] text-slate-400">
                    見出しハイライト
                  </label>
                  <select
                    value={frontmatter.heading_highlight}
                    onChange={(e) =>
                      updateField(
                        "heading_highlight",
                        e.target.value as HeadingHighlightMode
                      )
                    }
                    className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white focus:border-sky-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
                  >
                    <option value="tinted">淡色ハイライト（推奨・テーマ連動）</option>
                    <option value="solid">濃色帯（H1強調・H2淡色）</option>
                    <option value="none">標準（ハイライトなし）</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-[10px] text-slate-400">
                    本文フォント
                  </label>
                  <select
                    value={frontmatter.font_family}
                    onChange={(e) =>
                      updateField(
                        "font_family",
                        e.target.value as FontFamilyOption
                      )
                    }
                    className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white focus:border-sky-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
                  >
                    <option value="theme">テーマ標準</option>
                    <option value="sans">ゴシック体 (Sans-serif)</option>
                    <option value="serif">明朝体 (Serif)</option>
                  </select>
                </div>

                <div>
                  <div className="mb-1 flex items-center justify-between text-[10px]">
                    <span className="text-slate-400">本文フォントサイズ</span>
                    <span className="font-mono text-sky-300">
                      {frontmatter.font_size}pt
                    </span>
                  </div>
                  <input
                    type="range"
                    min={9}
                    max={12}
                    step={0.5}
                    value={frontmatter.font_size}
                    onChange={(e) =>
                      updateField("font_size", Number(e.target.value))
                    }
                    className="h-1.5 w-full cursor-pointer accent-sky-500"
                  />
                </div>

                <div>
                  <div className="mb-1 flex items-center justify-between text-[10px]">
                    <span className="text-slate-400">行間 (Line Height)</span>
                    <span className="font-mono text-sky-300">
                      {frontmatter.line_height.toFixed(1)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={1.4}
                    max={2.0}
                    step={0.1}
                    value={frontmatter.line_height}
                    onChange={(e) =>
                      updateField("line_height", Number(e.target.value))
                    }
                    className="h-1.5 w-full cursor-pointer accent-sky-500"
                  />
                </div>
              </div>
            </div>
        </details>

        {/* 5. ページ構成（表紙・目次・奥付） */}
        <details open className="mdpub-settings-details">
          <summary className="mdpub-settings-summary flex cursor-pointer select-none items-center justify-between px-4 py-2.5 font-semibold text-slate-100 hover:bg-slate-800/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-400">
            <span className="flex items-center gap-2">
              <LayoutTemplate className="h-3.5 w-3.5 text-sky-400" />
              ページ構成（表紙・目次・奥付）
            </span>
            <ChevronRight className="mdpub-details-chevron h-3.5 w-3.5 text-slate-400" />
          </summary>

          <div className="space-y-3 px-4 pb-4 pt-1">
              <div className="space-y-2">
                <label className="flex cursor-pointer items-center justify-between">
                  <span>表紙を生成</span>
                  <input
                    type="checkbox"
                    checked={frontmatter.cover}
                    onChange={(e) => updateField("cover", e.target.checked)}
                    className="h-4 w-4 accent-sky-500"
                  />
                </label>

                {frontmatter.cover && (
                  <div className="space-y-2 pl-2">
                    <ImageDropField
                      label="表紙の背景画像"
                      value={frontmatter.cover_image}
                      resolvedSrc={resolvedCoverImageSrc}
                      assetPrefix="asset:shared_cover_"
                      uploadPurpose="cover"
                      sharedAssets={sharedAssets}
                      onSave={onSaveAsset}
                      onChangeValue={(val) => updateField("cover_image", val)}
                      onError={onNotice}
                    />
                    {frontmatter.cover_image && (
                      <div>
                        <label className="mb-1 block text-[10px] text-slate-400">
                          オーバーレイ・文字色モード
                        </label>
                        <select
                          value={frontmatter.cover_overlay}
                          onChange={(e) =>
                            updateField(
                              "cover_overlay",
                              e.target.value as CoverOverlayMode
                            )
                          }
                          className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white focus:border-sky-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
                        >
                          <option value="light-fade">
                            明背景用（白フェード＋濃色文字）
                          </option>
                          <option value="dark-fade">
                            暗背景用（黒フェード＋白文字）
                          </option>
                          <option value="none">
                            オーバーレイなし（白文字）
                          </option>
                        </select>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <label className="flex cursor-pointer items-center justify-between">
                  <span>目次を自動生成</span>
                  <input
                    type="checkbox"
                    checked={frontmatter.toc}
                    onChange={(e) => updateField("toc", e.target.checked)}
                    className="h-4 w-4 accent-sky-500"
                  />
                </label>

                {frontmatter.toc && (
                  <div className="flex items-center justify-between pl-2">
                    <span className="text-[11px] text-slate-400">
                      見出しの深さ
                    </span>
                    <select
                      value={frontmatter.toc_depth}
                      onChange={(e) =>
                        updateField(
                          "toc_depth",
                          Number(e.target.value) as TocDepth
                        )
                      }
                      className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white"
                    >
                      <option value={1}>H1 まで</option>
                      <option value={2}>H1 〜 H2</option>
                      <option value={3}>H1 〜 H3</option>
                    </select>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <label className="flex cursor-pointer items-center justify-between">
                  <span>裏表紙（奥付）を生成</span>
                  <input
                    type="checkbox"
                    checked={frontmatter.back_cover}
                    onChange={(e) =>
                      updateField("back_cover", e.target.checked)
                    }
                    className="h-4 w-4 accent-sky-500"
                  />
                </label>

                {frontmatter.back_cover && (
                  <div className="space-y-2.5 pl-2">
                    <div>
                      <label className="mb-1 block text-[11px] text-slate-400">
                        奥付テキスト
                      </label>
                      <textarea
                        rows={3}
                        value={frontmatter.back_cover_text}
                        onChange={(e) =>
                          updateField("back_cover_text", e.target.value)
                        }
                        className="mdpub-auto-textarea w-full resize-y rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white focus:border-sky-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
                      />
                    </div>

                    <ImageDropField
                      label="裏表紙の背景画像"
                      value={frontmatter.back_cover_image}
                      resolvedSrc={resolvedBackCoverImageSrc}
                      assetPrefix="asset:shared_backcover_"
                      uploadPurpose="cover"
                      sharedAssets={sharedAssets}
                      onSave={onSaveAsset}
                      onChangeValue={(val) =>
                        updateField("back_cover_image", val)
                      }
                      onError={onNotice}
                    />
                  </div>
                )}
              </div>
            </div>
        </details>

        {/* 6. ヘッダー・フッター・ロゴ */}
        <details open className="mdpub-settings-details">
          <summary className="mdpub-settings-summary flex cursor-pointer select-none items-center justify-between px-4 py-2.5 font-semibold text-slate-100 hover:bg-slate-800/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-400">
            <span className="flex items-center gap-2">
              <ImagePlus className="h-3.5 w-3.5 text-sky-400" />
              ヘッダー・フッター・ロゴ
            </span>
            <ChevronRight className="mdpub-details-chevron h-3.5 w-3.5 text-slate-400" />
          </summary>

          <div className="space-y-3 px-4 pb-6 pt-1">
              <div>
                <div className="mb-1 text-[11px] text-slate-400">
                  クリックで選択中の欄に挿入:
                </div>
                <div className="flex flex-wrap gap-1">
                  {VARIABLE_CHIPS.map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => handleInsertChip(chip)}
                      className="rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-sky-300 hover:bg-slate-700"
                    >
                      {chip}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-[11px] text-slate-400">
                    左ヘッダー
                  </label>
                  <input
                    type="text"
                    value={frontmatter.header_left}
                    onFocus={() => setFocusedField("header_left")}
                    onChange={(e) => updateField("header_left", e.target.value)}
                    className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white focus:border-sky-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-slate-400">
                    右ヘッダー
                  </label>
                  <input
                    type="text"
                    value={frontmatter.header_right}
                    onFocus={() => setFocusedField("header_right")}
                    onChange={(e) =>
                      updateField("header_right", e.target.value)
                    }
                    className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white focus:border-sky-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-[11px] text-slate-400">
                    左フッター
                  </label>
                  <input
                    type="text"
                    value={frontmatter.footer_left}
                    onFocus={() => setFocusedField("footer_left")}
                    onChange={(e) => updateField("footer_left", e.target.value)}
                    className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white focus:border-sky-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-slate-400">
                    右フッター
                  </label>
                  <input
                    type="text"
                    value={frontmatter.footer_right}
                    onFocus={() => setFocusedField("footer_right")}
                    onChange={(e) =>
                      updateField("footer_right", e.target.value)
                    }
                    className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white focus:border-sky-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
                  />
                </div>
              </div>

              <div className="space-y-2 pt-1">
                <ImageDropField
                  label="ロゴ画像（ブラウザ内保存）"
                  value={frontmatter.logo}
                  resolvedSrc={resolvedLogoSrc}
                  assetPrefix="asset:shared_logo_"
                  uploadPurpose="logo"
                  sharedAssets={sharedAssets}
                  onSave={onSaveAsset}
                  onChangeValue={(val) => updateField("logo", val)}
                  onError={onNotice}
                />

                <div>
                  <label className="mb-1 block text-[11px] text-slate-400">
                    ロゴの配置位置
                  </label>
                  <select
                    value={frontmatter.logo_position}
                    onChange={(e) =>
                      updateField(
                        "logo_position",
                        e.target.value as LogoPosition
                      )
                    }
                    className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white"
                  >
                    <option value="cover-and-header">表紙とヘッダー</option>
                    <option value="cover-only">表紙のみ</option>
                    <option value="header-only">ヘッダーのみ</option>
                  </select>
                </div>
              </div>
            </div>
        </details>
      </div>
    </aside>
  );
}
