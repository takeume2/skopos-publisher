import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  act,
  waitFor,
} from "@testing-library/react";
import { DEFAULT_FRONTMATTER } from "@/types/document";
import {
  PagedPreviewPane,
  type PagedPreviewPaneHandle,
} from "@/components/PagedPreviewPane";

interface MockChunker {
  stop: ReturnType<typeof vi.fn>;
  listeners: Record<string, Array<(...args: unknown[]) => unknown>>;
  on: (event: string, fn: (...args: unknown[]) => unknown) => void;
  hooks: {
    beforePageLayout: {
      fns: Array<(...args: unknown[]) => unknown>;
      register: (fn: (...args: unknown[]) => unknown) => void;
    };
    onPageLayout: {
      fns: Array<(...args: unknown[]) => unknown>;
      register: (fn: (...args: unknown[]) => unknown) => void;
    };
    renderNode: {
      fns: Array<(...args: unknown[]) => unknown>;
      register: (fn: (...args: unknown[]) => unknown) => void;
    };
    onOverflow: {
      fns: Array<(...args: unknown[]) => unknown>;
      register: (fn: (...args: unknown[]) => unknown) => void;
    };
  };
}

interface DeferredPreview {
  content: string;
  renderTo: HTMLElement;
  chunker: MockChunker;
  polisher: {
    styleEl: HTMLStyleElement;
    destroy: ReturnType<typeof vi.fn>;
  };
  resolve: (pages: MockPageDef[]) => void;
  reject: (err: Error) => void;
}

interface MockPageDef {
  id: string;
  headingId?: string;
  headingText?: string;
  bodyText: string;
}

const previewQueue: DeferredPreview[] = [];

function makeRect(top: number, height: number, width = 800): DOMRect {
  return {
    x: 0,
    y: top,
    top,
    bottom: top + height,
    left: 0,
    right: width,
    width,
    height,
    toJSON: () => ({}),
  } as DOMRect;
}

function populatePagedDom(
  renderTo: HTMLElement,
  pages: MockPageDef[],
  getScrollTop: () => number
) {
  const wrapper = document.createElement("div");
  wrapper.className = "pagedjs_pages";

  pages.forEach((p, idx) => {
    const pageTop = idx * 1030;
    const pageEl = document.createElement("div");
    pageEl.className = "pagedjs_page";
    pageEl.id = p.id;
    pageEl.getBoundingClientRect = () =>
      makeRect(100 + pageTop - getScrollTop(), 1000);

    const contentEl = document.createElement("div");
    contentEl.className = "pagedjs_page_content";

    if (p.headingId && p.headingText) {
      const h2 = document.createElement("h2");
      h2.id = p.headingId;
      h2.textContent = p.headingText;
      h2.getBoundingClientRect = () =>
        makeRect(100 + pageTop + 60 - getScrollTop(), 40);
      contentEl.appendChild(h2);
    }

    const para = document.createElement("p");
    para.textContent = p.bodyText;
    para.getBoundingClientRect = () =>
      makeRect(100 + pageTop + 140 - getScrollTop(), 60);
    contentEl.appendChild(para);

    pageEl.appendChild(contentEl);
    wrapper.appendChild(pageEl);
  });

  renderTo.replaceChildren(wrapper);
}

let activeScrollContainer: HTMLElement | null = null;

vi.mock("pagedjs", () => {
  function makeMockHook() {
    const fns: Array<(...args: unknown[]) => unknown> = [];
    return {
      fns,
      register: (fn: (...args: unknown[]) => unknown) => {
        fns.push(fn);
      },
    };
  }

  class MockPreviewer {
    chunker: MockChunker;
    polisher: {
      styleEl: HTMLStyleElement;
      destroy: ReturnType<typeof vi.fn>;
    };

    constructor() {
      const styleEl = document.createElement("style");
      styleEl.setAttribute("data-pagedjs-inserted-styles", "true");
      const listeners: Record<string, Array<(...args: unknown[]) => unknown>> = {};
      this.chunker = {
        stop: vi.fn(),
        listeners,
        on: (event: string, fn: (...args: unknown[]) => unknown) => {
          if (!listeners[event]) listeners[event] = [];
          listeners[event].push(fn);
        },
        hooks: {
          beforePageLayout: makeMockHook(),
          onPageLayout: makeMockHook(),
          renderNode: makeMockHook(),
          onOverflow: makeMockHook(),
        },
      };
      this.polisher = {
        styleEl,
        destroy: vi.fn(() => {
          styleEl.remove();
        }),
      };
    }

    preview(
      content: string,
      _stylesheets?: unknown,
      renderTo?: HTMLElement
    ) {
      document.head.appendChild(this.polisher.styleEl);
      return new Promise<{ total: number; size: number; pages: unknown[] }>(
        (resolve, reject) => {
          previewQueue.push({
            content,
            renderTo: renderTo!,
            chunker: this.chunker,
            polisher: this.polisher,
            resolve: (pages: MockPageDef[]) => {
              populatePagedDom(
                renderTo!,
                pages,
                () => activeScrollContainer?.scrollTop ?? 0
              );
              resolve({
                total: pages.length,
                size: pages.length,
                pages: pages.map((p, idx) => ({
                  id: p.id,
                  element: renderTo!.querySelector(`#${p.id}`),
                  page: idx + 1,
                })),
              });
            },
            reject,
          });
        }
      );
    }
  }

  return { Previewer: MockPreviewer };
});

describe("PagedPreviewPane double buffering & scroll preservation", () => {
  beforeEach(() => {
    previewQueue.length = 0;
    activeScrollContainer = null;
    document
      .querySelectorAll("style[data-pagedjs-inserted-styles]")
      .forEach((el) => el.remove());
  });

  afterEach(() => {
    cleanup();
  });

  function renderPane(props?: Partial<React.ComponentProps<typeof PagedPreviewPane>>) {
    const result = render(
      <PagedPreviewPane
        documentId="doc-1"
        markdown="# タイトル\n\n本文"
        frontmatter={DEFAULT_FRONTMATTER}
        assets={{}}
        autoUpdate={false}
        onToggleAutoUpdate={vi.fn()}
        showMarginGuides={false}
        onToggleMarginGuides={vi.fn()}
        layoutMode="single"
        onLayoutModeChange={vi.fn()}
        {...props}
      />
    );
    const scrollContainer = result.container.querySelector(
      ".print-scroll-container"
    ) as HTMLElement;
    scrollContainer.getBoundingClientRect = () => makeRect(100, 600);
    activeScrollContainer = scrollContainer;
    return { ...result, scrollContainer };
  }

  it("keeps previous preview visible during re-render and restores scroll position on commit", async () => {
    const { container, scrollContainer } = renderPane();

    await waitFor(() => expect(previewQueue.length).toBe(1));

    // 初回レンダリング完了（2ページ）
    await act(async () => {
      previewQueue[0].resolve([
        { id: "page-1", headingId: "sec-1", headingText: "第1章", bodyText: "1ページ目本文" },
        { id: "page-2", headingId: "sec-2", headingText: "第2章", bodyText: "2ページ目本文" },
      ]);
    });

    await waitFor(() => {
      expect(container.querySelectorAll(".paged-preview-canvas .pagedjs_page")).toHaveLength(2);
    });

    // 2ページ目の見出し (#sec-2, absTop = 1090) が画面上端+40pxに見える位置へスクロール
    scrollContainer.scrollTop = 1050;
    fireEvent.scroll(scrollContainer);

    const pageInput = screen.getByLabelText("表示ページ番号") as HTMLInputElement;
    expect(pageInput.value).toBe("2");

    // 手動再描画を開始
    fireEvent.click(screen.getByRole("button", { name: "再描画" }));
    await waitFor(() => expect(previewQueue.length).toBe(2));

    // 二重バッファ検証: 2回目のレンダリング中でも1回目のプレビューDOMが消えていないこと
    const visiblePagesDuringRender = container.querySelectorAll(
      ".paged-preview-canvas .pagedjs_page"
    );
    expect(visiblePagesDuringRender).toHaveLength(2);
    expect(previewQueue[0].polisher.destroy).not.toHaveBeenCalled();

    // 2回目のレンダリング完了（前方に1ページ増えて #sec-2 が3ページ目に移動）
    await act(async () => {
      previewQueue[1].resolve([
        { id: "page-1", headingId: "sec-1", headingText: "第1章", bodyText: "1ページ目本文" },
        { id: "page-2", headingId: "sec-added", headingText: "追加章", bodyText: "追加された本文" },
        { id: "page-3", headingId: "sec-2", headingText: "第2章", bodyText: "2ページ目本文" },
      ]);
    });

    await waitFor(() => {
      expect(container.querySelectorAll(".paged-preview-canvas .pagedjs_page")).toHaveLength(3);
    });

    // 旧スタイルのみ破棄され、新スタイルは残っていること
    expect(previewQueue[0].polisher.destroy).toHaveBeenCalledTimes(1);
    expect(previewQueue[1].polisher.destroy).not.toHaveBeenCalled();
    expect(document.head.contains(previewQueue[1].polisher.styleEl)).toBe(true);

    // #sec-2 (3ページ目: absTop = 2060 + 60 = 2120) が元オフセット +40px で復元 → scrollTop = 2080
    expect(scrollContainer.scrollTop).toBe(2080);
    expect(pageInput.value).toBe("3");
  });

  it("resets scroll position to page 1 when switching to a different documentId", async () => {
    const { container, rerender, scrollContainer } = renderPane({
      documentId: "doc-1",
      autoUpdate: false,
    });

    await waitFor(() => expect(previewQueue.length).toBe(1));
    await act(async () => {
      previewQueue[0].resolve([
        { id: "page-1", headingId: "sec-1", headingText: "第1章", bodyText: "文書1の1ページ目" },
        { id: "page-2", headingId: "sec-2", headingText: "第2章", bodyText: "文書1の2ページ目" },
      ]);
    });

    await waitFor(() => {
      expect(container.querySelectorAll(".paged-preview-canvas .pagedjs_page")).toHaveLength(2);
    });

    scrollContainer.scrollTop = 1050;
    fireEvent.scroll(scrollContainer);
    const pageInput = screen.getByLabelText("表示ページ番号") as HTMLInputElement;
    expect(pageInput.value).toBe("2");

    // 別ドキュメントへ切替 + 手動再描画
    rerender(
      <PagedPreviewPane
        documentId="doc-2"
        markdown="# 別ドキュメント"
        frontmatter={DEFAULT_FRONTMATTER}
        assets={{}}
        autoUpdate={false}
        onToggleAutoUpdate={vi.fn()}
        showMarginGuides={false}
        onToggleMarginGuides={vi.fn()}
        layoutMode="single"
        onLayoutModeChange={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "再描画" }));
    await waitFor(() => expect(previewQueue.length).toBe(2));

    await act(async () => {
      previewQueue[1].resolve([
        { id: "page-1", headingId: "sec-other-1", headingText: "別文書1", bodyText: "別文書の1ページ目" },
        { id: "page-2", headingId: "sec-other-2", headingText: "別文書2", bodyText: "別文書の2ページ目" },
      ]);
    });

    await waitFor(() => {
      expect(container.querySelector(".paged-preview-canvas")?.textContent).toContain("別文書の1ページ目");
    });
    expect(pageInput.value).toBe("1");
    expect(scrollContainer.scrollTop).toBe(0);
  });

  it("discards superseded staging render without breaking currently visible preview", async () => {
    const { container, rerender } = renderPane({
      documentId: "doc-1",
      markdown: "# 初版",
      autoUpdate: true,
    });

    await waitFor(() => expect(previewQueue.length).toBe(1));
    await act(async () => {
      previewQueue[0].resolve([
        { id: "page-1", bodyText: "初版コンテンツ" },
      ]);
    });

    await waitFor(() => {
      expect(container.querySelector(".paged-preview-canvas")?.textContent).toContain("初版コンテンツ");
    });

    // 2回目を手動起動（未完了のまま）
    fireEvent.click(screen.getByRole("button", { name: "再描画" }));
    await waitFor(() => expect(previewQueue.length).toBe(2));

    // 2回目が終わる前に、markdown更新+デバウンス代わりに autoUpdate=false 切替→手動再描画で3回目を割り込ませる
    rerender(
      <PagedPreviewPane
        documentId="doc-1"
        markdown="# 第3版"
        frontmatter={DEFAULT_FRONTMATTER}
        assets={{}}
        autoUpdate={false}
        onToggleAutoUpdate={vi.fn()}
        showMarginGuides={false}
        onToggleMarginGuides={vi.fn()}
        layoutMode="single"
        onLayoutModeChange={vi.fn()}
      />
    );

    // 2回目がまだ進行中のタイミングで、キャンセル対象として2回目が先に解決する
    // ここでは 3回目を直接トリガーするため、isRendering 中でもデバウンス経由で割り込むケースを再現
    rerender(
      <PagedPreviewPane
        documentId="doc-1"
        markdown="# 第3版更新"
        frontmatter={DEFAULT_FRONTMATTER}
        assets={{}}
        autoUpdate={true}
        onToggleAutoUpdate={vi.fn()}
        showMarginGuides={false}
        onToggleMarginGuides={vi.fn()}
        layoutMode="single"
        onLayoutModeChange={vi.fn()}
      />
    );

    await waitFor(() => expect(previewQueue.length).toBe(3), { timeout: 2000 });

    // 古い2回目が後から解決しても破棄され、初版表示が壊れない
    await act(async () => {
      previewQueue[1].resolve([{ id: "page-1", bodyText: "古い2回目コンテンツ" }]);
    });

    expect(previewQueue[1].polisher.destroy).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".paged-preview-canvas")?.textContent).toContain("初版コンテンツ");

    // 最新の3回目が解決して差し替わる
    await act(async () => {
      previewQueue[2].resolve([{ id: "page-1", bodyText: "最新3回目コンテンツ" }]);
    });

    await waitFor(() => {
      expect(container.querySelector(".paged-preview-canvas")?.textContent).toContain("最新3回目コンテンツ");
    });
    expect(previewQueue[0].polisher.destroy).toHaveBeenCalledTimes(1);
    expect(previewQueue[2].polisher.destroy).not.toHaveBeenCalled();
  });

  it("exposes aria-pressed states on layout/margin toggles and role=alert on render errors", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    try {
      renderPane({
        layoutMode: "spread",
        showMarginGuides: true,
      });

      const singleBtn = screen.getByRole("button", { name: /単ページ/ });
      const spreadBtn = screen.getByRole("button", { name: /見開き/ });
      const marginBtn = screen.getByRole("button", { name: /余白ガイド/ });

      expect(singleBtn.getAttribute("aria-pressed")).toBe("false");
      expect(spreadBtn.getAttribute("aria-pressed")).toBe("true");
      expect(marginBtn.getAttribute("aria-pressed")).toBe("true");

      await waitFor(() => expect(previewQueue.length).toBe(1));
      await act(async () => {
        previewQueue[0].reject(new Error("テスト組版失敗"));
      });

      const alertEl = await screen.findByRole("alert");
      expect(alertEl.textContent).toContain("テスト組版失敗");
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it("uses container query classes instead of viewport xl breakpoints for preview toolbar labels (#54)", () => {
    const { container } = renderPane();

    const root = container.querySelector(".print-preview-pane");
    expect(root?.classList.contains("preview-pane-container")).toBe(true);

    const cqLabels = Array.from(container.querySelectorAll(".preview-cq-label")).map(
      (el) => el.textContent?.trim()
    );
    expect(cqLabels).toEqual(["幅に合わせる", "全体表示", "余白ガイド"]);
  });

  it("marks off-screen measure host as inert and applies tabular-nums to numeric indicators (#56)", () => {
    const { container } = renderPane();

    const measureHost = container.querySelector('div[aria-hidden="true"]');
    expect(measureHost).toBeTruthy();
    expect(measureHost?.hasAttribute("inert")).toBe(true);

    const zoomResetBtn = screen.getByTitle("100% にリセット");
    expect(zoomResetBtn.classList.contains("tabular-nums")).toBe(true);

    const pageInput = screen.getByLabelText("表示ページ番号");
    expect(pageInput.classList.contains("tabular-nums")).toBe(true);

    const totalPagesSpan = screen.getByText(/\/ \d+ ページ/);
    expect(totalPagesSpan.classList.contains("tabular-nums")).toBe(true);
  });

  it("routes single-file placeholder drop to onDropFileOnPlaceholder and bulk/document drop to onDropFilesOnPreview (#25)", async () => {
    const onDropFileOnPlaceholder = vi.fn();
    const onDropFilesOnPreview = vi.fn();

    const { container, scrollContainer } = renderPane({
      unresolvedAssets: [
        {
          assetKey: "asset:diagram.png",
          rawName: "diagram.png",
          displayName: "diagram.png",
          alt: "図1",
          occurrences: 1,
          source: "body",
        },
      ],
      onDropFileOnPlaceholder,
      onDropFilesOnPreview,
    });

    expect(screen.getByText(/未解決の画像が 1 件あります/)).toBeTruthy();

    await waitFor(() => expect(previewQueue.length).toBe(1));
    await act(async () => {
      previewQueue[0].resolve([{ id: "page-1", bodyText: "本文" }]);
    });

    await waitFor(() => {
      expect(
        container.querySelectorAll(".paged-preview-canvas .pagedjs_page")
      ).toHaveLength(1);
    });

    // プレビュー内にプレースホルダ要素を配置してイベント委譲を検証
    const pageContent = container.querySelector(
      ".paged-preview-canvas .pagedjs_page_content"
    )!;
    const placeholder = document.createElement("span");
    placeholder.className = "doc-asset-placeholder";
    placeholder.setAttribute("data-asset-key", "asset:diagram.png");
    pageContent.appendChild(placeholder);

    // 1件の画像をプレースホルダへ直接ドロップ → ファイル名不問で onDropFileOnPlaceholder
    const renamedFile = new File(["png"], "another-name.png", {
      type: "image/png",
    });
    fireEvent.drop(placeholder, {
      dataTransfer: { files: [renamedFile], types: ["Files"] },
    });
    expect(onDropFileOnPlaceholder).toHaveBeenCalledTimes(1);
    expect(onDropFileOnPlaceholder).toHaveBeenCalledWith(
      "asset:diagram.png",
      renamedFile
    );
    expect(onDropFilesOnPreview).not.toHaveBeenCalled();

    // 複数ファイルをプレースホルダ上へドロップ → 文書全体の一括照合へフォールバック
    const fileA = new File(["png"], "diagram.png", { type: "image/png" });
    const fileB = new File(["png"], "other.png", { type: "image/png" });
    fireEvent.drop(placeholder, {
      dataTransfer: { files: [fileA, fileB], types: ["Files"] },
    });
    expect(onDropFilesOnPreview).toHaveBeenCalledTimes(1);
    expect(onDropFilesOnPreview).toHaveBeenCalledWith([fileA, fileB]);

    // プレースホルダ外（文書全体）への1件ドロップ → onDropFilesOnPreview
    onDropFilesOnPreview.mockClear();
    fireEvent.drop(scrollContainer, {
      dataTransfer: { files: [fileA], types: ["Files"] },
    });
    expect(onDropFilesOnPreview).toHaveBeenCalledTimes(1);
    expect(onDropFilesOnPreview).toHaveBeenCalledWith([fileA]);
  });

  it("syncs named-page columnWidth before page.layout and suppresses overflow splits on single-page cover/chapter/backcover pages (#25)", async () => {
    renderPane();
    await waitFor(() => expect(previewQueue.length).toBe(1));

    const { chunker } = previewQueue[0];
    expect(chunker.hooks.beforePageLayout.fns.length).toBeGreaterThan(0);
    expect(chunker.listeners.page?.length).toBeGreaterThan(0);
    expect(chunker.hooks.onOverflow.fns.length).toBeGreaterThan(0);

    // 1. 1ページ目で <article><section data-page="cover"> の名前付きページクラスが事前に付与されること
    const fragment = document.createDocumentFragment();
    const article = document.createElement("article");
    const cover = document.createElement("section");
    cover.setAttribute("data-page", "cover");
    article.appendChild(cover);
    fragment.appendChild(article);

    const coverPageEl = document.createElement("div");
    coverPageEl.className = "pagedjs_page";
    const coverPagebox = document.createElement("div");
    coverPagebox.className = "pagedjs_pagebox";
    const coverArea = document.createElement("div");
    coverArea.className = "pagedjs_page_content";
    coverArea.style.columnWidth = "658px";
    coverArea.getBoundingClientRect = () => makeRect(0, 1122.5, 793.7);
    coverPagebox.appendChild(coverArea);
    coverPageEl.appendChild(coverPagebox);

    const mockCoverPage = {
      name: undefined as string | undefined,
      width: 658,
      height: 956,
      element: coverPageEl,
      pagebox: coverPagebox,
      area: coverArea,
    };

    chunker.hooks.beforePageLayout.fns.forEach((fn) =>
      fn(mockCoverPage, fragment, false)
    );
    expect(mockCoverPage.name).toBe("cover");
    expect(coverPageEl.classList.contains("pagedjs_named_page")).toBe(true);
    expect(coverPageEl.classList.contains("pagedjs_cover_page")).toBe(true);

    // 2. "page" イベントで page.layout() 前に columnWidth / width / height が全幅・全高に同期されること
    chunker.listeners.page.forEach((fn) => fn(mockCoverPage));
    expect(coverArea.style.columnWidth).toBe("794px");
    expect(mockCoverPage.width).toBe(794);
    expect(mockCoverPage.height).toBe(1123);

    // 3. onOverflow は単一ページ用の cover / chapter / backcover のみ null で分割抑止し、本文・目次は通常どおり通過させること
    const fakeOverflow = {} as Range;
    const checkOverflow = (pageClasses: string) => {
      const pEl = document.createElement("div");
      pEl.className = pageClasses;
      const aEl = document.createElement("div");
      aEl.className = "pagedjs_page_content";
      pEl.appendChild(aEl);
      const results = chunker.hooks.onOverflow.fns.map((fn) =>
        fn(fakeOverflow, document.createElement("div"), makeRect(0, 956, 658), {
          element: aEl,
        })
      );
      return results.find((r) => typeof r !== "undefined");
    };

    expect(
      checkOverflow("pagedjs_page pagedjs_named_page pagedjs_backcover_page")
    ).toBeNull();
    expect(
      checkOverflow("pagedjs_page pagedjs_named_page pagedjs_cover_page")
    ).toBeNull();
    expect(
      checkOverflow("pagedjs_page pagedjs_named_page pagedjs_chapter_page")
    ).toBeNull();
    expect(
      checkOverflow("pagedjs_page pagedjs_named_page pagedjs_toc_page")
    ).toBeUndefined();
    expect(checkOverflow("pagedjs_page")).toBeUndefined();
  });

  it("exposes isUpToDate and renderNow via ref to join in-flight renders and flush stale updates before printing (#61)", async () => {
    const handleRef = React.createRef<PagedPreviewPaneHandle>();
    const { container, rerender } = renderPane({
      ref: handleRef,
      documentId: "doc-1",
      markdown: "# 初版",
      autoUpdate: false,
    });

    await waitFor(() => expect(previewQueue.length).toBe(1));

    // 初回描画中は isUpToDate() === false、renderNow() は重複描画を起こさず進行中Promiseに合流する
    expect(handleRef.current?.isUpToDate()).toBe(false);
    const joinedPromise = handleRef.current!.renderNow();
    expect(previewQueue.length).toBe(1);

    await act(async () => {
      previewQueue[0].resolve([{ id: "page-1", bodyText: "初版本文" }]);
    });

    await expect(joinedPromise).resolves.toEqual({ ok: true });
    expect(handleRef.current?.isUpToDate()).toBe(true);

    // 最新状態での renderNow() は新規レンダリングを起こさず即時成功する
    await expect(handleRef.current!.renderNow()).resolves.toEqual({ ok: true });
    expect(previewQueue.length).toBe(1);

    // autoUpdate=false のまま本文変更 → isUpToDate() === false になり、renderNow() で即時描画される
    rerender(
      <PagedPreviewPane
        ref={handleRef}
        documentId="doc-1"
        markdown="# 更新後の本文"
        frontmatter={DEFAULT_FRONTMATTER}
        assets={{}}
        autoUpdate={false}
        onToggleAutoUpdate={vi.fn()}
        showMarginGuides={false}
        onToggleMarginGuides={vi.fn()}
        layoutMode="single"
        onLayoutModeChange={vi.fn()}
      />
    );

    expect(handleRef.current?.isUpToDate()).toBe(false);
    const flushPromise = handleRef.current!.renderNow();
    await waitFor(() => expect(previewQueue.length).toBe(2));

    await act(async () => {
      previewQueue[1].resolve([{ id: "page-1", bodyText: "更新後の本文" }]);
    });

    await expect(flushPromise).resolves.toEqual({ ok: true });
    expect(handleRef.current?.isUpToDate()).toBe(true);
    expect(container.querySelector(".paged-preview-canvas")?.textContent).toContain(
      "更新後の本文"
    );
  });

  it("suspends background renders while popped out, still allows explicit renderNow(), and flushes stale edits on resume (#64)", async () => {
    const handleRef = React.createRef<PagedPreviewPaneHandle>();
    const { container, rerender } = renderPane({
      ref: handleRef,
      documentId: "doc-1",
      markdown: "# 初期",
      autoUpdate: true,
      suspendAutoRender: true,
      headerRightExtra: <button type="button">別ウィンドウ</button>,
    });

    // headerRightExtra スロットが表示され、suspendAutoRender 中は自動描画が走らないこと
    expect(screen.getByRole("button", { name: "別ウィンドウ" })).toBeTruthy();
    expect(previewQueue.length).toBe(0);

    // 明示的な renderNow()（親ウィンドウからの印刷時）は suspend 中でも実行できること
    const printRenderPromise = handleRef.current!.renderNow();
    await waitFor(() => expect(previewQueue.length).toBe(1));
    await act(async () => {
      previewQueue[0].resolve([{ id: "page-1", bodyText: "初期印刷用" }]);
    });
    await expect(printRenderPromise).resolves.toEqual({ ok: true });

    // suspend 中に本文変更しても自動描画は走らない
    rerender(
      <PagedPreviewPane
        ref={handleRef}
        documentId="doc-1"
        markdown="# 別ウィンドウ編集中に更新"
        frontmatter={DEFAULT_FRONTMATTER}
        assets={{}}
        autoUpdate={true}
        onToggleAutoUpdate={vi.fn()}
        showMarginGuides={false}
        onToggleMarginGuides={vi.fn()}
        layoutMode="single"
        onLayoutModeChange={vi.fn()}
        suspendAutoRender={true}
      />
    );
    expect(previewQueue.length).toBe(1);

    // suspend 解除（メイン画面へ復帰）すると最新本文が即時再描画されること
    rerender(
      <PagedPreviewPane
        ref={handleRef}
        documentId="doc-1"
        markdown="# 別ウィンドウ編集中に更新"
        frontmatter={DEFAULT_FRONTMATTER}
        assets={{}}
        autoUpdate={false}
        onToggleAutoUpdate={vi.fn()}
        showMarginGuides={false}
        onToggleMarginGuides={vi.fn()}
        layoutMode="single"
        onLayoutModeChange={vi.fn()}
        suspendAutoRender={false}
      />
    );
    await waitFor(() => expect(previewQueue.length).toBe(2));
    await act(async () => {
      previewQueue[1].resolve([
        { id: "page-1", bodyText: "別ウィンドウ編集中に更新" },
      ]);
    });
    await waitFor(() => {
      expect(container.querySelector(".paged-preview-canvas")?.textContent).toContain(
        "別ウィンドウ編集中に更新"
      );
    });
  });
});
