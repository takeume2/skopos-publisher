import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { DocumentSidebar } from "@/components/DocumentSidebar";
import type {
  DocumentSummary,
  SharedAssetSummary,
} from "@/hooks/useIndexedDbStorage";
import type { OutlineHeading } from "@/lib/outline";

afterEach(() => {
  cleanup();
});

const DOC_1: DocumentSummary = {
  id: "doc_1",
  title: "セキュリティ報告書",
  updatedAt: new Date("2026-11-18T10:00:00Z").getTime(),
  markdownBytes: 2048,
  assetsBytes: 4096,
  totalBytes: 6144,
  assetCount: 1,
};

const DOC_2: DocumentSummary = {
  id: "doc_2",
  title: "技術仕様書",
  updatedAt: new Date("2026-11-17T10:00:00Z").getTime(),
  markdownBytes: 1024,
  assetsBytes: 0,
  totalBytes: 1024,
  assetCount: 0,
};

const SHARED_1: SharedAssetSummary = {
  assetId: "asset:shared_logo_1",
  label: "company-logo.png",
  dataUrl: "data:image/png;base64,LOGO",
  bytes: 512,
};

describe("DocumentSidebar", () => {
  it("disables single delete button when only 1 document exists", () => {
    const onRequestDeleteDocument = vi.fn();
    render(
      <DocumentSidebar
        isOpen={true}
        activeDocId="doc_1"
        activeFrontmatterAssets={{
          logo: "",
          cover_image: "",
          back_cover_image: "",
        }}
        documents={[DOC_1]}
        sharedAssets={[]}
        onSelectDocument={vi.fn()}
        onCreateDocument={vi.fn()}
        onExportDocument={vi.fn()}
        onRequestDeleteDocument={onRequestDeleteDocument}
        onRequestDeleteAllDocuments={vi.fn()}
        onAddSharedAsset={vi.fn()}
        onApplySharedAsset={vi.fn()}
        onRequestDeleteSharedAsset={vi.fn()}
        onRequestDeleteAllSharedAssets={vi.fn()}
      />
    );

    const deleteBtn = screen.getByLabelText("セキュリティ報告書 を削除");
    expect((deleteBtn as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(deleteBtn);
    expect(onRequestDeleteDocument).not.toHaveBeenCalled();
  });

  it("enables delete and triggers select/export callbacks when multiple documents exist", () => {
    const onSelectDocument = vi.fn();
    const onExportDocument = vi.fn();
    const onRequestDeleteDocument = vi.fn();

    render(
      <DocumentSidebar
        isOpen={true}
        activeDocId="doc_1"
        activeFrontmatterAssets={{
          logo: "",
          cover_image: "",
          back_cover_image: "",
        }}
        documents={[DOC_1, DOC_2]}
        sharedAssets={[]}
        onSelectDocument={onSelectDocument}
        onCreateDocument={vi.fn()}
        onExportDocument={onExportDocument}
        onRequestDeleteDocument={onRequestDeleteDocument}
        onRequestDeleteAllDocuments={vi.fn()}
        onAddSharedAsset={vi.fn()}
        onApplySharedAsset={vi.fn()}
        onRequestDeleteSharedAsset={vi.fn()}
        onRequestDeleteAllSharedAssets={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText("技術仕様書"));
    expect(onSelectDocument).toHaveBeenCalledWith("doc_2");

    fireEvent.click(screen.getByLabelText("技術仕様書 を .md として保存"));
    expect(onExportDocument).toHaveBeenCalledWith("doc_2");

    const deleteBtn = screen.getByLabelText("技術仕様書 を削除");
    expect((deleteBtn as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(deleteBtn);
    expect(onRequestDeleteDocument).toHaveBeenCalledWith(DOC_2);
  });

  it("switches to shared assets tab and applies shared asset to logo/cover/backcover", () => {
    const onApplySharedAsset = vi.fn();

    render(
      <DocumentSidebar
        isOpen={true}
        activeDocId="doc_1"
        activeFrontmatterAssets={{
          logo: "asset:shared_logo_1",
          cover_image: "",
          back_cover_image: "",
        }}
        documents={[DOC_1]}
        sharedAssets={[SHARED_1]}
        onSelectDocument={vi.fn()}
        onCreateDocument={vi.fn()}
        onExportDocument={vi.fn()}
        onRequestDeleteDocument={vi.fn()}
        onRequestDeleteAllDocuments={vi.fn()}
        onAddSharedAsset={vi.fn()}
        onApplySharedAsset={onApplySharedAsset}
        onRequestDeleteSharedAsset={vi.fn()}
        onRequestDeleteAllSharedAssets={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("tab", { name: /共通画像/ }));
    expect(screen.getByText("company-logo.png")).toBeTruthy();

    fireEvent.click(screen.getByText("表紙"));
    expect(onApplySharedAsset).toHaveBeenCalledWith(
      "cover_image",
      "asset:shared_logo_1"
    );
  });

  it("switches between documents and outline tabs within the same sidebar and invokes onSelectHeading", () => {
    const onSelectHeading = vi.fn();
    const headings: OutlineHeading[] = [
      { id: "heading-1-0", level: 1, text: "第1章 概要", line: 1 },
      { id: "heading-5-1", level: 2, text: "1.1 目的", line: 5 },
      { id: "heading-10-2", level: 3, text: "1.1.1 補足", line: 10 },
    ];

    render(
      <DocumentSidebar
        isOpen={true}
        activeDocId="doc_1"
        activeFrontmatterAssets={{
          logo: "",
          cover_image: "",
          back_cover_image: "",
        }}
        documents={[DOC_1]}
        sharedAssets={[]}
        headings={headings}
        activeHeadingId="heading-5-1"
        onSelectHeading={onSelectHeading}
        onSelectDocument={vi.fn()}
        onCreateDocument={vi.fn()}
        onExportDocument={vi.fn()}
        onRequestDeleteDocument={vi.fn()}
        onRequestDeleteAllDocuments={vi.fn()}
        onAddSharedAsset={vi.fn()}
        onApplySharedAsset={vi.fn()}
        onRequestDeleteSharedAsset={vi.fn()}
        onRequestDeleteAllSharedAssets={vi.fn()}
      />
    );

    // 初期状態は文書タブが表示されている
    expect(screen.getByText("新規文書を作成")).toBeTruthy();

    // 見出し（アウトライン）タブへ切り替え
    fireEvent.click(screen.getByRole("tab", { name: /見出し/ }));
    expect(screen.queryByText("新規文書を作成")).toBeNull();
    expect(screen.getByRole("navigation", { name: "見出しアウトライン" })).toBeTruthy();

    const h1Btn = screen.getByRole("button", { name: /第1章 概要/ });
    const h2Btn = screen.getByRole("button", { name: /1\.1 目的/ });
    const h3Btn = screen.getByRole("button", { name: /1\.1\.1 補足/ });

    // レベルに応じたインデント（H1 < H2 < H3）とアクティブ状態
    const h1Pad = Number.parseInt(h1Btn.style.paddingLeft, 10);
    const h2Pad = Number.parseInt(h2Btn.style.paddingLeft, 10);
    const h3Pad = Number.parseInt(h3Btn.style.paddingLeft, 10);
    expect(h1Pad).toBeLessThan(h2Pad);
    expect(h2Pad).toBeLessThan(h3Pad);
    expect(h2Btn.getAttribute("aria-current")).toBe("location");
    expect(h1Btn.getAttribute("aria-current")).toBeNull();

    // クリックで該当見出しを通知
    fireEvent.click(h3Btn);
    expect(onSelectHeading).toHaveBeenCalledWith(headings[2]);

    // 文書タブへ戻せる
    fireEvent.click(screen.getByRole("tab", { name: /文書/ }));
    expect(screen.getByText("新規文書を作成")).toBeTruthy();
  });

  it("shows an empty-state message when the document has no headings", () => {
    render(
      <DocumentSidebar
        isOpen={true}
        activeDocId="doc_1"
        activeFrontmatterAssets={{
          logo: "",
          cover_image: "",
          back_cover_image: "",
        }}
        documents={[DOC_1]}
        sharedAssets={[]}
        headings={[]}
        onSelectDocument={vi.fn()}
        onCreateDocument={vi.fn()}
        onExportDocument={vi.fn()}
        onRequestDeleteDocument={vi.fn()}
        onRequestDeleteAllDocuments={vi.fn()}
        onAddSharedAsset={vi.fn()}
        onApplySharedAsset={vi.fn()}
        onRequestDeleteSharedAsset={vi.fn()}
        onRequestDeleteAllSharedAssets={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("tab", { name: /見出し/ }));
    expect(screen.getByText(/見出し（# 〜 ######）が見つかりません/)).toBeTruthy();
  });

  it("supports WAI-ARIA tablist keyboard navigation (ArrowRight, ArrowLeft, Home, End) with roving tabIndex", () => {
    render(
      <DocumentSidebar
        isOpen={true}
        activeDocId="doc_1"
        activeFrontmatterAssets={{
          logo: "",
          cover_image: "",
          back_cover_image: "",
        }}
        documents={[DOC_1]}
        sharedAssets={[SHARED_1]}
        headings={[{ id: "h-1", level: 1, text: "はじめに", line: 1 }]}
        onSelectDocument={vi.fn()}
        onCreateDocument={vi.fn()}
        onExportDocument={vi.fn()}
        onRequestDeleteDocument={vi.fn()}
        onRequestDeleteAllDocuments={vi.fn()}
        onAddSharedAsset={vi.fn()}
        onApplySharedAsset={vi.fn()}
        onRequestDeleteSharedAsset={vi.fn()}
        onRequestDeleteAllSharedAssets={vi.fn()}
      />
    );

    const docsTab = screen.getByRole("tab", { name: /文書/ });
    const outlineTab = screen.getByRole("tab", { name: /見出し/ });
    const assetsTab = screen.getByRole("tab", { name: /共通画像/ });

    // Initial roving tabIndex: docs=0, others=-1
    expect(docsTab.getAttribute("tabindex")).toBe("0");
    expect(outlineTab.getAttribute("tabindex")).toBe("-1");
    expect(assetsTab.getAttribute("tabindex")).toBe("-1");

    // ArrowRight -> outline
    docsTab.focus();
    fireEvent.keyDown(docsTab, { key: "ArrowRight" });
    expect(outlineTab.getAttribute("aria-selected")).toBe("true");
    expect(outlineTab.getAttribute("tabindex")).toBe("0");
    expect(docsTab.getAttribute("tabindex")).toBe("-1");
    expect(document.activeElement).toBe(outlineTab);

    // End -> assets
    fireEvent.keyDown(outlineTab, { key: "End" });
    expect(assetsTab.getAttribute("aria-selected")).toBe("true");
    expect(assetsTab.getAttribute("tabindex")).toBe("0");
    expect(document.activeElement).toBe(assetsTab);

    // ArrowRight wraps -> docs
    fireEvent.keyDown(assetsTab, { key: "ArrowRight" });
    expect(docsTab.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(docsTab);

    // ArrowLeft wraps -> assets
    fireEvent.keyDown(docsTab, { key: "ArrowLeft" });
    expect(assetsTab.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(assetsTab);

    // Home -> docs
    fireEvent.keyDown(assetsTab, { key: "Home" });
    expect(docsTab.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(docsTab);
  });

  it("renders warning-styled sample reset button in documents footer and invokes onRequestResetSample (#63)", () => {
    const onRequestResetSample = vi.fn();

    render(
      <DocumentSidebar
        isOpen={true}
        activeDocId="doc_1"
        activeFrontmatterAssets={{
          logo: "",
          cover_image: "",
          back_cover_image: "",
        }}
        documents={[DOC_1]}
        sharedAssets={[]}
        onSelectDocument={vi.fn()}
        onCreateDocument={vi.fn()}
        onExportDocument={vi.fn()}
        onRequestResetSample={onRequestResetSample}
        onRequestDeleteDocument={vi.fn()}
        onRequestDeleteAllDocuments={vi.fn()}
        onAddSharedAsset={vi.fn()}
        onApplySharedAsset={vi.fn()}
        onRequestDeleteSharedAsset={vi.fn()}
        onRequestDeleteAllSharedAssets={vi.fn()}
      />
    );

    const resetBtn = screen.getByRole("button", {
      name: "サンプルを復元（上書き）",
    });
    expect(resetBtn.className).toContain("text-amber-300");
    fireEvent.click(resetBtn);
    expect(onRequestResetSample).toHaveBeenCalledTimes(1);
  });
});
