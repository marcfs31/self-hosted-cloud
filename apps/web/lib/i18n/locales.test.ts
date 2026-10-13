import { describe, expect, it } from "vitest";
import { DEFAULT_LOCALE, LOCALES, LOCALE_NAMES, isLocale, resolveLocale } from "./locales";

describe("resolveLocale", () => {
  it("falls back to English with no cookie and no header", () => {
    expect(resolveLocale(undefined, undefined)).toBe(DEFAULT_LOCALE);
    expect(resolveLocale(null, "")).toBe("en");
  });

  it("prefers the cookie over the header", () => {
    expect(resolveLocale("it", "es,en;q=0.8")).toBe("it");
  });

  it("matches the cookie exactly, ignoring case", () => {
    for (const locale of LOCALES) {
      expect(resolveLocale(locale, undefined)).toBe(locale);
    }
    expect(resolveLocale("pt-pt", undefined)).toBe("pt-PT");
  });

  it("ignores a cookie it does not recognise", () => {
    expect(resolveLocale("klingon", "ca")).toBe("ca");
    expect(resolveLocale("fr", undefined)).toBe("en");
  });

  it("maps regional variants to the base language", () => {
    expect(resolveLocale(undefined, "pt-BR")).toBe("pt-PT");
    expect(resolveLocale(undefined, "pt")).toBe("pt-PT");
    expect(resolveLocale(undefined, "es-MX")).toBe("es");
    expect(resolveLocale(undefined, "ca-ES")).toBe("ca");
    expect(resolveLocale(undefined, "it-CH")).toBe("it");
    expect(resolveLocale(undefined, "en-GB")).toBe("en");
  });

  it("picks the highest q-value, not the first listed", () => {
    expect(resolveLocale(undefined, "en;q=0.5, es;q=0.9")).toBe("es");
    expect(resolveLocale(undefined, "fr, it;q=0.8, ca;q=0.7")).toBe("it");
  });

  it("keeps the header order between equal q-values", () => {
    expect(resolveLocale(undefined, "ca, es")).toBe("ca");
  });

  it("skips unsupported languages and wildcards", () => {
    expect(resolveLocale(undefined, "fr-FR, de;q=0.9, *;q=0.5, ca;q=0.3")).toBe("ca");
    expect(resolveLocale(undefined, "fr-FR, de;q=0.9")).toBe("en");
  });

  it("treats q=0 as refused and survives malformed input", () => {
    expect(resolveLocale(undefined, "es;q=0, en")).toBe("en");
    expect(resolveLocale(undefined, "es;q=0")).toBe("en");
    expect(resolveLocale(undefined, ";;,,q=x, it;q=abc")).toBe("en");
  });
});

describe("locale tables", () => {
  it("names every locale in itself", () => {
    expect(Object.keys(LOCALE_NAMES).sort()).toEqual([...LOCALES].sort());
    expect(LOCALE_NAMES["pt-PT"]).toBe("Português");
  });

  it("isLocale accepts only supported tags", () => {
    expect(isLocale("ca")).toBe(true);
    expect(isLocale("pt-BR")).toBe(false);
    expect(isLocale(3)).toBe(false);
  });
});
