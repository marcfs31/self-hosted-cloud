"use client";

import { useState } from "react";
import type { FileNode, FolderListing } from "@cloud/shared";
import { updateFile } from "../../lib/files-api";
import { useT } from "../../lib/i18n/provider";
import { useForm } from "../../lib/use-form";
import { Dialog } from "../dialog";
import { FormAlert } from "../form";
import { FolderPicker, crumbLabel } from "./folder-picker";

interface MoveDialogProps {
  node: FileNode;
  /** The folder the picker opens in: where the item is now. */
  startFolderId: string;
  onMoved: (moved: FileNode, folderName: string) => void;
  onClose: () => void;
  returnFocus: HTMLElement | null;
}

/** A folder picker that walks the tree through the API. The item itself cannot be entered. */
export function MoveDialog({
  node,
  startFolderId,
  onMoved,
  onClose,
  returnFocus,
}: MoveDialogProps) {
  const all = useT();
  const t = all.files.dialogs.move;
  const form = useForm();
  const [listing, setListing] = useState<FolderListing | null>(null);

  const target = listing
    ? crumbLabel(listing.breadcrumbs.at(-1)?.name ?? "", all.files.rootName)
    : "";
  const alreadyHere = listing !== null && listing.folder.id === node.parentId;

  function move() {
    if (!listing) {
      return;
    }
    void form.submit(async () => {
      const moved = await updateFile(node.id, { parentId: listing.folder.id });
      onMoved(moved, target);
    });
  }

  return (
    <Dialog title={t.title(node.name)} onClose={onClose} returnFocus={returnFocus}>
      <p className="note">{t.hint}</p>
      <FolderPicker
        startFolderId={startFolderId}
        excludeId={node.id}
        onListing={setListing}
        onNavigate={form.clear}
      />
      {listing ? (
        <>
          <p className="cell-wrap">{t.target(target)}</p>
          {alreadyHere ? <p className="note">{t.alreadyHere}</p> : null}
        </>
      ) : null}
      <FormAlert form={form} />
      <div className="row-actions">
        <button
          type="button"
          className="button"
          data-autofocus=""
          disabled={form.busy || listing === null || alreadyHere}
          aria-busy={form.busy}
          onClick={move}
        >
          {form.busy ? t.submitting : t.submit}
        </button>
        <button type="button" className="button button-quiet" onClick={onClose}>
          {all.files.dialogs.cancel}
        </button>
      </div>
    </Dialog>
  );
}
