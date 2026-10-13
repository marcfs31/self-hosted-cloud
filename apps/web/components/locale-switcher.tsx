"use client";

import { useRouter } from "next/navigation";
import { useId, type ChangeEvent } from "react";
import { LOCALES, LOCALE_COOKIE, LOCALE_NAMES, isLocale } from "../lib/i18n/locales";
import { useLocale, useT } from "../lib/i18n/provider";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export function LocaleSwitcher() {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const id = useId();

  function onChange(event: ChangeEvent<HTMLSelectElement>) {
    const next = event.target.value;
    if (!isLocale(next)) {
      return;
    }
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${LOCALE_COOKIE}=${next}; Path=/; Max-Age=${ONE_YEAR_SECONDS}; SameSite=Lax${secure}`;
    router.refresh();
  }

  return (
    <div className="locale-switcher">
      <label htmlFor={id}>{t.common.localeSwitcher.label}</label>
      <select id={id} value={locale} onChange={onChange}>
        {LOCALES.map((l) => (
          <option key={l} value={l} lang={l}>
            {LOCALE_NAMES[l]}
          </option>
        ))}
      </select>
    </div>
  );
}
