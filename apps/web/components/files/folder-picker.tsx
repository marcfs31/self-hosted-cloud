"use client";

import { useEffect, useRef, useState } from "react";
import type { ErrorCode, FolderListing } from "@cloud/shared";
import { errorCodeOf } from "../../lib/api";
import { getFolder, getRoot } from "../../lib/files-api";
import { useT } from "../../lib/i18n/provider";
import { FileIcon } from "./file-icon";

interface FolderPickerProps {
  /** The folder the picker opens in; null opens the person's root. */
  startFolderId: string | null;
  /** A folder that cannot be entered (the item being moved). */
  excludeId?: string;
  /** Reports the folder being shown: null while it loads or when it could not be read. */
  onListing: (listing: FolderListing | null) => void;
  /** Called when the person walks to another folder, for example to clear an old error. */
  onNavigate?: () => void;
}

type State =
  | { status: "loading" }
  | { status: "error"; code: ErrorCode }
  | { status: "ready"; listing: FolderListing };

/** The name to show for a breadcrumb: the root has an empty name. */
export function crumbLabel(name: string, rootName: string): string {
  return name === "" ? rootName : name;
}

/** A folder picker that walks the tree through the API. Used by the move dialog and the PWA pages. */
export function FolderPicker({
  startFolderId,
  excludeId,
  onListing,
  onNavigate,
}: FolderPickerProps) {
  const all = useT();
  const t = all.files.dialogs.move;
  const [folderId, setFolderId] = useState(startFolderId);
  const [state, setState] = useState<State>({ status: "loading" });
  const report = useRef(onListing);
  report.current = onListing;

  useEffect(() => {
    let stale = false;
    setState({ status: "loading" });
    report.current(null);
    (folderId === null ? getRoot() : getFolder(folderId)).then(
      (listing) => {
        if (!stale) {
          setState({ status: "ready", listing });
          report.current(listing);
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

  function walkTo(id: string) {
    onNavigate?.();
    setFolderId(id);
  }

  if (state.status === "error") {
    return (
      <p role="alert" className="alert">
        {all.errors[state.code]}
      </p>
    );
  }
  if (state.status === "loading") {
    return <p role="status">{t.loading}</p>;
  }

  const { listing } = state;
  const folders = listing.children.filter((child) => child.kind === "folder");
  return (
    <>
      <nav aria-label={t.pathLabel}>
        <ol className="breadcrumbs">
          {listing.breadcrumbs.map((crumb, index) => {
            const last = index === listing.breadcrumbs.length - 1;
            const label = crumbLabel(crumb.name, all.files.rootName);
            return (
              <li key={crumb.id}>
                {last ? (
                  <span aria-current="page">{label}</span>
                ) : (
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => {
                      walkTo(crumb.id);
                    }}
                  >
                    {label}
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
              {folder.id === excludeId ? (
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
                    walkTo(folder.id);
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
    </>
  );
}
