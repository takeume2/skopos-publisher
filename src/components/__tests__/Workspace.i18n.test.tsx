import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { DEFAULT_FILENAME_TEMPLATE } from "@/lib/export-filename";
import type { Locale } from "@/lib/i18n";

let initialLocale: Locale = "ja";
let initialMarkdown = "";
const mockUpdatePrefsSpy = vi.fn();

vi.mock("@/hooks/useIndexedDbStorage", () => ({
  useIndexedDbStorage: () => {
    const [markdown, setMarkdown] = React.useState(initialMarkdown);
    const [prefs, setPrefs] = React.useState({
      locale: initialLocale,
      autoUpdate: true,
      showMarginGuides: false,
      layoutMode: "single" as "single" | "spread",
      isSidebarOpen: true,
      filenameTemplate: DEFAULT_FILENAME_TEMPLATE,
      skipPrintHeaderFooterNotice: false,
      enablePreflightCheck: true,
      preflightNgWords: "",
    });
    const updatePrefs = React.useCallback(
      async (patch: Partial<typeof prefs>) => {
        mockUpdatePrefsSpy(patch);
        setPrefs((prev) => ({ ...prev, ...patch }));
      },
      []
    );
    return {
      markdown,
      setMarkdown,
      activeDocId: "doc_i18n",
      documentList: [
        {
          id: "doc_i18n",
          title: "My Proposal",
          updatedAt: Date.now(),
          markdownBytes: 120,
          assetsBytes: 0,
          totalBytes: 120,
          assetCount: 0,
        },
      ],
      sharedAssetList: [],
      assets: {},
      saveAsset: vi.fn(),
      saveAssetsBatch: vi.fn(),
      removeAsset: vi.fn(),
      clearSharedAssets: vi.fn(),
      switchDocument: vi.fn(),
      createDocument: vi.fn(),
      deleteDocument: vi.fn(),
      deleteAllDocuments: vi.fn(),
      getExpandedMarkdownForDoc: vi.fn(),
      prefs,
      updatePrefs,
      resetToSample: vi.fn(),
      isLoaded: true,
      saveStatus: "saved" as const,
      storageError: null,
      clearStorageError: vi.fn(),
    };
  },
}));

vi.mock("@/components/PagedPreviewPane", () => ({
  PagedPreviewPane: (props: {
    ref?: React.Ref<{
      isUpToDate: () => boolean;
      renderNow: () => Promise<{ ok: boolean }>;
    }>;
    headerRightExtra?: React.ReactNode;
  }) => {
    React.useImperativeHandle(props.ref, () => ({
      isUpToDate: () => true,
      renderNow: async () => ({ ok: true }),
    }));
    return (
      <div data-testid="mock-preview">
        {props.headerRightExtra}
      </div>
    );
  },
}));

vi.mock("@uiw/react-codemirror", () => ({
  default: ({ value }: { value: string }) => (
    <div data-testid="mock-codemirror">{value}</div>
  ),
}));

import { Workspace } from "@/components/Workspace";

describe("Workspace i18n JA/EN switching (#71)", () => {
  beforeEach(() => {
    initialLocale = "ja";
    initialMarkdown =
      '---\ntitle: "My Proposal"\nauthor: "Team"\ndate: "2026-11-28"\n---\n\n# Intro\nTBD item';
    mockUpdatePrefsSpy.mockClear();
    document.documentElement.lang = "ja";
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("switches toolbar, sidebar, settings drawer, editor status bar, and preflight dialog to English without mutating existing document text", () => {
    render(<Workspace />);

    // 初期状態は日本語
    expect(screen.getByRole("button", { name: "PDF出力 / 印刷" })).toBeTruthy();
    expect(screen.getByText("ドキュメント設定")).toBeTruthy();
    expect(screen.getByText("行 1, 列 1")).toBeTruthy();
    expect(document.documentElement.lang).toBe("ja");

    // トップバーの EN ボタンで英語へ切替
    fireEvent.click(screen.getByRole("button", { name: "EN" }));

    expect(mockUpdatePrefsSpy).toHaveBeenCalledWith({ locale: "en" });
    expect(document.documentElement.lang).toBe("en");
    expect(screen.getByRole("button", { name: "Export PDF / Print" })).toBeTruthy();
    expect(screen.getByText("Document Settings")).toBeTruthy();
    expect(screen.getByRole("button", { name: "New Document" })).toBeTruthy();
    expect(screen.getByText("Ln 1, Col 1")).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "Detach preview into a separate window",
      })
    ).toBeTruthy();

    // 既存文書の本文は言語切替で書き換わらないこと
    expect(screen.getByTestId("mock-codemirror").textContent).toBe(
      initialMarkdown
    );

    // 英語 UI での印刷前プリフライト確認モーダル
    fireEvent.click(screen.getByRole("button", { name: "Export PDF / Print" }));
    expect(screen.getByText("Pre-Print Preflight Check (1 item(s))")).toBeTruthy();
    expect(screen.getByText('Draft marker "TBD" still remains.')).toBeTruthy();
    expect(screen.getByRole("button", { name: "Export Anyway" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    // JA ボタンで日本語へ戻せること
    fireEvent.click(screen.getByRole("button", { name: "JA" }));
    expect(document.documentElement.lang).toBe("ja");
    expect(screen.getByRole("button", { name: "PDF出力 / 印刷" })).toBeTruthy();
  });
});
