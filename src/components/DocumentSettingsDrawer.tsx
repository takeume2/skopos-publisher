"use client";

import React, { useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  ImagePlus,
  LayoutTemplate,
  Palette,
  RotateCcw,
  Settings2,
  Trash2,
  Type,
  X,
} from "lucide-react";
import type {
  DocumentFrontmatter,
  DocumentTheme,
  FontFamilyOption,
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
  onChangeFrontmatter: (next: DocumentFrontmatter) => void;
  onSaveAsset: (assetId: string, dataUrl: string) => Promise<void>;
  onRemoveAsset: (assetId: string) => Promise<void>;
}

const VARIABLE_CHIPS = [
  "{title}",
  "{date}",
  "{author}",
  "{page}",
  "{pages}",
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

export function DocumentSettingsDrawer({
  isOpen,
  onClose,
  frontmatter,
  assets,
  onChangeFrontmatter,
  onSaveAsset,
  onRemoveAsset,
}: DocumentSettingsDrawerProps) {
  const [openSections, setOpenSections] = useState({
    basic: true,
    theme: true,
    structure: true,
    headerFooter: true,
  });

  const [focusedField, setFocusedField] = useState<
    "header_left" | "header_right" | "footer_left" | "footer_right"
  >("header_left");
  const [isDraggingLogo, setIsDraggingLogo] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

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
      font_family: "theme",
      font_size: 10,
      line_height: 1.7,
    });
  };

  const toggleSection = (key: keyof typeof openSections) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleInsertChip = (chip: string) => {
    const current = frontmatter[focusedField] || "";
    updateField(focusedField, current ? `${current} ${chip}` : chip);
  };

  const processLogoFile = (file: File) => {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = async () => {
      if (typeof reader.result === "string") {
        const assetId = "asset:logo_1";
        await onSaveAsset(assetId, reader.result);
        updateField("logo", assetId);
      }
    };
    reader.readAsDataURL(file);
  };

  const resolvedLogoSrc = frontmatter.logo.startsWith("asset:")
    ? assets[frontmatter.logo] || ""
    : frontmatter.logo;

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
          className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto divide-y divide-slate-800 text-xs">
        <section>
          <button
            type="button"
            onClick={() => toggleSection("basic")}
            className="flex w-full items-center justify-between px-4 py-2.5 font-semibold text-slate-100 hover:bg-slate-800/50"
          >
            <span className="flex items-center gap-2">
              <Type className="h-3.5 w-3.5 text-sky-400" />
              基本・用紙設定
            </span>
            {openSections.basic ? (
              <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
            )}
          </button>

          {openSections.basic && (
            <div className="space-y-3 px-4 pb-4 pt-1">
              <div>
                <label className="mb-1 block text-[11px] text-slate-400">
                  タイトル
                </label>
                <input
                  type="text"
                  value={frontmatter.title}
                  onChange={(e) => updateField("title", e.target.value)}
                  className="w-full rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white focus:border-sky-500 focus:outline-none"
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
                  className="w-full rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white focus:border-sky-500 focus:outline-none"
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
                    className="w-full rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white focus:border-sky-500 focus:outline-none"
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
                    className="w-full rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white focus:border-sky-500 focus:outline-none"
                  />
                </div>
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
                    className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white focus:border-sky-500 focus:outline-none"
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
                    className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white focus:border-sky-500 focus:outline-none"
                  >
                    <option value="portrait">縦 (Portrait)</option>
                    <option value="landscape">横 (Landscape)</option>
                  </select>
                </div>
              </div>
            </div>
          )}
        </section>

        <section>
          <button
            type="button"
            onClick={() => toggleSection("theme")}
            className="flex w-full items-center justify-between px-4 py-2.5 font-semibold text-slate-100 hover:bg-slate-800/50"
          >
            <span className="flex items-center gap-2">
              <Palette className="h-3.5 w-3.5 text-sky-400" />
              デザインテーマ & カスタマイズ
            </span>
            {openSections.theme ? (
              <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
            )}
          </button>

          {openSections.theme && (
            <div className="space-y-3 px-4 pb-4 pt-1">
              <div className="space-y-2">
                {THEME_CARDS.map((card) => {
                  const selected = frontmatter.theme === card.id;
                  return (
                    <button
                      key={card.id}
                      type="button"
                      onClick={() => updateField("theme", card.id)}
                      className={`flex w-full items-center gap-3 rounded-md border p-2 text-left transition ${
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

              {/* テーマ詳細カスタマイズ */}
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
                        className="w-full min-w-0 rounded border border-slate-700 bg-slate-950 px-1.5 py-1 font-mono text-[10px] text-white focus:border-sky-500 focus:outline-none"
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
                        className="w-full min-w-0 rounded border border-slate-700 bg-slate-950 px-1.5 py-1 font-mono text-[10px] text-white focus:border-sky-500 focus:outline-none"
                      />
                    </div>
                  </div>
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
                    className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white focus:border-sky-500 focus:outline-none"
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
          )}
        </section>

        <section>
          <button
            type="button"
            onClick={() => toggleSection("structure")}
            className="flex w-full items-center justify-between px-4 py-2.5 font-semibold text-slate-100 hover:bg-slate-800/50"
          >
            <span className="flex items-center gap-2">
              <LayoutTemplate className="h-3.5 w-3.5 text-sky-400" />
              ページ構成（表紙・目次・奥付）
            </span>
            {openSections.structure ? (
              <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
            )}
          </button>

          {openSections.structure && (
            <div className="space-y-3 px-4 pb-4 pt-1">
              <label className="flex cursor-pointer items-center justify-between">
                <span>表紙を生成</span>
                <input
                  type="checkbox"
                  checked={frontmatter.cover}
                  onChange={(e) => updateField("cover", e.target.checked)}
                  className="h-4 w-4 accent-sky-500"
                />
              </label>

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
                      className="w-full rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white focus:border-sky-500 focus:outline-none"
                    />
                  </div>
                )}
              </div>
            </div>
          )}
        </section>

        <section>
          <button
            type="button"
            onClick={() => toggleSection("headerFooter")}
            className="flex w-full items-center justify-between px-4 py-2.5 font-semibold text-slate-100 hover:bg-slate-800/50"
          >
            <span className="flex items-center gap-2">
              <ImagePlus className="h-3.5 w-3.5 text-sky-400" />
              ヘッダー・フッター・ロゴ
            </span>
            {openSections.headerFooter ? (
              <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
            )}
          </button>

          {openSections.headerFooter && (
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
                    className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white focus:border-sky-500 focus:outline-none"
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
                    className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white focus:border-sky-500 focus:outline-none"
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
                    className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white focus:border-sky-500 focus:outline-none"
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
                    className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white focus:border-sky-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="space-y-2 pt-1">
                <label className="block text-[11px] text-slate-400">
                  ロゴ画像（ブラウザ内保存）
                </label>

                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) processLogoFile(file);
                    e.target.value = "";
                  }}
                />

                {resolvedLogoSrc ? (
                  <div className="flex items-center justify-between rounded border border-slate-700 bg-slate-950 p-2">
                    <img
                      src={resolvedLogoSrc}
                      alt="Logo Preview"
                      className="max-h-10 max-w-[160px] object-contain"
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        if (frontmatter.logo.startsWith("asset:")) {
                          await onRemoveAsset(frontmatter.logo);
                        }
                        updateField("logo", "");
                      }}
                      title="ロゴを削除"
                      className="rounded p-1.5 text-red-400 hover:bg-red-950/50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      setIsDraggingLogo(true);
                    }}
                    onDragLeave={() => setIsDraggingLogo(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setIsDraggingLogo(false);
                      const file = e.dataTransfer.files?.[0];
                      if (file) processLogoFile(file);
                    }}
                    onClick={() => logoInputRef.current?.click()}
                    className={`flex cursor-pointer flex-col items-center justify-center rounded-md border border-dashed px-3 py-4 text-center transition ${
                      isDraggingLogo
                        ? "border-sky-400 bg-sky-500/10"
                        : "border-slate-700 bg-slate-950/60 hover:border-slate-500"
                    }`}
                  >
                    <ImagePlus className="mb-1 h-5 w-5 text-slate-400" />
                    <span className="text-[11px] text-slate-300">
                      ドラッグ＆ドロップ または クリックして選択
                    </span>
                  </div>
                )}

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
          )}
        </section>
      </div>
    </aside>
  );
}
