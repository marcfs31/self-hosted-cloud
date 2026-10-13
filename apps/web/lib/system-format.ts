import type { Locale } from "./i18n/locales";

const MINUTE = 60;
const HOUR = 3600;
const DAY = 86400;

type DurationUnit = "day" | "hour" | "minute" | "second";

/**
 * "3 days, 4 hours": the largest unit that is not zero and the one below it when that is not
 * zero either. Under a minute it counts seconds, so a fresh boot never reads "0 minutes".
 */
export function formatDuration(seconds: number, locale: Locale): string {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const units: [DurationUnit, number][] = [
    ["day", Math.floor(total / DAY)],
    ["hour", Math.floor((total % DAY) / HOUR)],
    ["minute", Math.floor((total % HOUR) / MINUTE)],
  ];
  const first = units.findIndex(([, value]) => value > 0);
  const parts: [DurationUnit, number][] = [];
  if (first === -1) {
    parts.push(["second", total]);
  } else {
    for (const part of units.slice(first, first + 2)) {
      if (part[1] > 0) {
        parts.push(part);
      }
    }
  }
  const items = parts.map(([unit, value]) =>
    new Intl.NumberFormat(locale, { style: "unit", unit, unitDisplay: "long" }).format(value),
  );
  return new Intl.ListFormat(locale, { style: "long", type: "unit" }).format(items);
}

/**
 * "3 hours ago", "yesterday", "now". A time slightly in the future (clock skew between the
 * host and this browser) reads as "now" rather than "in 2 minutes".
 */
export function formatRelative(iso: string, nowMs: number, locale: Locale): string {
  const seconds = Math.min(Math.round((Date.parse(iso) - nowMs) / 1000), 0);
  const age = -seconds;
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (age < 45) {
    return rtf.format(0, "second");
  }
  if (age < 45 * MINUTE) {
    return rtf.format(-Math.max(1, Math.round(age / MINUTE)), "minute");
  }
  if (age < 36 * HOUR) {
    return rtf.format(-Math.max(1, Math.round(age / HOUR)), "hour");
  }
  return rtf.format(-Math.round(age / DAY), "day");
}

/** Whole seconds between a report and now, never negative. */
export function secondsSince(iso: string, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - Date.parse(iso)) / 1000));
}

/** used / total as a share in [0, 1]; an empty total reads as 0 rather than NaN. */
export function share(used: number, total: number): number {
  if (!(total > 0)) {
    return 0;
  }
  return Math.min(Math.max(used / total, 0), 1);
}

export function formatNumber(value: number, locale: Locale, maximumFractionDigits = 1): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits }).format(value);
}

export function formatCelsius(value: number, locale: Locale): string {
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: "celsius",
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatTime(ms: number, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { timeStyle: "medium" }).format(new Date(ms));
}
