import { describe, it, expect } from "vitest";
import {
  capturePreviewScrollSnapshot,
  detectCurrentPage,
  restorePreviewScrollSnapshot,
} from "@/lib/preview-scroll";

interface PageSpec {
  id: string;
  top: number;
  height: number;
  elements: Array<{
    tag: string;
    id?: string;
    className?: string;
    text: string;
    offsetInPage: number;
    height: number;
    inMargin?: boolean;
  }>;
}

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

function createMockPagedPreview(
  pages: PageSpec[],
  viewportHeight = 600,
  containerTop = 100
) {
  const scrollContainer = document.createElement("div");
  const previewHost = document.createElement("div");
  scrollContainer.appendChild(previewHost);

  scrollContainer.scrollTop = 0;
  scrollContainer.scrollLeft = 0;
  scrollContainer.getBoundingClientRect = () =>
    makeRect(containerTop, viewportHeight);

  const renderPages = (nextPages: PageSpec[]) => {
    const pagesWrapper = document.createElement("div");
    pagesWrapper.className = "pagedjs_pages";

    for (const pageSpec of nextPages) {
      const pageEl = document.createElement("div");
      pageEl.className = "pagedjs_page";
      pageEl.id = pageSpec.id;
      pageEl.getBoundingClientRect = () =>
        makeRect(
          containerTop + pageSpec.top - scrollContainer.scrollTop,
          pageSpec.height
        );

      const marginEl = document.createElement("div");
      marginEl.className = "pagedjs_margin pagedjs_margin-top";
      pageEl.appendChild(marginEl);

      const contentEl = document.createElement("div");
      contentEl.className = "pagedjs_page_content";
      pageEl.appendChild(contentEl);

      for (const spec of pageSpec.elements) {
        const el = document.createElement(spec.tag);
        if (spec.id) el.id = spec.id;
        if (spec.className) el.className = spec.className;
        el.textContent = spec.text;
        const absTop = pageSpec.top + spec.offsetInPage;
        el.getBoundingClientRect = () =>
          makeRect(containerTop + absTop - scrollContainer.scrollTop, spec.height);

        if (spec.inMargin) {
          marginEl.appendChild(el);
        } else {
          contentEl.appendChild(el);
        }
      }

      pagesWrapper.appendChild(pageEl);
    }

    previewHost.replaceChildren(pagesWrapper);
  };

  renderPages(pages);

  return { scrollContainer, previewHost, renderPages };
}

describe("preview-scroll", () => {
  it("restores scroll position to the moved heading anchor when earlier pages expand", () => {
    const initialPages: PageSpec[] = [
      {
        id: "page-1",
        top: 0,
        height: 1000,
        elements: [
          { tag: "h1", id: "sec-intro", text: "はじめに", offsetInPage: 50, height: 40 },
          { tag: "p", text: "導入段落のテキストです。", offsetInPage: 120, height: 60 },
        ],
      },
      {
        id: "page-2",
        top: 1030,
        height: 1000,
        elements: [
          { tag: "h2", id: "sec-security", text: "セキュリティ対策", offsetInPage: 60, height: 40 },
          { tag: "p", text: "認証と認可の詳細設計を記述します。", offsetInPage: 130, height: 60 },
        ],
      },
    ];

    const { scrollContainer, previewHost, renderPages } =
      createMockPagedPreview(initialPages);

    // 2ページ目の見出し (#sec-security, absTop = 1090) が画面上端から 40px の位置に見える状態
    scrollContainer.scrollTop = 1050;
    scrollContainer.scrollLeft = 18;
    expect(detectCurrentPage(scrollContainer, previewHost)).toBe(2);

    const snapshot = capturePreviewScrollSnapshot(scrollContainer, previewHost);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.anchors[0]).toMatchObject({
      kind: "id",
      id: "sec-security",
      offsetFromContainerTop: 40,
    });

    // 前方に1ページ分追加され、#sec-security が3ページ目 (absTop = 2060 + 80 = 2140) に移動
    const updatedPages: PageSpec[] = [
      initialPages[0],
      {
        id: "page-2",
        top: 1030,
        height: 1000,
        elements: [
          { tag: "h2", id: "sec-new", text: "新しく追加した章", offsetInPage: 60, height: 40 },
        ],
      },
      {
        id: "page-3",
        top: 2060,
        height: 1000,
        elements: [
          { tag: "h2", id: "sec-security", text: "セキュリティ対策", offsetInPage: 80, height: 40 },
          { tag: "p", text: "認証と認可の詳細設計を記述します。", offsetInPage: 150, height: 60 },
        ],
      },
    ];
    renderPages(updatedPages);

    // DOM差し替えで scrollTop が 0 にリセットされた状況をシミュレート
    scrollContainer.scrollTop = 0;

    const restoredPage = restorePreviewScrollSnapshot(
      scrollContainer,
      previewHost,
      snapshot!
    );

    // #sec-security (absTop=2140) が画面上端から 40px になる scrollTop = 2100 へ復元
    expect(scrollContainer.scrollTop).toBe(2100);
    expect(scrollContainer.scrollLeft).toBe(18);
    expect(restoredPage).toBe(3);
  });

  it("restores via surrounding content paragraph even if the edited paragraph changed", () => {
    const initialPages: PageSpec[] = [
      {
        id: "page-1",
        top: 0,
        height: 1000,
        elements: [
          { tag: "p", text: "1ページ目のテキストです。", offsetInPage: 100, height: 50 },
        ],
      },
      {
        id: "page-2",
        top: 1030,
        height: 1000,
        elements: [
          { tag: "p", text: "これから編集する対象の段落テキストです。", offsetInPage: 200, height: 60 },
          { tag: "p", text: "直後にある変更されない参照用の段落テキストです。", offsetInPage: 300, height: 60 },
        ],
      },
    ];

    const { scrollContainer, previewHost, renderPages } =
      createMockPagedPreview(initialPages);

    scrollContainer.scrollTop = 1200; // 1つ目の段落が上端から30px、2つ目が130px
    const snapshot = capturePreviewScrollSnapshot(scrollContainer, previewHost);
    expect(snapshot).not.toBeNull();

    // 1つ目の段落を書き換え、かつ全体が120px下にずれた
    renderPages([
      initialPages[0],
      {
        id: "page-2",
        top: 1030,
        height: 1000,
        elements: [
          { tag: "p", text: "完全に書き換えた新しい段落テキストになりました。", offsetInPage: 320, height: 60 },
          { tag: "p", text: "直後にある変更されない参照用の段落テキストです。", offsetInPage: 420, height: 60 },
        ],
      },
    ]);
    scrollContainer.scrollTop = 0;

    const restoredPage = restorePreviewScrollSnapshot(
      scrollContainer,
      previewHost,
      snapshot!
    );

    // 2つ目の段落 (absTop=1450) の元オフセット 130px を維持 → scrollTop = 1320
    expect(scrollContainer.scrollTop).toBe(1320);
    expect(restoredPage).toBe(2);
  });

  it("distinguishes duplicate paragraph text by occurrenceIndex", () => {
    const pages: PageSpec[] = [
      {
        id: "page-1",
        top: 0,
        height: 1000,
        elements: [
          { tag: "p", text: "共通の注意書きテキストです。", offsetInPage: 100, height: 50 },
        ],
      },
      {
        id: "page-2",
        top: 1030,
        height: 1000,
        elements: [
          { tag: "p", text: "共通の注意書きテキストです。", offsetInPage: 200, height: 50 },
        ],
      },
    ];

    const { scrollContainer, previewHost, renderPages } =
      createMockPagedPreview(pages);

    scrollContainer.scrollTop = 1180; // 2ページ目の「共通の注意書き」が上端+50px
    const snapshot = capturePreviewScrollSnapshot(scrollContainer, previewHost);
    expect(snapshot).not.toBeNull();

    renderPages(pages);
    scrollContainer.scrollTop = 0;

    const restoredPage = restorePreviewScrollSnapshot(
      scrollContainer,
      previewHost,
      snapshot!
    );

    expect(scrollContainer.scrollTop).toBe(1180);
    expect(restoredPage).toBe(2);
  });

  it("falls back to preceding heading anchor when all visible paragraphs change", () => {
    const initialPages: PageSpec[] = [
      {
        id: "page-1",
        top: 0,
        height: 1000,
        elements: [
          { tag: "h2", id: "sec-chapter-1", text: "第1章 概要", offsetInPage: 100, height: 40 },
          { tag: "p", text: "編集前の本文段落テキストです。", offsetInPage: 700, height: 60 },
        ],
      },
    ];

    const { scrollContainer, previewHost, renderPages } =
      createMockPagedPreview(initialPages, 400);

    // 見出し (absTop=100) は画面上端より上 (-550px)、段落 (absTop=700) は画面内 (+50px)
    scrollContainer.scrollTop = 650;
    const snapshot = capturePreviewScrollSnapshot(scrollContainer, previewHost);
    expect(snapshot).not.toBeNull();

    // 段落は書き換わり、見出しは absTop=300 に移動
    renderPages([
      {
        id: "page-1",
        top: 0,
        height: 1200,
        elements: [
          { tag: "h2", id: "sec-chapter-1", text: "第1章 概要", offsetInPage: 300, height: 40 },
          { tag: "p", text: "まったく異なる内容に全面変更された段落です。", offsetInPage: 900, height: 60 },
        ],
      },
    ]);
    scrollContainer.scrollTop = 0;

    restorePreviewScrollSnapshot(scrollContainer, previewHost, snapshot!);

    // 新しい見出し位置 (300) - 元オフセット (-550) = 850
    expect(scrollContainer.scrollTop).toBe(850);
  });

  it("falls back to clamped page index and pageOffsetRatio when no anchor matches", () => {
    const initialPages: PageSpec[] = [
      {
        id: "page-1",
        top: 0,
        height: 1000,
        elements: [{ tag: "p", text: "旧ページ1のテキスト", offsetInPage: 100, height: 50 }],
      },
      {
        id: "page-2",
        top: 1030,
        height: 1000,
        elements: [{ tag: "p", text: "旧ページ2のテキスト", offsetInPage: 100, height: 50 }],
      },
      {
        id: "page-3",
        top: 2060,
        height: 1000,
        elements: [{ tag: "p", text: "旧ページ3のテキスト", offsetInPage: 100, height: 50 }],
      },
    ];

    const { scrollContainer, previewHost, renderPages } =
      createMockPagedPreview(initialPages);

    // 3ページ目の 25% 位置 (2060 + 250 = 2310)
    scrollContainer.scrollTop = 2310;
    const snapshot = capturePreviewScrollSnapshot(scrollContainer, previewHost);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.pageIndex).toBe(2);
    expect(snapshot!.pageOffsetRatio).toBeCloseTo(0.25, 5);

    // 2ページに減少し、内容も完全に別物になった
    renderPages([
      {
        id: "page-1",
        top: 0,
        height: 1000,
        elements: [{ tag: "p", text: "新ページ1の別コンテンツ", offsetInPage: 100, height: 50 }],
      },
      {
        id: "page-2",
        top: 1030,
        height: 1000,
        elements: [{ tag: "p", text: "新ページ2の別コンテンツ", offsetInPage: 100, height: 50 }],
      },
    ]);
    scrollContainer.scrollTop = 0;

    const restoredPage = restorePreviewScrollSnapshot(
      scrollContainer,
      previewHost,
      snapshot!
    );

    // ページ2 (top=1030) の 25% 位置 = 1280 にクランプ復元
    expect(restoredPage).toBe(2);
    expect(scrollContainer.scrollTop).toBe(1280);
  });

  it("keeps top position when scrollTop was at the very top", () => {
    const initialPages: PageSpec[] = [
      {
        id: "page-1",
        top: 0,
        height: 1000,
        elements: [{ tag: "h1", id: "sec-title", text: "タイトル", offsetInPage: 50, height: 40 }],
      },
    ];

    const { scrollContainer, previewHost, renderPages } =
      createMockPagedPreview(initialPages);

    scrollContainer.scrollTop = 0;
    const snapshot = capturePreviewScrollSnapshot(scrollContainer, previewHost);

    // 表紙が先頭に追加されて #sec-title が2ページ目になっても、先頭表示を維持する
    renderPages([
      {
        id: "page-1",
        top: 0,
        height: 1000,
        elements: [{ tag: "section", className: "doc-cover", text: "表紙", offsetInPage: 0, height: 1000 }],
      },
      {
        id: "page-2",
        top: 1030,
        height: 1000,
        elements: [{ tag: "h1", id: "sec-title", text: "タイトル", offsetInPage: 50, height: 40 }],
      },
    ]);

    const restoredPage = restorePreviewScrollSnapshot(
      scrollContainer,
      previewHost,
      snapshot!
    );

    expect(scrollContainer.scrollTop).toBe(0);
    expect(restoredPage).toBe(1);
  });

  it("ignores elements inside pagedjs_margin header/footer boxes", () => {
    const pages: PageSpec[] = [
      {
        id: "page-1",
        top: 0,
        height: 1000,
        elements: [
          {
            tag: "p",
            id: "sec-margin-fake",
            text: "ヘッダー固定テキスト",
            offsetInPage: 10,
            height: 20,
            inMargin: true,
          },
          {
            tag: "p",
            text: "本文の実際の段落テキスト",
            offsetInPage: 120,
            height: 50,
          },
        ],
      },
    ];

    const { scrollContainer, previewHost } = createMockPagedPreview(pages);
    scrollContainer.scrollTop = 20;

    const snapshot = capturePreviewScrollSnapshot(scrollContainer, previewHost);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.anchors.some((a) => a.id === "sec-margin-fake")).toBe(
      false
    );
    expect(snapshot!.anchors[0]).toMatchObject({
      kind: "content",
      textSignature: "本文の実際の段落テキスト",
    });
  });
});
