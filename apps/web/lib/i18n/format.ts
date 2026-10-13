import type { Locale } from "./locales";

const GIB = 1024 ** 3;
const UNITS = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"] as const;

function trim(value: number, digits: number): number {
  return Number(value.toFixed(digits));
}

/**
 * Binary units with at most one decimal in the locale's number format:
 * 1610612736 → "1.5 GiB" (en), "1,5 GiB" (es).
 */
export function formatBytes(bytes: number, locale: Locale): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return `${new Intl.NumberFormat(locale).format(0)} B`;
  }
  let unit = 0;
  let value = bytes;
  while (unit < UNITS.length - 1 && value >= 1024) {
    value /= 1024;
    unit += 1;
  }
  // 1048575 B rounds to "1024 KiB"; show "1 MiB" instead.
  if (unit < UNITS.length - 1 && trim(value, 1) >= 1024) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 ? 0 : 1;
  const text = new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(
    trim(value, digits),
  );
  return `${text} ${UNITS[unit] ?? "B"}`;
}

/**
 * Parses a quota typed as GiB ("50", "1.5", "0,5") into whole bytes.
 * Returns null for anything that is not a non-negative decimal number.
 */
export function parseGiB(input: string): number | null {
  const text = input.trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(text)) {
    return null;
  }
  const bytes = Math.round(Number(text) * GIB);
  return Number.isSafeInteger(bytes) ? bytes : null;
}

/** The inverse of parseGiB for pre-filling an input: 107374182400 → "100". */
export function toGiBInput(bytes: number): string {
  return String(trim(bytes / GIB, 2));
}

export function formatDate(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(iso));
}

export function formatDateTime(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(iso),
  );
}
