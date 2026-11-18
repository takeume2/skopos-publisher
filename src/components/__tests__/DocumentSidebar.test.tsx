import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { DocumentSidebar } from "@/components/DocumentSidebar";
import type {
  DocumentSummary,
  SharedAssetSummary,
} from "@/hooks/useIndexedDbStorage";

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
});
