import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { clear, get, keys, set } from "idb-keyval";
import { useIndexedDbStorage } from "@/hooks/useIndexedDbStorage";

describe("useIndexedDbStorage", () => {
  beforeEach(async () => {
    await clear();
  });

  it("migrates legacy keys idempotently and separates shared vs doc assets", async () => {
    await set("mdpub:markdown:v1", '---\ntitle: "旧文書"\n---\n\n![img](asset:img_1)');
    await set("mdpub:assets:v1", {
      "asset:logo_1": "data:image/png;base64,LOGO",
      "asset:cover_bg_1": "data:image/png;base64,COVER",
      "asset:img_1": "data:image/png;base64,INLINE",
      "rel:images/pic.png": "data:image/png;base64,REL",
    });

    const { result, unmount } = renderHook(() => useIndexedDbStorage());
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    expect(result.current.documentList).toHaveLength(1);
    expect(result.current.documentList[0].title).toBe("旧文書");
    expect(result.current.documentList[0].assetCount).toBe(2);
    expect(result.current.sharedAssetList).toHaveLength(2);
    expect(result.current.assets["asset:logo_1"]).toBe(
      "data:image/png;base64,LOGO"
    );
    expect(result.current.assets["asset:img_1"]).toBe(
      "data:image/png;base64,INLINE"
    );

    expect(await get("mdpub:markdown:v1")).toBeUndefined();
    expect(await get("mdpub:assets:v1")).toBeUndefined();
    expect(await get("mdpub:migrated_v2:v1")).toBe(true);

    unmount();

    // 2回目のマウントで重複移行されないこと
    const second = renderHook(() => useIndexedDbStorage());
    await waitFor(() => expect(second.result.current.isLoaded).toBe(true));
    expect(second.result.current.documentList).toHaveLength(1);
  });

  it("isolates doc assets across documents while sharing shared assets", async () => {
    const { result } = renderHook(() => useIndexedDbStorage());
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    const firstDocId = result.current.activeDocId;

    await act(async () => {
      await result.current.saveAsset("asset:logo_1", "data:image/png;base64,SHARED_LOGO");
      await result.current.saveAsset("asset:img_doc1", "data:image/png;base64,DOC1_IMG");
    });

    let secondDocId = "";
    await act(async () => {
      secondDocId = await result.current.createDocument('---\ntitle: "文書2"\n---\n\n# 2');
    });

    expect(result.current.documentList).toHaveLength(2);
    expect(result.current.activeDocId).toBe(secondDocId);
    expect(result.current.assets["asset:logo_1"]).toBe(
      "data:image/png;base64,SHARED_LOGO"
    );
    expect(result.current.assets["asset:img_doc1"]).toBeUndefined();

    await act(async () => {
      await result.current.switchDocument(firstDocId);
    });

    expect(result.current.activeDocId).toBe(firstDocId);
    expect(result.current.assets["asset:img_doc1"]).toBe(
      "data:image/png;base64,DOC1_IMG"
    );
  });

  it("deletes all documents and doc assets while preserving prefs and shared assets", async () => {
    const { result } = renderHook(() => useIndexedDbStorage());
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    await act(async () => {
      await result.current.updatePrefs({ layoutMode: "spread" });
      await result.current.saveAsset("asset:logo_1", "data:image/png;base64,SHARED_LOGO");
      await result.current.saveAsset("asset:img_temp", "data:image/png;base64,TEMP");
      await result.current.createDocument('---\ntitle: "別文書"\n---\n\n# Test');
    });

    expect(result.current.documentList).toHaveLength(2);

    await act(async () => {
      await result.current.deleteAllDocuments();
    });

    expect(result.current.documentList).toHaveLength(1);
    expect(result.current.documentList[0].title).toBe("無題のドキュメント");
    expect(result.current.prefs.layoutMode).toBe("spread");
    expect(result.current.assets["asset:logo_1"]).toBe(
      "data:image/png;base64,SHARED_LOGO"
    );
    expect(result.current.assets["asset:img_temp"]).toBeUndefined();
    expect(await get("mdpub:active_doc_id:v1")).toBe(result.current.activeDocId);
  });

  it("stores multiple shared assets with custom labels and removes metadata on delete", async () => {
    const { result } = renderHook(() => useIndexedDbStorage());
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    await act(async () => {
      await result.current.saveAsset(
        "asset:shared_logo_100",
        "data:image/png;base64,LOGO_A",
        "company-a.png"
      );
      await result.current.saveAsset(
        "asset:shared_logo_200",
        "data:image/png;base64,LOGO_B",
        "company-b.png"
      );
    });

    expect(result.current.sharedAssetList).toHaveLength(2);
    expect(result.current.sharedAssetList.map((a) => a.label)).toEqual([
      "company-a.png",
      "company-b.png",
    ]);

    await act(async () => {
      await result.current.removeAsset("asset:shared_logo_100");
    });

    expect(result.current.sharedAssetList).toHaveLength(1);
    const meta = await get<Record<string, string>>("mdpub:shared_meta:v1");
    expect(meta?.["asset:shared_logo_100"]).toBeUndefined();
    expect(meta?.["asset:shared_logo_200"]).toBe("company-b.png");

    await act(async () => {
      await result.current.clearSharedAssets();
    });
    expect(result.current.sharedAssetList).toHaveLength(0);
    expect(await get("mdpub:shared_meta:v1")).toBeUndefined();
  });

  it("deletes a single active document with its doc_assets and switches to remaining doc", async () => {
    const { result } = renderHook(() => useIndexedDbStorage());
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    const firstId = result.current.activeDocId;
    await act(async () => {
      await result.current.saveAsset("asset:logo_1", "data:image/png;base64,SHARED");
      await result.current.saveAsset("asset:img_first", "data:image/png;base64,FIRST_IMG");
    });

    let secondId = "";
    await act(async () => {
      secondId = await result.current.createDocument(
        '---\ntitle: "削除対象"\n---\n\n![img](asset:img_second)'
      );
      await result.current.saveAsset("asset:img_second", "data:image/png;base64,SECOND_IMG");
    });

    expect(result.current.activeDocId).toBe(secondId);

    await act(async () => {
      await result.current.deleteDocument(secondId);
    });

    expect(result.current.documentList).toHaveLength(1);
    expect(result.current.activeDocId).toBe(firstId);
    expect(result.current.assets["asset:logo_1"]).toBe(
      "data:image/png;base64,SHARED"
    );

    const allKeys = await keys();
    expect(
      allKeys.some((k) => String(k).startsWith(`mdpub:doc_asset:${secondId}:`))
    ).toBe(false);
  });

  it("expands inline doc_assets for an inactive document in getExpandedMarkdownForDoc", async () => {
    const { result } = renderHook(() => useIndexedDbStorage());
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    const doc1Id = result.current.activeDocId;
    await act(async () => {
      result.current.setMarkdown('---\ntitle: "文書1"\n---\n\n![pic](asset:img_1)');
      await result.current.saveAsset("asset:img_1", "data:image/png;base64,DOC1_DATA");
      await result.current.createDocument('---\ntitle: "文書2"\n---\n\n# 2');
    });

    // 現在アクティブなのは文書2だが、文書1の展開結果を取得できること
    const exported = await result.current.getExpandedMarkdownForDoc(doc1Id);
    expect(exported).not.toBeNull();
    expect(exported?.title).toBe("文書1");
    expect(exported?.content).toContain("![pic](data:image/png;base64,DOC1_DATA)");
  });

  it("preserves unresolved asset: references in getExpandedMarkdownForDoc and batches writes via saveAssetsBatch (#25)", async () => {
    const { result } = renderHook(() => useIndexedDbStorage());
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    const docId = result.current.activeDocId;
    await act(async () => {
      result.current.setMarkdown(
        '---\ntitle: "未解決保持"\n---\n\n![missing](asset:missing.png)\n![ok](asset:ok.png)'
      );
      await result.current.saveAssetsBatch({
        "asset:ok.png": "data:image/png;base64,OK_IMG",
        "asset:extra.png": "data:image/png;base64,EXTRA_IMG",
      });
    });

    expect(result.current.assets["asset:ok.png"]).toBe(
      "data:image/png;base64,OK_IMG"
    );
    expect(result.current.assets["asset:extra.png"]).toBe(
      "data:image/png;base64,EXTRA_IMG"
    );

    const exported = await result.current.getExpandedMarkdownForDoc(docId);
    expect(exported?.content).toContain("![missing](asset:missing.png)");
    expect(exported?.content).toContain("![ok](data:image/png;base64,OK_IMG)");
  });
});
