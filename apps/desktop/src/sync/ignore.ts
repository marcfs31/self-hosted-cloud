/** Names that are never synced: OS litter, lock files, temp files and the app's own temp files. */
export const TEMP_PREFIX = ".cloud-tmp-";

const IGNORED_NAMES = new Set([".ds_store", "thumbs.db", "desktop.ini", ".cloud-trash"]);

export function isIgnoredName(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    IGNORED_NAMES.has(lower) ||
    name.startsWith("._") ||
    name.startsWith("~$") ||
    name.startsWith(TEMP_PREFIX) ||
    lower.endsWith(".tmp")
  );
}

/** True when any segment of a relative path is ignored (an ignored folder hides its subtree). */
export function isIgnoredPath(path: string): boolean {
  return path.split("/").some(isIgnoredName);
}
