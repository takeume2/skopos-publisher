"use client";

import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileText,
  Grid,
  Loader2,
  Maximize2,
  Minimize2,
  RefreshCw,
  ShieldAlert,
  Upload,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { isFileDragEvent } from "@/lib/editor-drop";
import { compileMarkdownToHtml, resolveAssetSrc } from "@/lib/markdown";
import { buildPagedMediaCss } from "@/lib/paged-css";
import {
  capturePreviewScrollSnapshot,
  detectCurrentPage,
  escapeCssId,
  restorePreviewScrollSnapshot,
} from "@/lib/preview-scroll";
import type { UnresolvedAssetRef } from "@/lib/unresolved-assets";
import type { LayoutMode } from "@/hooks/useIndexedDbStorage";
import type { DocumentFrontmatter } from "@/types/document";

export interface RenderForPrintResult {
  ok: boolean;
  cancelled?: boolean;
  error?: string;
}

export interface PagedPreviewPaneHandle {
  isUpToDate: () => boolean;
  renderNow: () => Promise<RenderForPrintResult>;
}

interface RenderSnapshot {
  documentId: string | null | undefined;
  markdown: string;
  assets: Record<string, string>;
  assetRestoreNonce: number;
}

function isSameRenderSnapshot(
  a: RenderSnapshot | null,
  b: RenderSnapshot
): boolean {
  if (!a) return false;
  return (
    a.documentId === b.documentId &&
    a.markdown === b.markdown &&
    a.assets === b.assets &&
    a.assetRestoreNonce === b.assetRestoreNonce
  );
}

interface PagedPreviewPaneProps {
  ref?: React.Ref<PagedPreviewPaneHandle>;
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
  unresolvedAssets?: UnresolvedAssetRef[];
  onDropFileOnPlaceholder?: (assetKey: string, file: File) => void | Promise<void>;
  onDropFilesOnPreview?: (files: File[]) => void | Promise<void>;
  restoreProgress?: { processed: number; total: number } | null;
  restoreNotice?: string | null;
  onDismissRestoreNotice?: () => void;
  assetRestoreNonce?: number;
}

interface PagedLayoutInstance {
  element?: HTMLElement;
  bounds?: DOMRect;
  parentBounds?: DOMRect;
  gap?: number;
}

interface PagedPageInstance {
  name?: string;
  width?: number;
  height?: number;
  element?: HTMLElement;
  pagebox?: HTMLElement;
  area?: HTMLElement;
}

interface PagedHookLike {
  register?: (...fns: Array<(...args: never[]) => unknown>) => void;
}

interface DestroyablePreviewer {
  chunker?: {
    stop?: () => void;
    destroy?: () => void;
    on?: (event: string, fn: (...args: never[]) => unknown) => void;
    hooks?: {
      beforePageLayout?: PagedHookLike;
      onPageLayout?: PagedHookLike;
      renderNode?: PagedHookLike;
      onOverflow?: PagedHookLike;
    };
  };
  polisher?: {
    destroy?: () => void;
  };
}

const SINGLE_PAGE_NAMED_CLASSES = [
  "pagedjs_cover_page",
  "pagedjs_chapter_page",
  "pagedjs_backcover_page",
] as const;

function isSinglePageNamedPage(pageEl: Element | null | undefined): boolean {
  if (!pageEl) return false;
  return SINGLE_PAGE_NAMED_CLASSES.some((cls) => pageEl.classList.contains(cls));
}

function flushNamedPageGridLayout(pageEl: Element | null | undefined, pagebox?: HTMLElement | null) {
  if (!pageEl || !pageEl.classList.contains("pagedjs_named_page")) return;
  const targetPagebox =
    pagebox ?? pageEl.querySelector<HTMLElement>(".pagedjs_pagebox");
  if (!targetPagebox) return;

  // Blink (Chrome 158 等) で親要素の --pagedjs-margin-* 変更後に .pagedjs_pagebox の
  // CSS Grid トラック（22mm/18mm → 0px）が再計算されないケースを確実に解消する
  const prevDisplay = targetPagebox.style.display;
  targetPagebox.style.display = "none";
  void targetPagebox.offsetHeight;
  targetPagebox.style.display = prevDisplay;
}

function applyInitialNamedPageClass(
  page: PagedPageInstance | undefined,
  content: DocumentFragment | Element | undefined,
  breakToken: unknown
) {
  const pageEl = page?.element;
  if (!pageEl || breakToken || !content) return;
  if (pageEl.classList.contains("pagedjs_named_page")) return;

  // <article class="doc-root"><section class="doc-cover" data-page="cover"> のように
  // ルート要素直下に名前付きページ要素がある場合、Paged.js の beforePageLayout は
  // 1 ページ目で data-page を見落とすため事前にクラスを付与する
  const rootEl = "firstElementChild" in content ? content.firstElementChild : null;
  const firstNamedEl = rootEl?.hasAttribute("data-page")
    ? rootEl
    : rootEl?.firstElementChild?.hasAttribute("data-page")
      ? rootEl.firstElementChild
      : null;
  const named = firstNamedEl?.getAttribute("data-page")?.trim();
  if (!named) return;

  page.name = named;
  pageEl.classList.add("pagedjs_named_page");
  pageEl.classList.add(`pagedjs_${named}_page`);
  pageEl.classList.add(`pagedjs_${named}_first_page`);
}

function syncNamedPageAreaBeforeLayout(page?: PagedPageInstance) {
  const pageEl = page?.element;
  const area = page?.area;
  if (!pageEl || !area) return;

  flushNamedPageGridLayout(pageEl, page.pagebox);

  const size = area.getBoundingClientRect();
  if (size.width <= 0 || size.height <= 0) return;

  const roundedWidth = Math.round(size.width);
  const roundedHeight = Math.round(size.height);
  area.style.columnWidth = `${roundedWidth}px`;
  page.width = roundedWidth;
  page.height = roundedHeight;
}

function syncNamedPageLayoutMetrics(layout?: PagedLayoutInstance) {
  const area = layout?.element;
  if (!area) return;

  const pageEl = area.closest(".pagedjs_page");
  flushNamedPageGridLayout(pageEl);

  const size = area.getBoundingClientRect();
  if (size.width <= 0 || size.height <= 0) return;

  area.style.columnWidth = `${Math.round(size.width)}px`;
  layout.bounds = size;

  const offsetParent = area.offsetParent as HTMLElement | null;
  if (offsetParent) {
    const parentBounds = offsetParent.getBoundingClientRect();
    layout.parentBounds = parentBounds;
    const gap = Number.parseFloat(window.getComputedStyle(area).columnGap);
    if (Number.isFinite(gap) && gap > 0) {
      layout.gap = gap - (size.left - parentBounds.left);
    } else {
      layout.gap = 0;
    }
  }
}

function registerNamedPageMetricsHooks(previewer: DestroyablePreviewer) {
  const chunker = previewer.chunker;
  const hooks = chunker?.hooks;
  if (!chunker || !hooks) return;

  hooks.beforePageLayout?.register?.(
    (
      page: PagedPageInstance,
      content: DocumentFragment | Element,
      breakToken: unknown
    ) => {
      applyInitialNamedPageClass(page, content, breakToken);
    }
  );

  // Chunker の "page" イベントは AtPage.beforePageLayout 完了後かつ page.layout() (new Layout) 実行前に発火するため、
  // ここで Grid 再計算と columnWidth 同期を行うことで renderTo の bounds 引数にも正しい全幅・全高が渡る
  chunker.on?.("page", (page: PagedPageInstance) => {
    syncNamedPageAreaBeforeLayout(page);
  });

  hooks.onPageLayout?.register?.(
    (
      _wrapper: HTMLElement,
      _breakToken: unknown,
      layout: PagedLayoutInstance
    ) => {
      syncNamedPageLayoutMetrics(layout);
    }
  );

  hooks.renderNode?.register?.(
    (_clone: Node, sourceNode: Node, layout: PagedLayoutInstance) => {
      if (
        sourceNode instanceof Element &&
        sourceNode.hasAttribute("data-page")
      ) {
        syncNamedPageLayoutMetrics(layout);
      }
    }
  );

  // 表紙・章扉・裏表紙は単一ページ固定（overflow: hidden）のため、万一ブラウザ固有の
  // サブピクセル／計測ズレで overflow が報告されても複数ページ分割・反復ループを抑止する
  hooks.onOverflow?.register?.(
    (
      overflow: Range | undefined,
      _rendered: HTMLElement,
      _bounds: DOMRect,
      layout: PagedLayoutInstance
    ) => {
      if (!overflow) return undefined;
      const pageEl = layout?.element?.closest(".pagedjs_page");
      if (isSinglePageNamedPage(pageEl)) {
        return null;
      }
      return undefined;
    }
  );
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
    previewer.chunker?.stop?.();
  } catch {
    // ignore stop errors from partially initialized chunker
  }
  try {
    previewer.polisher?.destroy?.();
  } catch {
    // ignore cleanup errors from partially initialized previewer
  }
}

function extractDroppedFiles(dataTransfer: DataTransfer | null): File[] {
  if (!dataTransfer) return [];
  if (dataTransfer.files && dataTransfer.files.length > 0) {
    return Array.from(dataTransfer.files);
  }
  if (dataTransfer.items && dataTransfer.items.length > 0) {
    const out: File[] = [];
    for (const item of Array.from(dataTransfer.items)) {
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file) out.push(file);
      }
    }
    return out;
  }
  return [];
}

export function PagedPreviewPane({
  ref,
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
  unresolvedAssets = [],
  onDropFileOnPlaceholder,
  onDropFilesOnPreview,
  restoreProgress = null,
  restoreNotice = null,
  onDismissRestoreNotice,
  assetRestoreNonce = 0,
}: PagedPreviewPaneProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const previewHostRef = useRef<HTMLDivElement>(null);
  const measureHostRef = useRef<HTMLDivElement>(null);
  const activePreviewerRef = useRef<DestroyablePreviewer | null>(null);
  const inFlightPreviewerRef = useRef<DestroyablePreviewer | null>(null);
  const activeOverrideStyleRef = useRef<HTMLStyleElement | null>(null);
  const lastCommittedDocIdRef = useRef<string | null | undefined>(documentId);
  const lastRestoreNonceRef = useRef<number>(assetRestoreNonce);
  const committedSnapshotRef = useRef<RenderSnapshot | null>(null);
  const inFlightRenderRef = useRef<{
    renderId: number;
    snapshot: RenderSnapshot;
    promise: Promise<RenderForPrintResult>;
  } | null>(null);
  const currentSnapshotRef = useRef<RenderSnapshot>({
    documentId,
    markdown,
    assets,
    assetRestoreNonce,
  });
  currentSnapshotRef.current = {
    documentId,
    markdown,
    assets,
    assetRestoreNonce,
  };
  const dragDepthRef = useRef<number>(0);
  const activeDropTargetRef = useRef<HTMLElement | null>(null);
  const renderIdRef = useRef(0);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasMountedRef = useRef<boolean>(false);

  const [zoom, setZoom] = useState<number>(85);
  const [totalPages, setTotalPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageInput, setPageInput] = useState<string>("1");
  const [isRendering, setIsRendering] = useState<boolean>(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [isDraggingFiles, setIsDraggingFiles] = useState<boolean>(false);

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
    committedSnapshotRef.current = null;
    inFlightRenderRef.current = null;
    activeOverrideStyleRef.current?.remove();
    activeOverrideStyleRef.current = null;

    if (inFlightPreviewerRef.current) {
      try {
        inFlightPreviewerRef.current.chunker?.stop?.();
      } catch {
        // ignore stop errors
      }
      inFlightPreviewerRef.current = null;
    }

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
    (
      sourceMarkdown: string,
      targetDocumentId?: string | null
    ): Promise<RenderForPrintResult> => {
      const host = previewHostRef.current;
      const measureHost = measureHostRef.current;
      if (!host || !measureHost) {
        return Promise.resolve({
          ok: false,
          error: "プレビュー領域が初期化されていません。",
        });
      }

      const currentRenderId = ++renderIdRef.current;
      const snapshot: RenderSnapshot = {
        documentId: targetDocumentId,
        markdown: sourceMarkdown,
        assets,
        assetRestoreNonce: currentSnapshotRef.current.assetRestoreNonce,
      };
      if (inFlightPreviewerRef.current) {
        try {
          inFlightPreviewerRef.current.chunker?.stop?.();
        } catch {
          // ignore stop errors from superseded chunker
        }
        inFlightPreviewerRef.current = null;
      }
      setIsRendering(true);
      setRenderError(null);

      const run = async (): Promise<RenderForPrintResult> => {
        let stagingEl: HTMLDivElement | null = null;
        let previewer: DestroyablePreviewer | null = null;
        let nextOverrideStyle: HTMLStyleElement | null = null;
        let committed = false;

        const discardStaging = () => {
          nextOverrideStyle?.remove();
          nextOverrideStyle = null;
          if (previewer && inFlightPreviewerRef.current === previewer) {
            inFlightPreviewerRef.current = null;
          }
          destroyPreviewerSafely(previewer);
          previewer = null;
          stagingEl?.remove();
          stagingEl = null;
        };

        try {
          if (document.fonts?.ready) {
            await document.fonts.ready;
          }

          if (currentRenderId !== renderIdRef.current) {
            return { ok: false, cancelled: true };
          }

          const compiled = await compileMarkdownToHtml(sourceMarkdown, assets);
          await yieldToMain();

          if (currentRenderId !== renderIdRef.current) {
            return { ok: false, cancelled: true };
          }

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

          if (currentRenderId !== renderIdRef.current) {
            return { ok: false, cancelled: true };
          }

          stagingEl = document.createElement("div");
          stagingEl.setAttribute("data-paged-staging", String(currentRenderId));
          measureHost.appendChild(stagingEl);

          const nextPreviewer = new Previewer();
          registerNamedPageMetricsHooks(
            nextPreviewer as unknown as DestroyablePreviewer
          );
          previewer = nextPreviewer;
          inFlightPreviewerRef.current = nextPreviewer;

          const flow = await nextPreviewer.preview(
            compiled.html,
            [{ "paged-media.css": cssText }],
            stagingEl
          );

          if (inFlightPreviewerRef.current === nextPreviewer) {
            inFlightPreviewerRef.current = null;
          }

          if (currentRenderId !== renderIdRef.current) {
            discardStaging();
            return { ok: false, cancelled: true };
          }

          await yieldToMain();
          if (currentRenderId !== renderIdRef.current) {
            discardStaging();
            return { ok: false, cancelled: true };
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
          committedSnapshotRef.current = snapshot;

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
          return { ok: true };
        } catch (err) {
          if (!committed) {
            discardStaging();
          }
          if (currentRenderId !== renderIdRef.current) {
            return { ok: false, cancelled: true };
          }
          console.error("Paged.js rendering error:", err);
          const message =
            err instanceof Error
              ? err.message
              : "組版レンダリング中にエラーが発生しました。";
          setRenderError(message);
          return { ok: false, error: message };
        } finally {
          if (!committed) {
            discardStaging();
          }
          if (inFlightRenderRef.current?.renderId === currentRenderId) {
            inFlightRenderRef.current = null;
          }
          if (currentRenderId === renderIdRef.current) {
            setIsRendering(false);
          }
        }
      };

      const promise = run();
      inFlightRenderRef.current = {
        renderId: currentRenderId,
        snapshot,
        promise,
      };
      return promise;
    },
    [assets]
  );

  useImperativeHandle(
    ref,
    () => ({
      isUpToDate: () => {
        const host = previewHostRef.current;
        if (!host || !host.querySelector(".pagedjs_page")) {
          return false;
        }
        if (inFlightRenderRef.current || debounceTimerRef.current) {
          return false;
        }
        return isSameRenderSnapshot(
          committedSnapshotRef.current,
          currentSnapshotRef.current
        );
      },
      renderNow: () => {
        const current = currentSnapshotRef.current;
        const host = previewHostRef.current;
        if (
          host?.querySelector(".pagedjs_page") &&
          !inFlightRenderRef.current &&
          !debounceTimerRef.current &&
          isSameRenderSnapshot(committedSnapshotRef.current, current)
        ) {
          return Promise.resolve({ ok: true });
        }

        const inFlight = inFlightRenderRef.current;
        if (inFlight && isSameRenderSnapshot(inFlight.snapshot, current)) {
          return inFlight.promise;
        }

        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current);
          debounceTimerRef.current = null;
        }
        return renderDocument(current.markdown, current.documentId);
      },
    }),
    [renderDocument]
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
    if (
      assetRestoreNonce > 0 &&
      assetRestoreNonce !== lastRestoreNonceRef.current
    ) {
      lastRestoreNonceRef.current = assetRestoreNonce;
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      void renderDocument(markdown, documentId);
    }
  }, [assetRestoreNonce, documentId, markdown, renderDocument]);

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

  const clearPlaceholderHighlight = useCallback(() => {
    if (activeDropTargetRef.current) {
      activeDropTargetRef.current.classList.remove("is-drop-target");
      activeDropTargetRef.current = null;
    }
  }, []);

  const handlePreviewDragEnter = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (!isFileDragEvent(e.dataTransfer)) return;
      e.preventDefault();
      dragDepthRef.current += 1;
      setIsDraggingFiles(true);
    },
    []
  );

  const handlePreviewDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (!isFileDragEvent(e.dataTransfer)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";

      const itemCount =
        e.dataTransfer.items?.length || e.dataTransfer.files?.length || 0;
      const targetEl = e.target as HTMLElement | null;
      const placeholderEl =
        itemCount <= 1
          ? targetEl?.closest<HTMLElement>("[data-asset-key]") ?? null
          : null;

      if (activeDropTargetRef.current !== placeholderEl) {
        clearPlaceholderHighlight();
        if (placeholderEl) {
          placeholderEl.classList.add("is-drop-target");
          activeDropTargetRef.current = placeholderEl;
        }
      }
    },
    [clearPlaceholderHighlight]
  );

  const handlePreviewDragLeave = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (!isFileDragEvent(e.dataTransfer)) return;
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) {
        setIsDraggingFiles(false);
        clearPlaceholderHighlight();
      }
    },
    [clearPlaceholderHighlight]
  );

  const handlePreviewDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (!isFileDragEvent(e.dataTransfer)) return;
      e.preventDefault();
      dragDepthRef.current = 0;
      setIsDraggingFiles(false);
      clearPlaceholderHighlight();

      const files = extractDroppedFiles(e.dataTransfer);
      if (files.length === 0) return;

      const targetEl = e.target as HTMLElement | null;
      const placeholderEl = targetEl?.closest<HTMLElement>("[data-asset-key]");
      const targetAssetKey =
        placeholderEl?.getAttribute("data-asset-key")?.trim() || "";

      if (targetAssetKey && files.length === 1 && onDropFileOnPlaceholder) {
        void onDropFileOnPlaceholder(targetAssetKey, files[0]);
        return;
      }

      if (onDropFilesOnPreview) {
        void onDropFilesOnPreview(files);
      }
    },
    [
      clearPlaceholderHighlight,
      onDropFileOnPlaceholder,
      onDropFilesOnPreview,
    ]
  );

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

      {unresolvedAssets.length > 0 && (
        <div
          role="status"
          className="no-print flex items-center justify-between gap-2 border-b border-amber-500/40 bg-amber-950/75 px-3 py-1.5 text-[11px] text-amber-200"
        >
          <div className="flex min-w-0 items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
            <span className="truncate">
              未解決の画像が {unresolvedAssets.length} 件あります — 画像ファイルをプレビューへドロップで一括復元（各枠へ直接ドロップで個別置換）
            </span>
          </div>
        </div>
      )}

      {restoreNotice && (
        <div
          role="status"
          aria-live="polite"
          className="no-print flex items-center justify-between gap-2 border-b border-emerald-600/40 bg-emerald-950/75 px-3 py-1.5 text-[11px] text-emerald-200"
        >
          <div className="flex min-w-0 items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
            <span className="truncate">{restoreNotice}</span>
          </div>
          {onDismissRestoreNotice && (
            <button
              type="button"
              onClick={onDismissRestoreNotice}
              aria-label="復元通知を閉じる"
              className="rounded px-1.5 py-0.5 text-emerald-300 hover:bg-emerald-900/60 hover:text-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
            >
              ×
            </button>
          )}
        </div>
      )}

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
        onDragEnter={handlePreviewDragEnter}
        onDragOver={handlePreviewDragOver}
        onDragLeave={handlePreviewDragLeave}
        onDrop={handlePreviewDrop}
        className={`print-scroll-container relative min-h-0 flex-1 overflow-auto [scrollbar-gutter:stable] bg-zinc-800 ${
          isDraggingFiles ? "ring-2 ring-inset ring-sky-400/80" : ""
        }`}
      >
        {isDraggingFiles && (
          <div className="no-print pointer-events-none sticky top-3 z-20 flex justify-center px-4">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-sky-400/70 bg-slate-900/95 px-3.5 py-1.5 text-xs font-medium text-sky-200 shadow-lg">
              <Upload className="h-3.5 w-3.5 text-sky-400" />
              <span>
                {unresolvedAssets.length > 0
                  ? `ドロップして未解決画像（${unresolvedAssets.length}件）を復元`
                  : "ドロップされた画像を未解決プレースホルダと照合します"}
              </span>
            </div>
          </div>
        )}

        {restoreProgress && (
          <div className="no-print pointer-events-none sticky top-3 z-20 flex justify-end px-4">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/60 bg-slate-900/95 px-3 py-1 text-[11px] tabular-nums text-sky-200 shadow">
              <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none text-sky-400" />
              <span>
                画像を復元中... ({restoreProgress.processed} / {restoreProgress.total})
              </span>
            </div>
          </div>
        )}

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
