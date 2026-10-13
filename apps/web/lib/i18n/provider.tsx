"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { formatBytes, formatDate, formatDateTime } from "./format";
import type { Locale } from "./locales";
import { MESSAGES, type Messages } from "./messages";

export interface Format {
  /** Binary units in the locale's number format: "1,5 GiB". */
  bytes: (bytes: number) => string;
  date: (iso: string) => string;
  dateTime: (iso: string) => string;
}

interface I18n {
  locale: Locale;
  t: Messages;
  format: Format;
}

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const value = useMemo<I18n>(
    () => ({
      locale,
      t: MESSAGES[locale],
      format: {
        bytes: (bytes) => formatBytes(bytes, locale),
        date: (iso) => formatDate(iso, locale),
        dateTime: (iso) => formatDateTime(iso, locale),
      },
    }),
    [locale],
  );
  return <I18nContext value={value}>{children}</I18nContext>;
}

function useI18n(): I18n {
  const value = useContext(I18nContext);
  if (!value) {
    throw new Error("useT, useLocale and useFormat must be used inside <I18nProvider>");
  }
  return value;
}

/** The copy for the current locale: `const t = useT(); t.auth.loginTitle`. */
export function useT(): Messages {
  return useI18n().t;
}

export function useLocale(): Locale {
  return useI18n().locale;
}

export function useFormat(): Format {
  return useI18n().format;
}
