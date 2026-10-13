"use client";

import { useState } from "react";
import type { FolderListing } from "@cloud/shared";
import { useT } from "../../lib/i18n/provider";
import { Dialog } from "../dialog";
import { FolderPicker, crumbLabel } from "./folder-picker";

interface FolderPickerDialogProps {
  title: string;
  /** The folder the picker opens in; null opens the person's root. */
  startFolderId: string | null;
  onPick: (folderId: string, folderName: string) => void;
  onClose: () => void;
  returnFocus: HTMLElement | null;
}

/** Choose a destination folder: the move dialog's picker, for pages that are not moving an item. */
export function FolderPickerDialog({
  title,
  startFolderId,
  onPick,
  onClose,
  returnFocus,
}: FolderPickerDialogProps) {
  const all = useT();
  const t = all.pwa.picker;
  const [listing, setListing] = useState<FolderListing | null>(null);
  const name = listing
    ? crumbLabel(listing.breadcrumbs.at(-1)?.name ?? "", all.files.rootName)
    : "";

  return (
    <Dialog title={title} onClose={onClose} returnFocus={returnFocus}>
      <p className="note">{t.hint}</p>
      <FolderPicker startFolderId={startFolderId} onListing={setListing} />
      {listing ? <p className="cell-wrap">{t.target(name)}</p> : null}
      <div className="row-actions">
        <button
          type="button"
          className="button"
          data-autofocus=""
          disabled={listing === null}
          onClick={() => {
            if (listing) {
              onPick(listing.folder.id, name);
            }
          }}
        >
          {t.submit}
        </button>
        <button type="button" className="button button-quiet" onClick={onClose}>
          {all.files.dialogs.cancel}
        </button>
      </div>
    </Dialog>
  );
}
