export const LOCALES = ["en", "pt-PT", "es", "ca", "it"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "locale";

/** Each language written in itself, so a reader can always find theirs. */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  "pt-PT": "Português",
  es: "Español",
  ca: "Català",
  it: "Italiano",
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** An exact match first, then the first supported locale with the same base language. */
function matchTag(tag: string): Locale | null {
  const wanted = tag.trim().toLowerCase();
  if (wanted === "" || wanted === "*") {
    return null;
  }
  const exact = LOCALES.find((l) => l.toLowerCase() === wanted);
  if (exact) {
    return exact;
  }
  const base = wanted.split("-")[0];
  return LOCALES.find((l) => l.toLowerCase().split("-")[0] === base) ?? null;
}

/** Language tags from an Accept-Language header, best first. A q of 0 means "not acceptable". */
function acceptedTags(header: string): string[] {
  return header
    .split(",")
    .map((part, index) => {
      const [tag = "", ...params] = part.split(";");
      const qParam = params.map((p) => p.trim()).find((p) => p.toLowerCase().startsWith("q="));
      const q = qParam === undefined ? 1 : Number(qParam.slice(2));
      return { tag: tag.trim(), q: Number.isFinite(q) ? q : 0, index };
    })
    .filter((entry) => entry.tag !== "" && entry.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index)
    .map((entry) => entry.tag);
}

/** The cookie wins (the person chose it), then the browser's languages, then English. */
export function resolveLocale(
  cookieValue: string | null | undefined,
  acceptLanguage: string | null | undefined,
): Locale {
  const fromCookie = cookieValue ? matchTag(cookieValue) : null;
  if (fromCookie) {
    return fromCookie;
  }
  for (const tag of acceptLanguage ? acceptedTags(acceptLanguage) : []) {
    const match = matchTag(tag);
    if (match) {
      return match;
    }
  }
  return DEFAULT_LOCALE;
}
