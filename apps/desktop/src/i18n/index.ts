import { ca } from "./ca.js";
import { en, type Dictionary } from "./en.js";
import { es } from "./es.js";
import { it } from "./it.js";
import { ptPT } from "./pt-PT.js";

export type { Dictionary } from "./en.js";

export const dictionaries = { en, "pt-PT": ptPT, es, ca, it } satisfies Record<string, Dictionary>;
export type LocaleId = keyof typeof dictionaries;

/**
 * Picks a locale from app.getLocale() ("pt-PT", "en-US", "es-419", "ca", …): an exact match first,
 * then the base language, then English. Every Portuguese variant gets the European translation.
 */
export function resolveLocale(appLocale: string): LocaleId {
  const wanted = appLocale.trim().toLowerCase().replaceAll("_", "-");
  for (const id of Object.keys(dictionaries) as LocaleId[]) {
    if (id.toLowerCase() === wanted) return id;
  }
  const base = wanted.split("-")[0];
  if (base === "pt") return "pt-PT";
  for (const id of Object.keys(dictionaries) as LocaleId[]) {
    if (id.toLowerCase() === base) return id;
  }
  return "en";
}

export function dictionaryFor(appLocale: string): Dictionary {
  return dictionaries[resolveLocale(appLocale)];
}

/** Replaces {name} placeholders; a placeholder without a value is left visible rather than blanked. */
export function format(
  template: string,
  values: Readonly<Record<string, string | number>>,
): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => {
    const value = values[key];
    return value === undefined ? whole : String(value);
  });
}
