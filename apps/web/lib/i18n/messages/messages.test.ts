import { describe, expect, it } from "vitest";
import { LOCALES, type Locale } from "../locales";
import { MESSAGES } from "./index";

type Leaf = string | ((...args: string[]) => string);

/** Values that may legitimately read the same as English, as `<path>` → locales. */
const SAME_AS_ENGLISH: Record<string, readonly Locale[]> = {
  "common.app.name": ["pt-PT", "es", "ca", "it"],
  "common.roles.admin": ["pt-PT", "es", "ca", "it"],
  "auth.email": ["it"],
  "auth.password": ["it"],
  "admin.users.email": ["it"],
  "admin.users.quota": ["pt-PT", "ca", "it"],
};

const SAMPLE_ARGS = ["alice@example.test", "Admin", "13 Oct 2026"];

function walk(value: unknown, path: string[], visit: (path: string, leaf: Leaf) => void): void {
  if (typeof value === "string" || typeof value === "function") {
    visit(path.join("."), value as Leaf);
    return;
  }
  expect(typeof value, path.join(".")).toBe("object");
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    walk(child, [...path, key], visit);
  }
}

function leaves(locale: Locale): Map<string, Leaf> {
  const map = new Map<string, Leaf>();
  walk(MESSAGES[locale], [], (path, leaf) => map.set(path, leaf));
  return map;
}

/** The text a person would read: a string as is, a function called with sample arguments. */
function render(leaf: Leaf): string {
  return typeof leaf === "function" ? leaf(...SAMPLE_ARGS.slice(0, leaf.length)) : leaf;
}

const english = leaves("en");

describe("messages", () => {
  it("has the namespaces every locale must supply", () => {
    for (const locale of LOCALES) {
      expect(Object.keys(MESSAGES[locale]).sort(), locale).toEqual(Object.keys(MESSAGES.en).sort());
    }
  });

  it("has a non-trivial English source", () => {
    expect(english.size).toBeGreaterThan(80);
  });

  for (const locale of LOCALES) {
    describe(locale, () => {
      const own = leaves(locale);

      it("has exactly the keys of English", () => {
        expect([...own.keys()].sort()).toEqual([...english.keys()].sort());
      });

      it("has no empty strings and every function returns text", () => {
        for (const [path, leaf] of own) {
          expect(render(leaf).trim(), path).not.toBe("");
        }
      });

      it("keeps the kind of every value (string or function with the same arguments)", () => {
        for (const [path, leaf] of own) {
          const source = english.get(path);
          expect(typeof leaf, path).toBe(typeof source);
          if (typeof leaf === "function" && typeof source === "function") {
            expect(leaf.length, path).toBe(source.length);
          }
        }
      });

      it("puts every argument of a parameterised string into the text", () => {
        for (const [path, leaf] of own) {
          if (typeof leaf === "function") {
            const text = render(leaf);
            for (const arg of SAMPLE_ARGS.slice(0, leaf.length)) {
              expect(text, path).toContain(arg);
            }
          }
        }
      });

      if (locale !== "en") {
        it("is translated: nothing reads like English unless listed", () => {
          const untranslated: string[] = [];
          for (const [path, leaf] of own) {
            const source = english.get(path);
            if (source !== undefined && render(leaf) === render(source)) {
              if (!SAME_AS_ENGLISH[path]?.includes(locale)) {
                untranslated.push(path);
              }
            }
          }
          expect(untranslated).toEqual([]);
        });
      }
    });
  }

  it("lists only exceptions that are real (no stale allowlist entries)", () => {
    for (const [path, allowed] of Object.entries(SAME_AS_ENGLISH)) {
      const source = english.get(path);
      expect(source, path).toBeDefined();
      for (const locale of allowed) {
        const own = leaves(locale).get(path);
        expect(own === undefined ? undefined : render(own), `${locale} ${path}`).toBe(
          source === undefined ? undefined : render(source),
        );
      }
    }
  });

  it("keeps European Portuguese, Catalan and Spanish apart", () => {
    expect(MESSAGES["pt-PT"].auth.loginNoAccount).toContain("ligação");
    expect(MESSAGES["pt-PT"].common.nav.files).toBe("Ficheiros");
    expect(MESSAGES.es.common.nav.files).toBe("Archivos");
    expect(MESSAGES.ca.common.nav.files).toBe("Fitxers");
  });
});
