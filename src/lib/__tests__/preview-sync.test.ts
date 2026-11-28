import { describe, it, expect, beforeEach, vi } from "vitest";
import { clear, set } from "idb-keyval";
import {
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
