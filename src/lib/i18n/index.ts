import { EN_DICTIONARY } from "./en";
import { JA_DICTIONARY } from "./ja";
import type { Locale, LocaleDictionary } from "./types";

export type { Locale, LocaleDictionary } from "./types";
export { JA_DICTIONARY, EN_DICTIONARY };

export const SUPPORTED_LOCALES: readonly Locale[] = ["ja", "en"] as const;

export function isLocale(value: unknown): value is Locale {
  return value === "ja" || value === "en";
}

/**
 * Detects initial UI locale from browser language.
 * Japanese locales ("ja", "ja-JP", etc.) map to "ja"; all others
 * (including Sri Lanka "en-LK", "en-GB", "en-US", "si-LK", "ta-LK") map to "en".
 */
export function detectBrowserLocale(language?: string | null): Locale {
  const raw =
    language !== undefined
      ? language
      : typeof navigator !== "undefined"
        ? navigator.language || navigator.languages?.[0] || ""
        : "";
  const normalized = (raw ?? "").trim().toLowerCase();
  if (normalized === "ja" || normalized.startsWith("ja-") || normalized.startsWith("ja_")) {
    return "ja";
  }
  return "en";
}

export function getDictionary(locale: Locale): LocaleDictionary {
  return locale === "en" ? EN_DICTIONARY : JA_DICTIONARY;
}

export function formatMessage(
  template: string,
  params?: Record<string, string | number>
): string {
  if (!params) return template;
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key: string) =>
    key in params ? String(params[key]) : match
  );
}
