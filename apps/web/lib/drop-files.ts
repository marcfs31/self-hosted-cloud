import type { DragEvent } from "react";

/** Whether a drag carries files from outside the page (not text or a link). */
export function dragHasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer.types).includes("Files");
}

/** Files dropped from the desktop; folders are left out because only files upload. */
export function droppedFiles(event: DragEvent): File[] {
  const files: File[] = [];
  for (const item of Array.from(event.dataTransfer.items)) {
    if (item.kind !== "file" || item.webkitGetAsEntry()?.isDirectory === true) {
      continue;
    }
    const file = item.getAsFile();
    if (file) {
      files.push(file);
    }
  }
  return files;
}
