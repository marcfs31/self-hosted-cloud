import type { Io } from "./io.js";

const UNITS = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"] as const;

/** Binary units: 1536 -> "1.5 KiB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  let value = bytes;
  let unit = 0;
  while (Math.round(value * 10) / 10 >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(1)} ${UNITS[unit] ?? "B"}`;
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** Local time, minute precision: "2026-10-13 14:05". */
export function formatTime(iso: string): string {
  const d = new Date(iso);
  const date = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  return `${date} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** "/a/b" for ["a","b"], "/" for the root. */
export function formatPath(segments: readonly string[]): string {
  return `/${segments.join("/")}`;
}

export type Align = "left" | "right";

/** Space-padded columns; the last column is never padded so lines carry no trailing blanks. */
export function table(rows: readonly (readonly string[])[], align: readonly Align[]): string {
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, i) => {
      widths[i] = Math.max(widths[i] ?? 0, cell.length);
    });
  }
  return rows
    .map((row) =>
      row
        .map((cell, i) => {
          if (i === row.length - 1) return cell;
          const width = widths[i] ?? 0;
          return align[i] === "right" ? cell.padStart(width) : cell.padEnd(width);
        })
        .join("  "),
    )
    .join("\n");
}

export function printJson(io: Io, value: unknown): void {
  io.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
