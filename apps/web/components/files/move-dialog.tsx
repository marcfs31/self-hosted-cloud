"use client";

import { useEffect, useState } from "react";
import type { ErrorCode, FileNode, FolderListing } from "@cloud/shared";
import { errorCodeOf } from "../../lib/api";
import { getFolder, updateFile } from "../../lib/files-api";
import { useT } from "../../lib/i18n/provider";
import { useForm } from "../../lib/use-form";
import { Dialog } from "../dialog";
import { FormAlert } from "../form";
import { FileIcon } from "./file-icon";

interface MoveDialogProps {
  node: FileNode;
  /** The folder the picker opens in: where the item is now. */
  startFolderId: string;
  onMoved: (moved: FileNode, folderName: string) => void;
  onClose: () => void;
  returnFocus: HTMLElement | null;
}

type Listing =
  | { status: "loading" }
  | { status: "error"; code: ErrorCode }
  | { status: "ready"; listing: FolderListing };

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
  const [folderId, setFolderId] = useState(startFolderId);
  const [state, setState] = useState<Listing>({ status: "loading" });

  useEffect(() => {
    let stale = false;
    setState({ status: "loading" });
    getFolder(folderId).then(
      (listing) => {
        if (!stale) {
          setState({ status: "ready", listing });
        }
      },
      (e: unknown) => {
        if (!stale) {
          setState({ status: "error", code: errorCodeOf(e) });
        }
      },
    );
    return () => {
      stale = true;
    };
  }, [folderId]);

  function nameOf(crumbName: string): string {
    return crumbName === "" ? all.files.rootName : crumbName;
  }

  const listing = state.status === "ready" ? state.listing : null;
  const target = listing ? nameOf(listing.breadcrumbs.at(-1)?.name ?? "") : "";
  const alreadyHere = listing !== null && listing.folder.id === node.parentId;
  const folders = listing?.children.filter((child) => child.kind === "folder") ?? [];

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
      {state.status === "error" ? (
        <p role="alert" className="alert">
          {all.errors[state.code]}
        </p>
      ) : listing === null ? (
        <p role="status">{t.loading}</p>
      ) : (
        <>
          <nav aria-label={t.pathLabel}>
            <ol className="breadcrumbs">
              {listing.breadcrumbs.map((crumb, index) => {
                const last = index === listing.breadcrumbs.length - 1;
                return (
                  <li key={crumb.id}>
                    {last ? (
                      <span aria-current="page">{nameOf(crumb.name)}</span>
                    ) : (
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => {
                          form.clear();
                          setFolderId(crumb.id);
                        }}
                      >
                        {nameOf(crumb.name)}
                      </button>
                    )}
                  </li>
                );
              })}
            </ol>
          </nav>
          {folders.length === 0 ? (
            <p className="note">{t.none}</p>
          ) : (
            <ul className="picker" aria-label={t.listLabel}>
              {folders.map((folder) => (
                <li key={folder.id}>
                  {folder.id === node.id ? (
                    <span className="picker-item picker-item-disabled">
                      <FileIcon kind="folder" />
                      <span className="cell-wrap">
                        {folder.name} <span className="note">({t.itself})</span>
                      </span>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="picker-item"
                      aria-label={t.open(folder.name)}
                      onClick={() => {
                        form.clear();
                        setFolderId(folder.id);
                      }}
                    >
                      <FileIcon kind="folder" />
                      <span className="cell-wrap">{folder.name}</span>
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="cell-wrap">{t.target(target)}</p>
          {alreadyHere ? <p className="note">{t.alreadyHere}</p> : null}
        </>
      )}
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
