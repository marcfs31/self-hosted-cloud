import type { PhotoItem } from "@cloud/shared";
import type { Locale } from "./i18n/locales";

export interface MonthGroup {
  /** "2026-10" in the viewer's time zone: the month a photo belongs to under its heading. */
  key: string;
  /** "October 2026" in the viewer's language. */
  label: string;
  items: readonly PhotoItem[];
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/** "October 2026" / "octubre de 2026", with the first letter capitalised for a heading. */
export function formatMonthYear(date: Date, locale: Locale): string {
  const text = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(date);
  return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);
}

/**
 * Splits photos into runs of the same month, keeping their order (so newest-first stays
 * newest-first and an album's oldest-first stays oldest-first). A month that comes back later
 * in the list gets a second group rather than being moved, so the order never lies.
 */
export function groupByMonth(items: readonly PhotoItem[], locale: Locale): MonthGroup[] {
  const groups: { key: string; label: string; items: PhotoItem[] }[] = [];
  for (const item of items) {
    const date = new Date(item.takenAt);
    const key = monthKey(date);
    const last = groups.at(-1);
    if (last?.key === key) {
      last.items.push(item);
    } else {
      groups.push({ key, label: formatMonthYear(date, locale), items: [item] });
    }
  }
  return groups;
}

/** The loaded photos plus a new page, without the ones already there (a repeated id is kept once). */
export function appendPage(
  loaded: readonly PhotoItem[],
  page: readonly PhotoItem[],
): readonly PhotoItem[] {
  const known = new Set(loaded.map((item) => item.fileId));
  const fresh = page.filter((item) => !known.has(item.fileId));
  return fresh.length === 0 ? loaded : [...loaded, ...fresh];
}

/** The id before or after `fileId` in `items`, or null at either end or when it is not in the list. */
export function neighbour(
  items: readonly PhotoItem[],
  fileId: string,
  step: -1 | 1,
): PhotoItem | null {
  const index = items.findIndex((item) => item.fileId === fileId);
  return index === -1 ? null : (items[index + step] ?? null);
}
