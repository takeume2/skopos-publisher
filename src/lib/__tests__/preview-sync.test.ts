import { describe, it, expect, beforeEach, vi } from "vitest";
import { clear, set } from "idb-keyval";
import {
  buildParentWindowName,
  buildPreviewPopoutUrl,
  getOrCreatePreviewSessionId,
  parsePreviewSyncMessage,
  PREVIEW_SESSION_STORAGE_KEY,
} from "@/lib/preview-sync";
import { loadMergedAssetsForDoc } from "@/hooks/useIndexedDbStorage";

describe("preview-sync utilities (#64)", () => {
  beforeEach(async () => {
    window.sessionStorage.clear();
    await clear();
  });

  it("persists sessionId in sessionStorage across calls and builds encoded popout URL", () => {
    const first = getOrCreatePreviewSessionId();
    expect(first.length).toBeGreaterThan(0);
    expect(window.sessionStorage.getItem(PREVIEW_SESSION_STORAGE_KEY)).toBe(
      first
    );

    // 同一タブのリロード相当: 同じ sessionId を再利用
    const second = getOrCreatePreviewSessionId();
    expect(second).toBe(first);

    expect(buildPreviewPopoutUrl("abc/123")).toBe("/preview?session=abc%2F123");
    expect(buildParentWindowName("sess-1")).toBe("skopos_editor_sess-1");
  });

  it("falls back cleanly if sessionStorage throws", () => {
    const spy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("storage blocked");
      });
    try {
      const id = getOrCreatePreviewSessionId();
      expect(id.length).toBeGreaterThan(0);
    } finally {
      spy.mockRestore();
    }
  });

  it("validates incoming messages and rejects mismatched sessionId or malformed payloads", () => {
    const validSync = {
      type: "sync-state",
      sessionId: "sess-1",
      documentId: "doc_1",
      markdown: "# Hello",
      exportBasename: "20261128_Hello",
      prefs: {
        autoUpdate: true,
        showMarginGuides: false,
        layoutMode: "single",
      },
      assetsVersion: 1,
    };

    expect(parsePreviewSyncMessage(validSync, "sess-1")).toEqual(validSync);
    // 複数タブ混線防止: 別 sessionId は完全に無視される
    expect(parsePreviewSyncMessage(validSync, "sess-2")).toBeNull();

    // 不正ペイロード拒否
    expect(
      parsePreviewSyncMessage({ type: "sync-state", sessionId: "sess-1" }, "sess-1")
    ).toBeNull();
    expect(
      parsePreviewSyncMessage(
        { type: "update-prefs", sessionId: "sess-1", patch: { layoutMode: "invalid" } },
        "sess-1"
      )
    ).toBeNull();
    expect(
      parsePreviewSyncMessage(
        { type: "update-prefs", sessionId: "sess-1", patch: { layoutMode: "spread" } },
        "sess-1"
      )
    ).toEqual({
      type: "update-prefs",
      sessionId: "sess-1",
      patch: { layoutMode: "spread" },
    });

    // 拡張された印刷・プリフライト設定と parentWindowName・jump-to-line メッセージの検証
    const validSyncWithPrintPrefs = {
      ...validSync,
      parentWindowName: "skopos_editor_sess-1",
      prefs: {
        ...validSync.prefs,
        locale: "en",
        skipPrintHeaderFooterNotice: true,
        enablePreflightCheck: true,
        preflightNgWords: "社外秘, ProjectX",
      },
    };
    expect(parsePreviewSyncMessage(validSyncWithPrintPrefs, "sess-1")).toEqual(
      validSyncWithPrintPrefs
    );
    expect(
      parsePreviewSyncMessage(
        {
          ...validSync,
          prefs: { ...validSync.prefs, locale: "fr" },
        },
        "sess-1"
      )
    ).toBeNull();
    expect(
      parsePreviewSyncMessage(
        {
          ...validSync,
          parentWindowName: 123,
        },
        "sess-1"
      )
    ).toBeNull();
    expect(
      parsePreviewSyncMessage(
        {
          ...validSync,
          prefs: { ...validSync.prefs, enablePreflightCheck: "yes" },
        },
        "sess-1"
      )
    ).toBeNull();
    expect(
      parsePreviewSyncMessage(
        {
          ...validSync,
          prefs: { ...validSync.prefs, preflightNgWords: 123 },
        },
        "sess-1"
      )
    ).toBeNull();

    expect(
      parsePreviewSyncMessage(
        {
          type: "update-prefs",
          sessionId: "sess-1",
          patch: { skipPrintHeaderFooterNotice: true },
        },
        "sess-1"
      )
    ).toEqual({
      type: "update-prefs",
      sessionId: "sess-1",
      patch: { skipPrintHeaderFooterNotice: true },
    });

    expect(
      parsePreviewSyncMessage(
        { type: "jump-to-line", sessionId: "sess-1", line: 12 },
        "sess-1"
      )
    ).toEqual({
      type: "jump-to-line",
      sessionId: "sess-1",
      line: 12,
    });
    expect(
      parsePreviewSyncMessage(
        { type: "jump-to-line", sessionId: "sess-1", line: 0 },
        "sess-1"
      )
    ).toBeNull();
    expect(
      parsePreviewSyncMessage(
        { type: "jump-to-line", sessionId: "sess-1", line: 1.5 },
        "sess-1"
      )
    ).toBeNull();
    expect(
      parsePreviewSyncMessage(
        { type: "jump-to-line", sessionId: "sess-2", line: 12 },
        "sess-1"
      )
    ).toBeNull();
  });

  it("loads merged shared and target document assets from IndexedDB while isolating other documents", async () => {
    await set("mdpub:shared_asset:asset:logo_1", "data:image/png;base64,SHARED");
    await set("mdpub:doc_asset:doc_a:asset:fig_a", "data:image/png;base64,DOC_A");
    await set("mdpub:doc_asset:doc_b:asset:fig_b", "data:image/png;base64,DOC_B");

    const mergedA = await loadMergedAssetsForDoc("doc_a");
    expect(mergedA).toEqual({
      "asset:logo_1": "data:image/png;base64,SHARED",
      "asset:fig_a": "data:image/png;base64,DOC_A",
    });
  });
});
