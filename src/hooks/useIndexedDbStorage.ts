"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { delMany, get, getMany, keys, set, setMany } from "idb-keyval";
import { DEFAULT_FILENAME_TEMPLATE } from "@/lib/export-filename";
import { parseMarkdownDocument } from "@/lib/frontmatter";
import {
  detectBrowserLocale,
  getDictionary,
  isLocale,
  type Locale,
} from "@/lib/i18n";
import { resolveAssetSrc } from "@/lib/markdown";
import { getSampleMarkdown } from "@/lib/sample-markdown";

const KEY_PREFIX_DOC = "mdpub:doc:";
const KEY_PREFIX_DOC_ASSET = "mdpub:doc_asset:";
const KEY_PREFIX_SHARED_ASSET = "mdpub:shared_asset:";
const KEY_ACTIVE_DOC_ID = "mdpub:active_doc_id:v1";
const KEY_MIGRATED_V2 = "mdpub:migrated_v2:v1";
const KEY_PREFS = "mdpub:prefs:v1";
const KEY_SHARED_META = "mdpub:shared_meta:v1";

const LEGACY_KEY_MARKDOWN = "mdpub:markdown:v1";
const LEGACY_KEY_ASSETS = "mdpub:assets:v1";

export const SHARED_ASSET_IDS = new Set([
  "asset:logo_1",
  "asset:cover_bg_1",
  "asset:backcover_bg_1",
  "asset:back_cover_bg_1",
]);

export function isSharedAssetId(assetId: string): boolean {
  return SHARED_ASSET_IDS.has(assetId) || assetId.startsWith("asset:shared_");
}

export type SaveStatus = "saved" | "saving" | "loading";
export type LayoutMode = "single" | "spread";

export interface UiPreferences {
  locale: Locale;
  autoUpdate: boolean;
  showMarginGuides: boolean;
  layoutMode: LayoutMode;
  isSidebarOpen: boolean;
  filenameTemplate: string;
  skipPrintHeaderFooterNotice: boolean;
  enablePreflightCheck: boolean;
  preflightNgWords: string;
}

export interface StoredDocument {
  id: string;
  title: string;
  markdown: string;
  updatedAt: number;
  assetSizes: Record<string, number>;
}

export interface DocumentSummary {
  id: string;
  title: string;
  updatedAt: number;
  markdownBytes: number;
  assetsBytes: number;
  totalBytes: number;
  assetCount: number;
}

export interface SharedAssetSummary {
  assetId: string;
  label: string;
  dataUrl: string;
  bytes: number;
}

const DEFAULT_PREFS: UiPreferences = {
  locale: "ja",
  autoUpdate: true,
  showMarginGuides: false,
  layoutMode: "single",
  isSidebarOpen: true,
  filenameTemplate: DEFAULT_FILENAME_TEMPLATE,
  skipPrintHeaderFooterNotice: false,
  enablePreflightCheck: true,
  preflightNgWords: "",
};

function createDocId(): string {
  return `doc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function getByteSize(value: unknown): number {
  const str = typeof value === "string" ? value : JSON.stringify(value);
  return new Blob([str]).size;
}

function extractTitle(markdown: string, locale: Locale = "ja"): string {
  const title = parseMarkdownDocument(markdown).frontmatter.title.trim();
  return title || getDictionary(locale).common.untitledDocument;
}

export function formatLocalIsoDate(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildBlankMarkdown(
  title?: string,
  locale: Locale = "ja"
): string {
  const dict = getDictionary(locale);
  const resolvedTitle = title ?? dict.common.newDocument;
  const today = formatLocalIsoDate();
  return `---
title: "${resolvedTitle}"
subtitle: ""
author: ""
recipient: ""
date: "${today}"
page_size: "A4"
orientation: "portrait"
cover: true
cover_image: ""
cover_overlay: "light-fade"
back_cover: false
back_cover_image: ""
back_cover_text: ""
toc: true
toc_depth: 3
theme: "business"
primary_color: ""
accent_color: ""
heading_highlight: "tinted"
font_family: "theme"
font_size: 10
line_height: 1.7
confidential_mode: "none"
confidential_label: "CONFIDENTIAL"
logo: ""
logo_position: "cover-and-header"
header_left: "{title}"
header_right: "{date}"
footer_left: "{author}"
footer_right: "{page} / {pages}"
---

${dict.storage.blankHeading}

${dict.storage.blankBody}
`;
}

function getSharedAssetDefaultLabel(assetId: string, locale: Locale): string {
  const st = getDictionary(locale).storage;
  if (assetId === "asset:logo_1" || assetId.startsWith("asset:shared_logo")) {
    return st.sharedLogoLabel;
  }
  if (
    assetId === "asset:cover_bg_1" ||
    assetId.startsWith("asset:shared_cover")
  ) {
    return st.sharedCoverLabel;
  }
  if (
    assetId === "asset:backcover_bg_1" ||
    assetId === "asset:back_cover_bg_1" ||
    assetId.startsWith("asset:shared_backcover")
  ) {
    return st.sharedBackCoverLabel;
  }
  return st.sharedGenericLabel;
}

function isQuotaError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = (err as { name?: string }).name || "";
  return (
    name === "QuotaExceededError" ||
    name === "NS_ERROR_DOM_QUOTA_REACHED"
  );
}

/**
 * Loads merged shared assets and document-specific assets for a given document ID
 * directly from IndexedDB. Used by the detached `/preview` window.
 */
export async function loadMergedAssetsForDoc(
  docId: string
): Promise<Record<string, string>> {
  const allKeys = await keys();
  const sharedKeys = allKeys.filter(
    (k): k is string =>
      typeof k === "string" && k.startsWith(KEY_PREFIX_SHARED_ASSET)
  );
  const docPrefix = docId ? `${KEY_PREFIX_DOC_ASSET}${docId}:` : "";
  const docKeys = docPrefix
    ? allKeys.filter(
        (k): k is string => typeof k === "string" && k.startsWith(docPrefix)
      )
    : [];

  const result: Record<string, string> = {};

  if (sharedKeys.length > 0) {
    const sharedVals = await getMany<string>(sharedKeys);
    sharedKeys.forEach((key, idx) => {
      const val = sharedVals[idx];
      if (typeof val === "string") {
        result[key.slice(KEY_PREFIX_SHARED_ASSET.length)] = val;
      }
    });
  }

  if (docKeys.length > 0) {
    const docVals = await getMany<string>(docKeys);
    docKeys.forEach((key, idx) => {
      const val = docVals[idx];
      if (typeof val === "string") {
        result[key.slice(docPrefix.length)] = val;
      }
    });
  }

  return result;
}

export function useIndexedDbStorage() {
  const [documents, setDocuments] = useState<Record<string, StoredDocument>>({});
  const [activeDocId, setActiveDocId] = useState<string>("");
  const [activeDocAssets, setActiveDocAssets] = useState<
    Record<string, string>
  >({});
  const [sharedAssets, setSharedAssets] = useState<Record<string, string>>({});
  const [sharedMeta, setSharedMeta] = useState<Record<string, string>>({});
  const [prefs, setPrefsState] = useState<UiPreferences>(DEFAULT_PREFS);
  const localeRef = useRef<Locale>(prefs.locale);
  localeRef.current = prefs.locale;
  const [isLoaded, setIsLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("loading");
  const [storageError, setStorageError] = useState<string | null>(null);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSaveRef = useRef<{
    docId: string;
    doc: StoredDocument;
  } | null>(null);

  const handleStorageError = useCallback((err: unknown, context: string) => {
    console.error(`${context}:`, err);
    if (isQuotaError(err)) {
      setStorageError(getDictionary(localeRef.current).storage.quotaExceededError);
    }
  }, []);

  const loadDocAssetsFromDb = useCallback(
    async (docId: string): Promise<Record<string, string>> => {
      const prefix = `${KEY_PREFIX_DOC_ASSET}${docId}:`;
      const allKeys = await keys();
      const targetKeys = allKeys.filter(
        (k): k is string => typeof k === "string" && k.startsWith(prefix)
      );
      if (targetKeys.length === 0) return {};

      const values = await getMany<string>(targetKeys);
      const result: Record<string, string> = {};
      targetKeys.forEach((key, idx) => {
        const val = values[idx];
        if (typeof val === "string") {
          result[key.slice(prefix.length)] = val;
        }
      });
      return result;
    },
    []
  );

  useEffect(() => {
    let active = true;

    async function hydrate() {
      try {
        const [allKeys, migratedV2, savedActiveId, savedPrefs, savedSharedMeta] =
          await Promise.all([
            keys(),
            get<boolean>(KEY_MIGRATED_V2),
            get<string>(KEY_ACTIVE_DOC_ID),
            get<Partial<UiPreferences>>(KEY_PREFS),
            get<Record<string, string>>(KEY_SHARED_META),
          ]);

        if (!active) return;

        const resolvedLocale: Locale =
          savedPrefs && isLocale(savedPrefs.locale)
            ? savedPrefs.locale
            : detectBrowserLocale();
        localeRef.current = resolvedLocale;

        if (savedPrefs && typeof savedPrefs === "object") {
          setPrefsState({
            ...DEFAULT_PREFS,
            ...savedPrefs,
            locale: resolvedLocale,
          });
        } else {
          setPrefsState({
            ...DEFAULT_PREFS,
            locale: resolvedLocale,
          });
        }
        if (savedSharedMeta && typeof savedSharedMeta === "object") {
          setSharedMeta(savedSharedMeta);
        }

        const docKeys = allKeys.filter(
          (k): k is string =>
            typeof k === "string" && k.startsWith(KEY_PREFIX_DOC)
        );
        const sharedKeys = allKeys.filter(
          (k): k is string =>
            typeof k === "string" && k.startsWith(KEY_PREFIX_SHARED_ASSET)
        );

        const loadedDocs: Record<string, StoredDocument> = {};
        const loadedShared: Record<string, string> = {};

        if (sharedKeys.length > 0) {
          const sharedVals = await getMany<string>(sharedKeys);
          sharedKeys.forEach((key, idx) => {
            const val = sharedVals[idx];
            if (typeof val === "string") {
              loadedShared[key.slice(KEY_PREFIX_SHARED_ASSET.length)] = val;
            }
          });
        }

        // 旧形式からの冪等マイグレーション
        if (!migratedV2 && docKeys.length === 0) {
          const [legacyMd, legacyAssets] = await Promise.all([
            get<string>(LEGACY_KEY_MARKDOWN),
            get<Record<string, string>>(LEGACY_KEY_ASSETS),
          ]);

          const initialMd =
            typeof legacyMd === "string" && legacyMd.length > 0
              ? legacyMd
              : getSampleMarkdown(resolvedLocale);
          const initialId = createDocId();
          const assetSizes: Record<string, number> = {};

          if (legacyAssets && typeof legacyAssets === "object") {
            const writes: Array<Promise<void>> = [];
            for (const [assetId, dataUrl] of Object.entries(legacyAssets)) {
              if (typeof dataUrl !== "string") continue;
              if (isSharedAssetId(assetId)) {
                loadedShared[assetId] = dataUrl;
                writes.push(
                  set(`${KEY_PREFIX_SHARED_ASSET}${assetId}`, dataUrl)
                );
              } else {
                assetSizes[assetId] = getByteSize(dataUrl);
                writes.push(
                  set(
                    `${KEY_PREFIX_DOC_ASSET}${initialId}:${assetId}`,
                    dataUrl
                  )
                );
              }
            }
            await Promise.all(writes);
          }

          const newDoc: StoredDocument = {
            id: initialId,
            title: extractTitle(initialMd, resolvedLocale),
            markdown: initialMd,
            updatedAt: Date.now(),
            assetSizes,
          };

          await set(`${KEY_PREFIX_DOC}${initialId}`, newDoc);
          await set(KEY_ACTIVE_DOC_ID, initialId);
          await set(KEY_MIGRATED_V2, true);

          if (legacyMd !== undefined || legacyAssets !== undefined) {
            await delMany([LEGACY_KEY_MARKDOWN, LEGACY_KEY_ASSETS]);
          }

          loadedDocs[initialId] = newDoc;
        } else {
          if (docKeys.length > 0) {
            const docVals = await getMany<StoredDocument>(docKeys);
            docKeys.forEach((key, idx) => {
              const doc = docVals[idx];
              if (doc && typeof doc === "object" && typeof doc.id === "string") {
                loadedDocs[doc.id] = {
                  ...doc,
                  assetSizes: doc.assetSizes || {},
                };
              }
            });
          }

          if (Object.keys(loadedDocs).length === 0) {
            const fallbackId = createDocId();
            const fallbackSample = getSampleMarkdown(resolvedLocale);
            const fallbackDoc: StoredDocument = {
              id: fallbackId,
              title: extractTitle(fallbackSample, resolvedLocale),
              markdown: fallbackSample,
              updatedAt: Date.now(),
              assetSizes: {},
            };
            await set(`${KEY_PREFIX_DOC}${fallbackId}`, fallbackDoc);
            await set(KEY_ACTIVE_DOC_ID, fallbackId);
            await set(KEY_MIGRATED_V2, true);
            loadedDocs[fallbackId] = fallbackDoc;
          } else if (!migratedV2) {
            await set(KEY_MIGRATED_V2, true);
          }
        }

        if (!active) return;

        const sortedIds = Object.values(loadedDocs)
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .map((d) => d.id);

        const resolvedActiveId =
          savedActiveId && loadedDocs[savedActiveId]
            ? savedActiveId
            : sortedIds[0];

        if (resolvedActiveId !== savedActiveId) {
          await set(KEY_ACTIVE_DOC_ID, resolvedActiveId);
        }

        const initialDocAssets = await loadDocAssetsFromDb(resolvedActiveId);
        if (!active) return;

        setDocuments(loadedDocs);
        setSharedAssets(loadedShared);
        setActiveDocId(resolvedActiveId);
        setActiveDocAssets(initialDocAssets);
      } catch (err) {
        handleStorageError(err, "Failed to load from IndexedDB");
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
  }, [handleStorageError, loadDocAssetsFromDb]);

  const flushPendingSave = useCallback(async () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const pending = pendingSaveRef.current;
    pendingSaveRef.current = null;
    if (!pending) return;

    try {
      await set(`${KEY_PREFIX_DOC}${pending.docId}`, pending.doc);
      setSaveStatus("saved");
    } catch (err) {
      handleStorageError(err, "Failed to flush pending document save");
    }
  }, [handleStorageError]);

  const activeDocument = documents[activeDocId];
  const markdown = activeDocument?.markdown ?? getSampleMarkdown(prefs.locale);

  const assets = useMemo(
    () => ({ ...sharedAssets, ...activeDocAssets }),
    [sharedAssets, activeDocAssets]
  );

  const documentList: DocumentSummary[] = useMemo(() => {
    const fallbackTitle = getDictionary(prefs.locale).common.untitledDocument;
    return Object.values(documents)
      .map((doc) => {
        const markdownBytes = getByteSize(doc);
        const sizeEntries = Object.values(doc.assetSizes || {});
        const assetsBytes = sizeEntries.reduce((sum, n) => sum + n, 0);
        return {
          id: doc.id,
          title: doc.title || fallbackTitle,
          updatedAt: doc.updatedAt,
          markdownBytes,
          assetsBytes,
          totalBytes: markdownBytes + assetsBytes,
          assetCount: sizeEntries.length,
        };
      })
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [documents, prefs.locale]);

  const sharedAssetList: SharedAssetSummary[] = useMemo(() => {
    return Object.entries(sharedAssets).map(([assetId, dataUrl]) => ({
      assetId,
      label:
        sharedMeta[assetId] ||
        getSharedAssetDefaultLabel(assetId, prefs.locale),
      dataUrl,
      bytes: getByteSize(dataUrl),
    }));
  }, [prefs.locale, sharedAssets, sharedMeta]);

  const setMarkdown = useCallback(
    (nextValue: string) => {
      if (!activeDocId) return;
      const now = Date.now();
      const nextTitle = extractTitle(nextValue, localeRef.current);

      let updatedDoc: StoredDocument | null = null;
      setDocuments((prev) => {
        const current = prev[activeDocId];
        if (!current) return prev;
        updatedDoc = {
          ...current,
          title: nextTitle,
          markdown: nextValue,
          updatedAt: now,
        };
        return { ...prev, [activeDocId]: updatedDoc };
      });

      setSaveStatus("saving");
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }

      if (updatedDoc) {
        pendingSaveRef.current = { docId: activeDocId, doc: updatedDoc };
      }

      saveTimerRef.current = setTimeout(async () => {
        const pending = pendingSaveRef.current;
        pendingSaveRef.current = null;
        saveTimerRef.current = null;
        if (!pending) return;
        try {
          await set(`${KEY_PREFIX_DOC}${pending.docId}`, pending.doc);
          setSaveStatus("saved");
        } catch (err) {
          handleStorageError(err, "Failed to save document to IndexedDB");
        }
      }, 500);
    },
    [activeDocId, handleStorageError]
  );

  const switchDocument = useCallback(
    async (targetDocId: string) => {
      if (targetDocId === activeDocId || !documents[targetDocId]) return;
      await flushPendingSave();
      try {
        await set(KEY_ACTIVE_DOC_ID, targetDocId);
        const nextAssets = await loadDocAssetsFromDb(targetDocId);
        setActiveDocId(targetDocId);
        setActiveDocAssets(nextAssets);
        setSaveStatus("saved");
      } catch (err) {
        handleStorageError(err, "Failed to switch document");
      }
    },
    [
      activeDocId,
      documents,
      flushPendingSave,
      handleStorageError,
      loadDocAssetsFromDb,
    ]
  );

  const createDocument = useCallback(
    async (initialMarkdown?: string) => {
      await flushPendingSave();
      const currentLocale = localeRef.current;
      const newId = createDocId();
      const md = initialMarkdown ?? buildBlankMarkdown(undefined, currentLocale);
      const newDoc: StoredDocument = {
        id: newId,
        title: extractTitle(md, currentLocale),
        markdown: md,
        updatedAt: Date.now(),
        assetSizes: {},
      };

      try {
        await set(`${KEY_PREFIX_DOC}${newId}`, newDoc);
        await set(KEY_ACTIVE_DOC_ID, newId);
        setDocuments((prev) => ({ ...prev, [newId]: newDoc }));
        setActiveDocId(newId);
        setActiveDocAssets({});
        setSaveStatus("saved");
        return newId;
      } catch (err) {
        handleStorageError(err, "Failed to create document");
        return "";
      }
    },
    [flushPendingSave, handleStorageError]
  );

  const saveSharedAsset = useCallback(
    async (assetId: string, dataUrl: string, label?: string) => {
      try {
        await set(`${KEY_PREFIX_SHARED_ASSET}${assetId}`, dataUrl);
        setSharedAssets((prev) => ({ ...prev, [assetId]: dataUrl }));
        if (label) {
          setSharedMeta((prev) => {
            const next = { ...prev, [assetId]: label };
            void set(KEY_SHARED_META, next).catch((err) =>
              handleStorageError(err, "Failed to save shared asset metadata")
            );
            return next;
          });
        }
      } catch (err) {
        handleStorageError(err, "Failed to save shared asset");
      }
    },
    [handleStorageError]
  );

  const removeSharedAsset = useCallback(
    async (assetId: string) => {
      try {
        await delMany([`${KEY_PREFIX_SHARED_ASSET}${assetId}`]);
        setSharedAssets((prev) => {
          const next = { ...prev };
          delete next[assetId];
          return next;
        });
        setSharedMeta((prev) => {
          if (!(assetId in prev)) return prev;
          const next = { ...prev };
          delete next[assetId];
          void set(KEY_SHARED_META, next).catch((err) =>
            handleStorageError(err, "Failed to update shared asset metadata")
          );
          return next;
        });
      } catch (err) {
        handleStorageError(err, "Failed to remove shared asset");
      }
    },
    [handleStorageError]
  );

  const clearSharedAssets = useCallback(async () => {
    try {
      const allKeys = await keys();
      const sharedKeys = allKeys.filter(
        (k): k is string =>
          typeof k === "string" && k.startsWith(KEY_PREFIX_SHARED_ASSET)
      );
      await delMany([...sharedKeys, KEY_SHARED_META]);
      setSharedAssets({});
      setSharedMeta({});
    } catch (err) {
      handleStorageError(err, "Failed to clear shared assets");
    }
  }, [handleStorageError]);

  const saveDocAssetsBatch = useCallback(
    async (entries: Record<string, string>) => {
      if (!activeDocId || Object.keys(entries).length === 0) return;

      try {
        await setMany(
          Object.entries(entries).map(([assetId, dataUrl]) => [
            `${KEY_PREFIX_DOC_ASSET}${activeDocId}:${assetId}`,
            dataUrl,
          ])
        );

        setActiveDocAssets((prev) => ({ ...prev, ...entries }));
        setDocuments((prev) => {
          const current = prev[activeDocId];
          if (!current) return prev;
          const nextSizes = { ...current.assetSizes };
          for (const [assetId, dataUrl] of Object.entries(entries)) {
            nextSizes[assetId] = getByteSize(dataUrl);
          }
          const updated: StoredDocument = {
            ...current,
            updatedAt: Date.now(),
            assetSizes: nextSizes,
          };
          void set(`${KEY_PREFIX_DOC}${activeDocId}`, updated).catch((err) =>
            handleStorageError(err, "Failed to update assetSizes")
          );
          return { ...prev, [activeDocId]: updated };
        });
      } catch (err) {
        handleStorageError(err, "Failed to save document assets");
      }
    },
    [activeDocId, handleStorageError]
  );

  const saveAsset = useCallback(
    async (assetId: string, dataUrl: string, label?: string) => {
      if (isSharedAssetId(assetId)) {
        await saveSharedAsset(assetId, dataUrl, label);
      } else {
        await saveDocAssetsBatch({ [assetId]: dataUrl });
      }
    },
    [saveDocAssetsBatch, saveSharedAsset]
  );

  const removeAsset = useCallback(
    async (assetId: string) => {
      if (isSharedAssetId(assetId)) {
        await removeSharedAsset(assetId);
        return;
      }
      if (!activeDocId) return;
      try {
        await delMany([`${KEY_PREFIX_DOC_ASSET}${activeDocId}:${assetId}`]);
        setActiveDocAssets((prev) => {
          const next = { ...prev };
          delete next[assetId];
          return next;
        });
        setDocuments((prev) => {
          const current = prev[activeDocId];
          if (!current) return prev;
          const nextSizes = { ...current.assetSizes };
          delete nextSizes[assetId];
          const updated: StoredDocument = {
            ...current,
            updatedAt: Date.now(),
            assetSizes: nextSizes,
          };
          void set(`${KEY_PREFIX_DOC}${activeDocId}`, updated).catch((err) =>
            handleStorageError(err, "Failed to update assetSizes")
          );
          return { ...prev, [activeDocId]: updated };
        });
      } catch (err) {
        handleStorageError(err, "Failed to remove document asset");
      }
    },
    [activeDocId, handleStorageError, removeSharedAsset]
  );

  const deleteDocument = useCallback(
    async (targetDocId: string) => {
      if (pendingSaveRef.current?.docId === targetDocId) {
        if (saveTimerRef.current) {
          clearTimeout(saveTimerRef.current);
          saveTimerRef.current = null;
        }
        pendingSaveRef.current = null;
      } else {
        await flushPendingSave();
      }

      try {
        const allKeys = await keys();
        const assetPrefix = `${KEY_PREFIX_DOC_ASSET}${targetDocId}:`;
        const keysToDelete = [
          `${KEY_PREFIX_DOC}${targetDocId}`,
          ...allKeys.filter(
            (k): k is string =>
              typeof k === "string" && k.startsWith(assetPrefix)
          ),
        ];
        await delMany(keysToDelete);

        const remaining = { ...documents };
        delete remaining[targetDocId];
        const remainingSorted = Object.values(remaining).sort(
          (a, b) => b.updatedAt - a.updatedAt
        );

        if (remainingSorted.length === 0) {
          const currentLocale = localeRef.current;
          const freshId = createDocId();
          const freshSample = getSampleMarkdown(currentLocale);
          const freshDoc: StoredDocument = {
            id: freshId,
            title: extractTitle(freshSample, currentLocale),
            markdown: freshSample,
            updatedAt: Date.now(),
            assetSizes: {},
          };
          await set(`${KEY_PREFIX_DOC}${freshId}`, freshDoc);
          await set(KEY_ACTIVE_DOC_ID, freshId);
          setDocuments({ [freshId]: freshDoc });
          setActiveDocId(freshId);
          setActiveDocAssets({});
        } else if (targetDocId === activeDocId) {
          const nextId = remainingSorted[0].id;
          await set(KEY_ACTIVE_DOC_ID, nextId);
          const nextAssets = await loadDocAssetsFromDb(nextId);
          setDocuments(remaining);
          setActiveDocId(nextId);
          setActiveDocAssets(nextAssets);
        } else {
          setDocuments(remaining);
        }
        setSaveStatus("saved");
      } catch (err) {
        handleStorageError(err, "Failed to delete document");
      }
    },
    [
      activeDocId,
      documents,
      flushPendingSave,
      handleStorageError,
      loadDocAssetsFromDb,
    ]
  );

  const deleteAllDocuments = useCallback(async () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    pendingSaveRef.current = null;

    try {
      const allKeys = await keys();
      const keysToDelete = allKeys.filter(
        (k): k is string =>
          typeof k === "string" &&
          (k.startsWith(KEY_PREFIX_DOC) || k.startsWith(KEY_PREFIX_DOC_ASSET))
      );
      if (keysToDelete.length > 0) {
        await delMany(keysToDelete);
      }

      const currentLocale = localeRef.current;
      const untitledTitle = getDictionary(currentLocale).common.untitledDocument;
      const freshId = createDocId();
      const freshDoc: StoredDocument = {
        id: freshId,
        title: untitledTitle,
        markdown: buildBlankMarkdown(untitledTitle, currentLocale),
        updatedAt: Date.now(),
        assetSizes: {},
      };
      await set(`${KEY_PREFIX_DOC}${freshId}`, freshDoc);
      await set(KEY_ACTIVE_DOC_ID, freshId);

      setDocuments({ [freshId]: freshDoc });
      setActiveDocId(freshId);
      setActiveDocAssets({});
      setSaveStatus("saved");
    } catch (err) {
      handleStorageError(err, "Failed to delete all documents");
    }
  }, [handleStorageError]);

  const getExpandedMarkdownForDoc = useCallback(
    async (docId: string): Promise<{ title: string; content: string } | null> => {
      const target = documents[docId];
      if (!target) return null;

      const docAssets =
        docId === activeDocId
          ? activeDocAssets
          : await loadDocAssetsFromDb(docId);
      const mergedAssets = { ...sharedAssets, ...docAssets };

      const expanded = target.markdown.replace(
        /(!\[[^\]]*\]\()([^)\s]+)(\))/g,
        (match, prefix: string, rawSrc: string, suffix: string) => {
          if (
            rawSrc.startsWith("http://") ||
            rawSrc.startsWith("https://") ||
            rawSrc.startsWith("data:")
          ) {
            return match;
          }
          const resolved = resolveAssetSrc(rawSrc, mergedAssets);
          return resolved && resolved !== rawSrc
            ? `${prefix}${resolved}${suffix}`
            : match;
        }
      );

      return { title: target.title || "document", content: expanded };
    },
    [activeDocAssets, activeDocId, documents, loadDocAssetsFromDb, sharedAssets]
  );

  const updatePrefs = useCallback(
    async (patch: Partial<UiPreferences>) => {
      const nextPrefs = { ...prefs, ...patch };
      setPrefsState(nextPrefs);
      try {
        await set(KEY_PREFS, nextPrefs);
      } catch (err) {
        handleStorageError(err, "Failed to save preferences");
      }
    },
    [handleStorageError, prefs]
  );

  const resetToSample = useCallback(async () => {
    setMarkdown(getSampleMarkdown(localeRef.current));
  }, [setMarkdown]);

  return {
    markdown,
    setMarkdown,
    activeDocId,
    documentList,
    sharedAssetList,
    assets,
    saveAsset,
    saveAssetsBatch: saveDocAssetsBatch,
    removeAsset,
    clearSharedAssets,
    switchDocument,
    createDocument,
    deleteDocument,
    deleteAllDocuments,
    getExpandedMarkdownForDoc,
    prefs,
    updatePrefs,
    resetToSample,
    isLoaded,
    saveStatus,
    storageError,
    clearStorageError: () => setStorageError(null),
  };
}
