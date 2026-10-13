/*
 * Sync paths are POSIX-style, relative to the sync root, NFC-normalised ("" is the root).
 * They are keys; the file system is always addressed through the scanned spelling.
 */

export function parentOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

export function baseOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function joinPath(dir: string, name: string): string {
  return dir === "" ? name : `${dir}/${name}`;
}

export function isUnder(path: string, dir: string): boolean {
  return dir === "" ? path !== "" : path.startsWith(`${dir}/`);
}

export function depthOf(path: string): number {
  let n = 1;
  for (const ch of path) if (ch === "/") n++;
  return n;
}

export function replacePrefix(path: string, from: string, to: string): string {
  return path === from ? to : to + path.slice(from.length);
}

const pad = (n: number): string => String(n).padStart(2, "0");

function safeDeviceName(name: string): string {
  let out = "";
  for (const ch of name) {
    const code = ch.charCodeAt(0);
    out += '/\\:*?"<>|'.includes(ch) || code < 0x20 || code === 0x7f ? "-" : ch;
  }
  return out.trim() || "device";
}

/** "report.pdf" → "report (conflicted copy MacBook 2026-10-13 14-05).pdf" (local time). */
export function conflictedName(name: string, deviceName: string, at: Date): string {
  const dot = name.lastIndexOf(".");
  const hasExt = dot > 0;
  const stem = hasExt ? name.slice(0, dot) : name;
  const ext = hasExt ? name.slice(dot) : "";
  const stamp = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}-${pad(at.getMinutes())}`;
  const suffix = ` (conflicted copy ${safeDeviceName(deviceName)} ${stamp})`;
  const room = Math.max(1, 255 - suffix.length - ext.length);
  let cut = stem.slice(0, room);
  if (/[\ud800-\udbff]$/.test(cut)) cut = cut.slice(0, -1);
  return `${cut}${suffix}${ext}`;
}
