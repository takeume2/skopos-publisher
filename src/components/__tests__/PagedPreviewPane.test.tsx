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
import { PagedPreviewPane } from "@/components/PagedPreviewPane";

interface DeferredPreview {
  content: string;
  renderTo: HTMLElement;
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
  class MockPreviewer {
    polisher: {
      styleEl: HTMLStyleElement;
      destroy: ReturnType<typeof vi.fn>;
    };

    constructor() {
      const styleEl = document.createElement("style");
      styleEl.setAttribute("data-pagedjs-inserted-styles", "true");
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
});
