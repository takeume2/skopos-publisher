"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  FileText,
  Grid,
  Loader2,
  Maximize2,
  Minimize2,
  RefreshCw,
  ShieldAlert,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { compileMarkdownToHtml, resolveAssetSrc } from "@/lib/markdown";
import { buildPagedMediaCss } from "@/lib/paged-css";
import {
  capturePreviewScrollSnapshot,
  detectCurrentPage,
  escapeCssId,
  restorePreviewScrollSnapshot,
} from "@/lib/preview-scroll";
import type { LayoutMode } from "@/hooks/useIndexedDbStorage";
import type { DocumentFrontmatter } from "@/types/document";

interface PagedPreviewPaneProps {
  documentId?: string | null;
  markdown: string;
  frontmatter: DocumentFrontmatter;
  assets: Record<string, string>;
  autoUpdate: boolean;
  onToggleAutoUpdate: (value: boolean) => void;
  showMarginGuides: boolean;
  onToggleMarginGuides: (value: boolean) => void;
  layoutMode: LayoutMode;
  onLayoutModeChange: (mode: LayoutMode) => void;
}

interface DestroyablePreviewer {
  polisher?: {
    destroy?: () => void;
  };
}

function escapeCssContent(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

async function yieldToMain(): Promise<void> {
  const globalScheduler = (
    globalThis as typeof globalThis & {
      scheduler?: { yield?: () => Promise<void> };
    }
  ).scheduler;
  if (typeof globalScheduler?.yield === "function") {
    await globalScheduler.yield();
    return;
  }
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function applyBodyPageNumbers(
  rootContainer: HTMLElement,
  renderId: number
): HTMLStyleElement | null {
  const pages = Array.from(
    rootContainer.querySelectorAll<HTMLElement>(".pagedjs_page")
  );
  if (!pages.length) return null;

  const renderScopeEl =
    rootContainer.querySelector<HTMLElement>(".pagedjs_pages") ??
    (rootContainer.firstElementChild as HTMLElement | null);
  if (renderScopeEl) {
    renderScopeEl.setAttribute("data-paged-render", String(renderId));
  }

  const bodyPageMap = new Map<HTMLElement, number>();
  let bodyPageCounter = 0;

  for (const pageEl of pages) {
    const isCover = Boolean(pageEl.querySelector(".doc-cover"));
    const isToc = Boolean(pageEl.querySelector(".doc-toc"));
    const isBackCover = Boolean(pageEl.querySelector(".doc-backcover"));

    if (!isCover && !isToc && !isBackCover) {
      bodyPageCounter++;
      bodyPageMap.set(pageEl, bodyPageCounter);
    }
  }

  const totalBodyPages = bodyPageCounter;

  const tocNumNodes = rootContainer.querySelectorAll<HTMLElement>(
    ".toc-page-num[data-target-id]"
  );
  tocNumNodes.forEach((numEl) => {
    const targetId = numEl.getAttribute("data-target-id");
    if (!targetId) return;
    const targetEl = rootContainer.querySelector<HTMLElement>(
      `#${escapeCssId(targetId)}`
    );
    const targetPage = targetEl?.closest<HTMLElement>(".pagedjs_page");
    if (targetPage && bodyPageMap.has(targetPage)) {
      numEl.textContent = String(bodyPageMap.get(targetPage));
    } else if (targetPage) {
      const idx = pages.indexOf(targetPage);
      if (idx >= 0) numEl.textContent = String(idx + 1);
    }
  });

  const overrideRules: string[] = [];
  const scopePrefix = renderScopeEl ? `[data-paged-render="${renderId}"] ` : "";

  bodyPageMap.forEach((pageNum, pageEl) => {
    if (!pageEl.id) return;

    const marginBoxes = pageEl.querySelectorAll<HTMLElement>(
      ".pagedjs_margin-content"
    );

    marginBoxes.forEach((contentEl) => {
      const rawText = contentEl.textContent || "";
      const afterContent = window
        .getComputedStyle(contentEl, "::after")
        .getPropertyValue("content");

      const hasTokenInText =
        rawText.includes("__MD_PAGE__") || rawText.includes("__MD_PAGES__");
      const hasTokenInAfter =
        afterContent.includes("__MD_PAGE__") ||
        afterContent.includes("__MD_PAGES__");

      if (hasTokenInText) {
        contentEl.textContent = rawText
          .replaceAll("__MD_PAGE__", String(pageNum))
          .replaceAll("__MD_PAGES__", String(totalBodyPages));
      }

      if (hasTokenInAfter) {
        const cleaned = afterContent.replace(/^["']|["']$/g, "");
        const replaced = cleaned
          .replaceAll("__MD_PAGE__", String(pageNum))
          .replaceAll("__MD_PAGES__", String(totalBodyPages));

        const parentMargin = contentEl.parentElement;
        if (parentMargin) {
          const marginClass = Array.from(parentMargin.classList).find((c) =>
            c.startsWith("pagedjs_margin-")
          );
          if (marginClass) {
            overrideRules.push(
              `${scopePrefix}#${escapeCssId(pageEl.id)} .${marginClass} > .pagedjs_margin-content::after { content: "${escapeCssContent(replaced)}" !important; }`
            );
          }
        }
      }
    });
  });

  if (overrideRules.length > 0) {
    const styleEl = document.createElement("style");
    styleEl.setAttribute("data-pagedjs-inserted-styles", "true");
    styleEl.setAttribute("data-paged-render-override", String(renderId));
    styleEl.textContent = overrideRules.join("\n");
    return styleEl;
  }

  return null;
}

function destroyPreviewerSafely(previewer: DestroyablePreviewer | null) {
  if (!previewer) return;
  try {
    previewer.polisher?.destroy?.();
  } catch {
    // ignore cleanup errors from partially initialized previewer
  }
}

export function PagedPreviewPane({
  documentId,
  markdown,
  frontmatter,
  assets,
  autoUpdate,
  onToggleAutoUpdate,
  showMarginGuides,
  onToggleMarginGuides,
  layoutMode,
  onLayoutModeChange,
}: PagedPreviewPaneProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const previewHostRef = useRef<HTMLDivElement>(null);
  const measureHostRef = useRef<HTMLDivElement>(null);
  const activePreviewerRef = useRef<DestroyablePreviewer | null>(null);
  const activeOverrideStyleRef = useRef<HTMLStyleElement | null>(null);
  const lastCommittedDocIdRef = useRef<string | null | undefined>(documentId);
  const renderIdRef = useRef(0);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasMountedRef = useRef<boolean>(false);

  const [zoom, setZoom] = useState<number>(85);
  const [totalPages, setTotalPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageInput, setPageInput] = useState<string>("1");
  const [isRendering, setIsRendering] = useState<boolean>(false);
  const [renderError, setRenderError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("debug") === "true") {
      document.body.classList.add("debug-layout");
    }
    return () => {
      document.body.classList.remove("debug-layout");
    };
  }, []);

  const cleanupPagedStyles = useCallback(() => {
    activeOverrideStyleRef.current?.remove();
    activeOverrideStyleRef.current = null;

    destroyPreviewerSafely(activePreviewerRef.current);
    activePreviewerRef.current = null;

    const insertedStyles = document.querySelectorAll(
      "style[data-pagedjs-inserted-styles]"
    );
    insertedStyles.forEach((el) => el.remove());

    if (measureHostRef.current) {
      measureHostRef.current.innerHTML = "";
    }
    if (previewHostRef.current) {
      previewHostRef.current.innerHTML = "";
    }
  }, []);

  const renderDocument = useCallback(
    async (sourceMarkdown: string, targetDocumentId?: string | null) => {
      const host = previewHostRef.current;
      const measureHost = measureHostRef.current;
      if (!host || !measureHost) return;

      const currentRenderId = ++renderIdRef.current;
      setIsRendering(true);
      setRenderError(null);

      let stagingEl: HTMLDivElement | null = null;
      let previewer: DestroyablePreviewer | null = null;
      let nextOverrideStyle: HTMLStyleElement | null = null;
      let committed = false;

      const discardStaging = () => {
        nextOverrideStyle?.remove();
        nextOverrideStyle = null;
        destroyPreviewerSafely(previewer);
        previewer = null;
        stagingEl?.remove();
        stagingEl = null;
      };

      try {
        if (document.fonts?.ready) {
          await document.fonts.ready;
        }

        if (currentRenderId !== renderIdRef.current) return;

        const compiled = await compileMarkdownToHtml(sourceMarkdown, assets);
        await yieldToMain();

        if (currentRenderId !== renderIdRef.current) return;

        const fm = compiled.frontmatter;
        const resolvedLogo = fm.logo ? resolveAssetSrc(fm.logo, assets) : "";
        const resolvedCover = fm.cover_image
          ? resolveAssetSrc(fm.cover_image, assets)
          : "";
        const resolvedBackCover = fm.back_cover_image
          ? resolveAssetSrc(fm.back_cover_image, assets)
          : "";

        const cssText = buildPagedMediaCss(fm, {
          logoUrl: resolvedLogo || undefined,
          coverImageUrl: resolvedCover || undefined,
          backCoverImageUrl: resolvedBackCover || undefined,
        });

        const { Previewer } = await import("pagedjs");

        if (currentRenderId !== renderIdRef.current) return;

        stagingEl = document.createElement("div");
        stagingEl.setAttribute("data-paged-staging", String(currentRenderId));
        measureHost.appendChild(stagingEl);

        const nextPreviewer = new Previewer();
        previewer = nextPreviewer;

        const flow = await nextPreviewer.preview(
          compiled.html,
          [{ "paged-media.css": cssText }],
          stagingEl
        );

        if (currentRenderId !== renderIdRef.current) {
          discardStaging();
          return;
        }

        await yieldToMain();
        if (currentRenderId !== renderIdRef.current) {
          discardStaging();
          return;
        }

        nextOverrideStyle = applyBodyPageNumbers(stagingEl, currentRenderId);

        const scrollContainer = scrollContainerRef.current;
        const isDocumentChanged =
          targetDocumentId !== undefined &&
          lastCommittedDocIdRef.current !== undefined &&
          lastCommittedDocIdRef.current !== targetDocumentId;

        const scrollSnapshot =
          !isDocumentChanged && scrollContainer
            ? capturePreviewScrollSnapshot(scrollContainer, host)
            : null;

        // 同一同期処理内でスタイル・DOM・スクロール位置を一括差し替え（ちらつき防止）
        activeOverrideStyleRef.current?.remove();
        destroyPreviewerSafely(activePreviewerRef.current);

        if (nextOverrideStyle) {
          document.head.appendChild(nextOverrideStyle);
        }

        activePreviewerRef.current = nextPreviewer;
        activeOverrideStyleRef.current = nextOverrideStyle;
        lastCommittedDocIdRef.current = targetDocumentId;

        host.replaceChildren(...Array.from(stagingEl.childNodes));
        stagingEl.remove();
        stagingEl = null;
        committed = true;

        const pageCount =
          flow?.total ?? host.querySelectorAll(".pagedjs_page").length;
        setTotalPages(pageCount);

        let restoredPage = 1;
        if (scrollContainer) {
          if (isDocumentChanged) {
            scrollContainer.scrollTop = 0;
            scrollContainer.scrollLeft = 0;
            restoredPage = 1;
          } else if (scrollSnapshot) {
            restoredPage = restorePreviewScrollSnapshot(
              scrollContainer,
              host,
              scrollSnapshot
            );
          }
        }

        const clampedPage = Math.min(
          Math.max(1, restoredPage),
          Math.max(1, pageCount)
        );
        setCurrentPage(clampedPage);
        setPageInput(String(clampedPage));
      } catch (err) {
        if (!committed) {
          discardStaging();
        }
        if (currentRenderId !== renderIdRef.current) return;
        console.error("Paged.js rendering error:", err);
        setRenderError(
          err instanceof Error
            ? err.message
            : "組版レンダリング中にエラーが発生しました。"
        );
      } finally {
        if (!committed) {
          discardStaging();
        }
        if (currentRenderId === renderIdRef.current) {
          setIsRendering(false);
        }
      }
    },
    [assets]
  );

  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      renderDocument(markdown, documentId);
      return;
    }

    if (!autoUpdate) return;

    debounceTimerRef.current = setTimeout(() => {
      renderDocument(markdown, documentId);
    }, 800);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [
    documentId,
    markdown,
    assets,
    autoUpdate,
    frontmatter.confidential_mode,
    frontmatter.confidential_label,
    frontmatter.recipient,
    frontmatter.cover_image,
    frontmatter.back_cover_image,
    renderDocument,
  ]);

  useEffect(() => {
    return () => {
      hasMountedRef.current = false;
      renderIdRef.current++;
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      cleanupPagedStyles();
    };
  }, [cleanupPagedStyles]);

  const handleManualRender = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    renderDocument(markdown, documentId);
  }, [documentId, markdown, renderDocument]);

  const scrollToPage = useCallback((targetPage: number) => {
    const host = previewHostRef.current;
    if (!host) return;
    const pages = host.querySelectorAll<HTMLElement>(".pagedjs_page");
    if (!pages.length) return;

    const clamped = Math.min(Math.max(1, targetPage), pages.length);
    const targetEl = pages[clamped - 1];
    if (targetEl) {
      targetEl.scrollIntoView({ behavior: "smooth", block: "start" });
      setCurrentPage(clamped);
      setPageInput(String(clamped));
    }
  }, []);

  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    const host = previewHostRef.current;
    if (!container || !host) return;

    const pages = host.querySelectorAll<HTMLElement>(".pagedjs_page");
    if (!pages.length) return;

    const detected = detectCurrentPage(container, host);
    setCurrentPage(detected);
    setPageInput(String(detected));
  }, []);

  const handleFitWidth = useCallback(() => {
    const container = scrollContainerRef.current;
    const host = previewHostRef.current;
    if (!container || !host) return;

    const firstPage = host.querySelector<HTMLElement>(".pagedjs_page");
    if (!firstPage) return;

    const pageWidth = firstPage.offsetWidth;
    if (!pageWidth) return;

    const availableWidth = container.clientWidth - 64;
    const divisor = layoutMode === "spread" ? pageWidth * 2 + 14 : pageWidth;
    const ratio = Math.floor((availableWidth / divisor) * 100);
    setZoom(Math.min(200, Math.max(50, ratio)));
  }, [layoutMode]);

  const handleFitPage = useCallback(() => {
    const container = scrollContainerRef.current;
    const host = previewHostRef.current;
    if (!container || !host) return;

    const firstPage = host.querySelector<HTMLElement>(".pagedjs_page");
    if (!firstPage) return;

    const pageWidth = firstPage.offsetWidth;
    const pageHeight = firstPage.offsetHeight;
    if (!pageWidth || !pageHeight) return;

    const availW = container.clientWidth - 64;
    const availH = container.clientHeight - 64;
    const targetW = layoutMode === "spread" ? pageWidth * 2 + 14 : pageWidth;

    const ratioW = availW / targetW;
    const ratioH = availH / pageHeight;
    const ratio = Math.floor(Math.min(ratioW, ratioH) * 100);
    setZoom(Math.min(200, Math.max(50, ratio)));
  }, [layoutMode]);

  const handlePageInputSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const num = Number(pageInput);
    if (!Number.isNaN(num)) {
      scrollToPage(num);
    }
  };

  return (
    <div className="print-preview-pane preview-pane-container flex h-full min-h-0 flex-col bg-zinc-800">
      <div className="no-print flex flex-wrap items-center justify-between gap-2 border-b border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-200">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(50, z - 10))}
            title="縮小"
            aria-label="プレビューを縮小"
            className="rounded p-1 text-zinc-300 hover:bg-zinc-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>

          <input
            type="range"
            aria-label="プレビュー倍率"
            min={50}
            max={200}
            step={5}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="h-1.5 w-20 cursor-pointer accent-sky-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
          />

          <button
            type="button"
            onClick={() => setZoom(100)}
            title="100% にリセット"
            className="min-w-[44px] rounded bg-zinc-800 px-1.5 py-0.5 text-center font-mono tabular-nums text-[11px] hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
          >
            {zoom}%
          </button>

          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(200, z + 10))}
            title="拡大"
            aria-label="プレビューを拡大"
            className="rounded p-1 text-zinc-300 hover:bg-zinc-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>

          <div className="mx-1 h-4 w-px bg-zinc-700" />

          <button
            type="button"
            onClick={handleFitWidth}
            title="幅に合わせる (Fit Width)"
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
          >
            <Maximize2 className="h-3 w-3" />
            <span className="preview-cq-label">幅に合わせる</span>
          </button>

          <button
            type="button"
            onClick={handleFitPage}
            title="ページ全体を表示 (Fit Page)"
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
          >
            <Minimize2 className="h-3 w-3" />
            <span className="preview-cq-label">全体表示</span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          <div
            role="group"
            aria-label="ページ表示レイアウト切替"
            className="flex items-center rounded border border-zinc-700 bg-zinc-950 p-0.5"
          >
            <button
              type="button"
              aria-pressed={layoutMode === "single"}
              onClick={() => onLayoutModeChange("single")}
              title="単ページ縦並び"
              className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${
                layoutMode === "single"
                  ? "bg-zinc-800 text-white"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <FileText className="h-3 w-3" />
              <span>単ページ</span>
            </button>
            <button
              type="button"
              aria-pressed={layoutMode === "spread"}
              onClick={() => onLayoutModeChange("spread")}
              title="見開き表示"
              className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${
                layoutMode === "spread"
                  ? "bg-zinc-800 text-white"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <BookOpen className="h-3 w-3" />
              <span>見開き</span>
            </button>
          </div>

          <form
            onSubmit={handlePageInputSubmit}
            className="flex items-center gap-1"
          >
            <button
              type="button"
              disabled={currentPage <= 1}
              aria-label="前のページへ"
              onClick={() => scrollToPage(currentPage - 1)}
              className="rounded p-1 text-zinc-300 hover:bg-zinc-800 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <input
              type="text"
              inputMode="numeric"
              aria-label="表示ページ番号"
              value={pageInput}
              onChange={(e) => setPageInput(e.target.value)}
              onBlur={() => {
                const num = Number(pageInput);
                if (!Number.isNaN(num) && num >= 1) {
                  scrollToPage(num);
                } else {
                  setPageInput(String(currentPage));
                }
              }}
              className="w-10 rounded border border-zinc-700 bg-zinc-950 px-1 py-0.5 text-center font-mono tabular-nums text-[11px] text-white focus-visible:border-sky-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
            />
            <span className="tabular-nums text-[11px] text-zinc-400">
              / {totalPages} ページ
            </span>
            <button
              type="button"
              disabled={currentPage >= totalPages}
              aria-label="次のページへ"
              onClick={() => scrollToPage(currentPage + 1)}
              className="rounded p-1 text-zinc-300 hover:bg-zinc-800 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </form>
        </div>

        <div className="flex items-center gap-2">
          {frontmatter.confidential_mode === "strict" && (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/50 bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-300">
              <ShieldAlert className="h-3 w-3" />
              <span>
                透かし: {frontmatter.confidential_label || "CONFIDENTIAL"}
              </span>
            </span>
          )}

          <button
            type="button"
            aria-pressed={showMarginGuides}
            onClick={() => onToggleMarginGuides(!showMarginGuides)}
            title="余白ガイド線の表示切替"
            className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${
              showMarginGuides
                ? "border-sky-500/60 bg-sky-500/15 text-sky-300"
                : "border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
            }`}
          >
            <Grid className="h-3 w-3" />
            <span className="preview-cq-label">余白ガイド</span>
          </button>

          <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] text-zinc-300">
            <input
              type="checkbox"
              checked={autoUpdate}
              onChange={(e) => onToggleAutoUpdate(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-zinc-600 bg-zinc-900 accent-sky-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
            />
            <span>自動更新</span>
          </label>

          <button
            type="button"
            onClick={handleManualRender}
            disabled={isRendering}
            className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-[11px] text-zinc-200 hover:bg-zinc-700 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
          >
            {isRendering ? (
              <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none text-sky-400" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
            <span>再描画</span>
          </button>
        </div>
      </div>

      {renderError && (
        <div
          role="alert"
          className="no-print border-b border-red-800 bg-red-950/80 px-4 py-2 text-xs text-red-200"
        >
          組版エラー: {renderError}
        </div>
      )}

      <div
        ref={measureHostRef}
        aria-hidden="true"
        inert={true}
        className="no-print pointer-events-none fixed left-[-99999px] top-0 opacity-0"
        style={{ zoom: 1 }}
      />

      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="print-scroll-container relative min-h-0 flex-1 overflow-auto [scrollbar-gutter:stable] bg-zinc-800"
      >
        {isRendering && (
          <div className="no-print pointer-events-none sticky top-3 z-10 flex justify-end px-4">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-900/90 px-3 py-1 text-[11px] text-sky-300 shadow">
              <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" />
              <span>ページネーション計算中...</span>
            </div>
          </div>
        )}

        <div className="print-zoom-wrapper" style={{ zoom: zoom / 100 }}>
          <div
            ref={previewHostRef}
            className={`paged-preview-canvas ${
              layoutMode === "spread" ? "layout-spread" : ""
            } ${frontmatter.cover ? "has-cover" : ""} ${
              showMarginGuides ? "show-margin-guides" : ""
            }`}
          />
        </div>
      </div>
    </div>
  );
}
