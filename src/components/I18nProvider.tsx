"use client";

import React, { createContext, useContext, useEffect, useMemo } from "react";
import {
  formatMessage,
  getDictionary,
  type Locale,
  type LocaleDictionary,
} from "@/lib/i18n";

export interface I18nContextValue {
  locale: Locale;
  dict: LocaleDictionary;
  format: typeof formatMessage;
}

const DEFAULT_I18N_VALUE: I18nContextValue = {
  locale: "ja",
  dict: getDictionary("ja"),
  format: formatMessage,
};

const I18nContext = createContext<I18nContextValue>(DEFAULT_I18N_VALUE);

interface I18nProviderProps {
  locale: Locale;
  children: React.ReactNode;
}

export function I18nProvider({ locale, children }: I18nProviderProps) {
  useEffect(() => {
    if (typeof document !== "undefined" && document.documentElement) {
      document.documentElement.lang = locale;
    }
  }, [locale]);

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      dict: getDictionary(locale),
      format: formatMessage,
    }),
    [locale]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}
