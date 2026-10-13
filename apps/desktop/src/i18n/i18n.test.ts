import { describe, expect, it } from "vitest";
import { dictionaries, dictionaryFor, format, resolveLocale, type LocaleId } from "./index.js";

function flatten(value: unknown, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    if (typeof child === "string") out.set(path, child);
    else for (const [p, v] of flatten(child, path)) out.set(p, v);
  }
  return out;
}

const placeholders = (text: string): string[] => (text.match(/\{\w+\}/g) ?? []).sort();
/** What is left to translate once placeholders and the product name are taken out. */
const letters = (text: string): string =>
  text
    .replace(/\{\w+\}/g, "")
    .replaceAll("Cloud", "")
    .replace(/[^\p{L}]/gu, "");

/** Values that are genuinely the same word in that language ("Error" in Spanish and Catalan). */
const SAME_AS_ENGLISH = new Set(["es:tray.statusError", "ca:tray.statusError"]);

const source = flatten(dictionaries.en);
const others = (Object.keys(dictionaries) as LocaleId[]).filter((id) => id !== "en");

describe("dictionaries", () => {
  it("covers the five locales", () => {
    expect(Object.keys(dictionaries).sort()).toEqual(["ca", "en", "es", "it", "pt-PT"]);
  });

  it("has no empty value in English", () => {
    for (const [key, value] of source) expect(value.trim(), key).not.toBe("");
  });

  for (const id of others) {
    describe(id, () => {
      const flat = flatten(dictionaries[id]);

      it("has exactly the keys of English", () => {
        expect([...flat.keys()].sort()).toEqual([...source.keys()].sort());
      });

      it("has no empty value and keeps every placeholder", () => {
        for (const [key, value] of flat) {
          expect(value.trim(), key).not.toBe("");
          expect(placeholders(value), key).toEqual(placeholders(source.get(key) ?? ""));
        }
      });

      it("has translated every value", () => {
        for (const [key, value] of flat) {
          if (letters(value) === "") continue; // only placeholders and the product name
          if (SAME_AS_ENGLISH.has(`${id}:${key}`)) continue;
          expect(value, key).not.toBe(source.get(key));
        }
      });
    });
  }
});

describe("resolveLocale", () => {
  it.each([
    ["en", "en"],
    ["en-US", "en"],
    ["pt-PT", "pt-PT"],
    ["pt_PT", "pt-PT"],
    ["pt-BR", "pt-PT"],
    ["pt", "pt-PT"],
    ["es-419", "es"],
    ["es-ES", "es"],
    ["ca", "ca"],
    ["ca-ES", "ca"],
    ["it-IT", "it"],
    ["IT", "it"],
  ] as const)("%s → %s", (given, expected) => {
    expect(resolveLocale(given)).toBe(expected);
  });

  it("falls back to English for an unsupported or empty locale", () => {
    expect(resolveLocale("de-DE")).toBe("en");
    expect(resolveLocale("zh-Hans-CN")).toBe("en");
    expect(resolveLocale("")).toBe("en");
    expect(dictionaryFor("fr")).toBe(dictionaries.en);
  });
});

describe("format", () => {
  it("fills placeholders and leaves unknown ones visible", () => {
    expect(format("Syncing {count} files", { count: 3 })).toBe("Syncing 3 files");
    expect(format("{a} and {b}", { a: "x" })).toBe("x and {b}");
  });
});
