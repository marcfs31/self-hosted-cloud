import type { Locale } from "./locales";

const rules = new Map<Locale, Intl.PluralRules>();

/**
 * True when `count` takes the singular form in `locale` ("1 file"). Every shipped locale
 * has just a singular and a plural form for the counts the app shows.
 */
export function isOne(locale: Locale, count: number): boolean {
  let pluralRules = rules.get(locale);
  if (!pluralRules) {
    pluralRules = new Intl.PluralRules(locale);
    rules.set(locale, pluralRules);
  }
  return pluralRules.select(count) === "one";
}
