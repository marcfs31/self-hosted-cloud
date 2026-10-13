import type { Widen } from "../../types";
import { isOne } from "../../plural";

export const en = {
  title: "Trash",
  loading: "Loading the trash…",
  caption: "Items in the trash",
  name: "Name",
  size: "Size",
  trashed: "Moved to trash",
  actions: "Actions",
  folder: "Folder",
  empty: {
    title: "The trash is empty",
    hint: "Items you move to the trash wait here before they are deleted for good.",
  },
  retention: (days: number) =>
    isOne("en", days)
      ? `Items stay in the trash for ${days} day, then they are deleted for good.`
      : `Items stay in the trash for ${days} days, then they are deleted for good.`,
  restore: "Restore",
  restoreLabel: (name: string) => `Restore ${name}`,
  deleteForever: "Delete forever",
  deleteForeverLabel: (name: string) => `Delete ${name} forever`,
  emptyTrash: "Empty trash",
  confirm: {
    cancel: "Cancel",
    deleteTitle: "Delete forever?",
    deleteBody: (name: string) =>
      `${name} and everything inside it will be deleted for good. This can't be undone.`,
    deleteSubmit: "Delete forever",
    deleting: "Deleting…",
    emptyTitle: "Empty the trash?",
    emptyBody: (n: number) =>
      isOne("en", n)
        ? `${n} item will be deleted for good. This can't be undone.`
        : `${n} items will be deleted for good. This can't be undone.`,
    emptySubmit: "Empty trash",
    emptying: "Emptying…",
  },
  notices: {
    restored: (name: string) => `Restored ${name}`,
    deleted: (name: string) => `Deleted ${name} for good`,
    emptied: "The trash is empty now.",
  },
};

export type Trash = Widen<typeof en>;
