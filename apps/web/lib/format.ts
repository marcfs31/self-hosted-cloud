const GIB = 1024 ** 3;
const UNITS = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"] as const;

function trim(value: number, digits: number): string {
  return String(Number(value.toFixed(digits)));
}

/** Binary units with at most one decimal: 1536 → "1.5 KiB", 1610612736 → "1.5 GiB". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "0 B";
  }
  let unit = 0;
  let value = bytes;
  while (unit < UNITS.length - 1 && value >= 1024) {
    value /= 1024;
    unit += 1;
  }
  // 1048575 B rounds to "1024 KiB"; show "1 MiB" instead.
  if (unit < UNITS.length - 1 && Number(value.toFixed(1)) >= 1024) {
    value /= 1024;
    unit += 1;
  }
  return `${trim(value, unit === 0 ? 0 : 1)} ${UNITS[unit] ?? "B"}`;
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
  return trim(bytes / GIB, 2);
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(iso));
}
