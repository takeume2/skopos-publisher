import type { LayoutMode } from "@/hooks/useIndexedDbStorage";
import { isLocale, type Locale } from "@/lib/i18n";

export const PREVIEW_SYNC_CHANNEL_NAME = "skopos-preview-sync:v1";
export const PREVIEW_SESSION_STORAGE_KEY = "skopos:preview_session_id:v1";

export interface SyncedPreviewPrefs {
  autoUpdate: boolean;
  showMarginGuides: boolean;
  layoutMode: LayoutMode;
  locale?: Locale;
  skipPrintHeaderFooterNotice?: boolean;
  enablePreflightCheck?: boolean;
  preflightNgWords?: string;
}

export type PreviewSyncMessage =
  | {
      type: "sync-state";
      sessionId: string;
      documentId: string;
      markdown: string;
      exportBasename: string;
      prefs: SyncedPreviewPrefs;
      assetsVersion: number;
      parentWindowName?: string;
    }
  | {
      type: "assets-updated";
      sessionId: string;
      documentId: string;
      assetsVersion: number;
    }
  | {
      type: "parent-hello";
      sessionId: string;
    }
  | {
      type: "parent-disconnected";
      sessionId: string;
    }
  | {
      type: "focus-preview";
      sessionId: string;
    }
  | {
      type: "close-preview";
      sessionId: string;
    }
  | {
      type: "preview-ready";
      sessionId: string;
    }
  | {
      type: "preview-closed";
      sessionId: string;
    }
  | {
      type: "update-prefs";
      sessionId: string;
      patch: Partial<SyncedPreviewPrefs>;
    }
  | {
      type: "jump-to-line";
      sessionId: string;
      line: number;
    };

function generateRandomSessionId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Returns a tab-scoped session ID persisted in sessionStorage so reloading the
 * parent editor tab keeps the same sessionId and reconnects to an existing popout,
 * while separate browser tabs remain isolated.
 */
export function getOrCreatePreviewSessionId(): string {
  try {
    if (typeof window !== "undefined" && window.sessionStorage) {
      const existing = window.sessionStorage.getItem(
        PREVIEW_SESSION_STORAGE_KEY
      );
      if (existing && existing.trim()) {
        return existing.trim();
      }
      const created = generateRandomSessionId();
      window.sessionStorage.setItem(PREVIEW_SESSION_STORAGE_KEY, created);
      return created;
    }
  } catch {
    // Fallback when sessionStorage is unavailable (e.g. restricted storage policy)
  }
  return generateRandomSessionId();
}

export function buildPreviewPopoutUrl(sessionId: string): string {
  return `/preview?session=${encodeURIComponent(sessionId)}`;
}

export function buildParentWindowName(sessionId: string): string {
  return `skopos_editor_${sessionId}`;
}

export function createPreviewSyncChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel !== "function") {
    return null;
  }
  try {
    return new BroadcastChannel(PREVIEW_SYNC_CHANNEL_NAME);
  } catch {
    return null;
  }
}

function isLayoutMode(value: unknown): value is LayoutMode {
  return value === "single" || value === "spread";
}

function isSyncedPreviewPrefs(value: unknown): value is SyncedPreviewPrefs {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  if (
    typeof obj.autoUpdate !== "boolean" ||
    typeof obj.showMarginGuides !== "boolean" ||
    !isLayoutMode(obj.layoutMode)
  ) {
    return false;
  }
  if (
    obj.locale !== undefined &&
    !isLocale(obj.locale)
  ) {
    return false;
  }
  if (
    obj.skipPrintHeaderFooterNotice !== undefined &&
    typeof obj.skipPrintHeaderFooterNotice !== "boolean"
  ) {
    return false;
  }
  if (
    obj.enablePreflightCheck !== undefined &&
    typeof obj.enablePreflightCheck !== "boolean"
  ) {
    return false;
  }
  if (
    obj.preflightNgWords !== undefined &&
    typeof obj.preflightNgWords !== "string"
  ) {
    return false;
  }
  return true;
}

/**
 * Validates an incoming BroadcastChannel payload and enforces strict sessionId isolation.
 */
export function parsePreviewSyncMessage(
  data: unknown,
  expectedSessionId: string
): PreviewSyncMessage | null {
  if (!expectedSessionId || !data || typeof data !== "object") return null;
  const msg = data as Record<string, unknown>;
  if (msg.sessionId !== expectedSessionId || typeof msg.type !== "string") {
    return null;
  }

  switch (msg.type) {
    case "sync-state":
      if (
        typeof msg.documentId === "string" &&
        typeof msg.markdown === "string" &&
        typeof msg.exportBasename === "string" &&
        typeof msg.assetsVersion === "number" &&
        isSyncedPreviewPrefs(msg.prefs) &&
        (msg.parentWindowName === undefined ||
          typeof msg.parentWindowName === "string")
      ) {
        return {
          type: "sync-state",
          sessionId: expectedSessionId,
          documentId: msg.documentId,
          markdown: msg.markdown,
          exportBasename: msg.exportBasename,
          prefs: msg.prefs,
          assetsVersion: msg.assetsVersion,
          ...(typeof msg.parentWindowName === "string"
            ? { parentWindowName: msg.parentWindowName }
            : {}),
        };
      }
      return null;

    case "assets-updated":
      if (
        typeof msg.documentId === "string" &&
        typeof msg.assetsVersion === "number"
      ) {
        return {
          type: "assets-updated",
          sessionId: expectedSessionId,
          documentId: msg.documentId,
          assetsVersion: msg.assetsVersion,
        };
      }
      return null;

    case "parent-hello":
    case "parent-disconnected":
    case "focus-preview":
    case "close-preview":
    case "preview-ready":
    case "preview-closed":
      return {
        type: msg.type,
        sessionId: expectedSessionId,
      };

    case "update-prefs": {
      if (!msg.patch || typeof msg.patch !== "object") return null;
      const rawPatch = msg.patch as Record<string, unknown>;
      const patch: Partial<SyncedPreviewPrefs> = {};
      if (typeof rawPatch.autoUpdate === "boolean") {
        patch.autoUpdate = rawPatch.autoUpdate;
      }
      if (typeof rawPatch.showMarginGuides === "boolean") {
        patch.showMarginGuides = rawPatch.showMarginGuides;
      }
      if (isLayoutMode(rawPatch.layoutMode)) {
        patch.layoutMode = rawPatch.layoutMode;
      }
      if (typeof rawPatch.skipPrintHeaderFooterNotice === "boolean") {
        patch.skipPrintHeaderFooterNotice =
          rawPatch.skipPrintHeaderFooterNotice;
      }
      if (Object.keys(patch).length === 0) return null;
      return {
        type: "update-prefs",
        sessionId: expectedSessionId,
        patch,
      };
    }

    case "jump-to-line":
      if (
        typeof msg.line === "number" &&
        Number.isInteger(msg.line) &&
        msg.line >= 1
      ) {
        return {
          type: "jump-to-line",
          sessionId: expectedSessionId,
          line: msg.line,
        };
      }
      return null;

    default:
      return null;
  }
}
