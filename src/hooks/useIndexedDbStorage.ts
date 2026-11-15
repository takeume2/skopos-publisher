"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { get, set } from "idb-keyval";
import { SAMPLE_MARKDOWN } from "@/lib/sample-markdown";

const KEY_MARKDOWN = "mdpub:markdown:v1";
const KEY_ASSETS = "mdpub:assets:v1";
const KEY_PREFS = "mdpub:prefs:v1";

export type SaveStatus = "saved" | "saving" | "loading";
export type LayoutMode = "single" | "spread";

export interface UiPreferences {
  autoUpdate: boolean;
  showMarginGuides: boolean;
  layoutMode: LayoutMode;
}

const DEFAULT_PREFS: UiPreferences = {
  autoUpdate: true,
  showMarginGuides: false,
  layoutMode: "single",
};

export function useIndexedDbStorage() {
  const [markdown, setMarkdownState] = useState<string>(SAMPLE_MARKDOWN);
  const [assets, setAssetsState] = useState<Record<string, string>>({});
  const [prefs, setPrefsState] = useState<UiPreferences>(DEFAULT_PREFS);
  const [isLoaded, setIsLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("loading");

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let active = true;

    async function hydrate() {
      try {
        const [savedMd, savedAssets, savedPrefs] = await Promise.all([
          get<string>(KEY_MARKDOWN),
          get<Record<string, string>>(KEY_ASSETS),
          get<UiPreferences>(KEY_PREFS),
        ]);

        if (!active) return;

        if (typeof savedMd === "string" && savedMd.length > 0) {
          setMarkdownState(savedMd);
        }
        if (savedAssets && typeof savedAssets === "object") {
          setAssetsState(savedAssets);
        }
        if (savedPrefs && typeof savedPrefs === "object") {
          setPrefsState({ ...DEFAULT_PREFS, ...savedPrefs });
        }
      } catch (err) {
        console.error("Failed to load from IndexedDB:", err);
      } finally {
        if (active) {
          setIsLoaded(true);
          setSaveStatus("saved");
        }
      }
    }

    hydrate();
    return () => {
      active = false;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const setMarkdown = useCallback((nextValue: string) => {
    setMarkdownState(nextValue);
    setSaveStatus("saving");

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = setTimeout(async () => {
      try {
        await set(KEY_MARKDOWN, nextValue);
        setSaveStatus("saved");
      } catch (err) {
        console.error("Failed to save markdown to IndexedDB:", err);
      }
    }, 500);
  }, []);

  const saveAsset = useCallback(async (assetId: string, dataUrl: string) => {
    setAssetsState((prev) => {
      const nextAssets = { ...prev, [assetId]: dataUrl };
      void set(KEY_ASSETS, nextAssets).catch((err) =>
        console.error("Failed to save asset to IndexedDB:", err)
      );
      return nextAssets;
    });
  }, []);

  const saveAssetsBatch = useCallback(
    async (entries: Record<string, string>) => {
      let merged: Record<string, string> = {};
      setAssetsState((prev) => {
        merged = { ...prev, ...entries };
        return merged;
      });
      try {
        await set(KEY_ASSETS, merged);
      } catch (err) {
        console.error("Failed to save assets batch to IndexedDB:", err);
      }
    },
    []
  );

  const removeAsset = useCallback(async (assetId: string) => {
    setAssetsState((prev) => {
      const nextAssets = { ...prev };
      delete nextAssets[assetId];
      void set(KEY_ASSETS, nextAssets).catch((err) =>
        console.error("Failed to remove asset from IndexedDB:", err)
      );
      return nextAssets;
    });
  }, []);

  const updatePrefs = useCallback(
    async (patch: Partial<UiPreferences>) => {
      const nextPrefs = { ...prefs, ...patch };
      setPrefsState(nextPrefs);
      try {
        await set(KEY_PREFS, nextPrefs);
      } catch (err) {
        console.error("Failed to save preferences to IndexedDB:", err);
      }
    },
    [prefs]
  );

  const resetToSample = useCallback(async () => {
    setMarkdownState(SAMPLE_MARKDOWN);
    setSaveStatus("saving");
    try {
      await set(KEY_MARKDOWN, SAMPLE_MARKDOWN);
      setSaveStatus("saved");
    } catch (err) {
      console.error("Failed to reset markdown:", err);
    }
  }, []);

  return {
    markdown,
    setMarkdown,
    assets,
    saveAsset,
    saveAssetsBatch,
    removeAsset,
    prefs,
    updatePrefs,
    resetToSample,
    isLoaded,
    saveStatus,
  };
}
