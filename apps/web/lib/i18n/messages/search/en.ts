import type { Widen } from "../../types";
import { isOne } from "../../plural";

export const en = {
  title: "Search",
  field: {
    label: "Search files",
    placeholder: "Search by name…",
    submit: "Search",
  },
  idle: "Type part of a file or folder name to find it.",
  searching: "Searching…",
  count: (n: number, q: string) =>
    isOne("en", n) ? `${n} result for “${q}”` : `${n} results for “${q}”`,
  none: {
    title: (q: string) => `Nothing found for “${q}”`,
    hint: "Check the spelling, or try a shorter part of the name.",
  },
  limited: (n: number) =>
    `Showing the first ${n} matches. Type more of the name to narrow them down.`,
  caption: (q: string) => `Results for ${q}`,
  location: "Location",
  pathLabel: (name: string) => `Where ${name} is`,
  preview: {
    controls: "Preview controls",
    previous: "Previous file",
    next: "Next file",
    position: (n: number, total: number) => `${n} of ${total}`,
    download: "Download",
    loading: "Loading the preview…",
    truncated: (shown: string, total: string) =>
      `Showing the first ${shown} of ${total}. Download the file to read all of it.`,
    empty: "This file is empty.",
    unavailable: "This type of file can't be shown here. You can download it instead.",
  },
};

export type Search = Widen<typeof en>;
