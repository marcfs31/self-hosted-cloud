"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Album, ErrorCode } from "@cloud/shared";
import { errorCodeOf } from "../../lib/api";
import { useT } from "../../lib/i18n/provider";
import { createAlbum, deleteAlbum, getAlbums, renameAlbum } from "../../lib/photos-api";
import { ConfirmDialog } from "../confirm-dialog";
import { NameDialog } from "../files/name-dialog";
import { AlbumCover } from "./album-cover";

type State =
  | { status: "loading" }
  | { status: "error"; code: ErrorCode }
  | { status: "ready"; albums: readonly Album[] };

type DialogState =
  | { kind: "new"; returnFocus: HTMLElement | null }
  | { kind: "rename" | "delete"; album: Album; returnFocus: HTMLElement | null };

export function AlbumsView() {
  const all = useT();
  const t = all.photos;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [state, setState] = useState<State>({ status: "loading" });
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      setState({ status: "ready", albums: await getAlbums() });
    } catch (e) {
      setState({ status: "error", code: errorCodeOf(e) });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.status === "loading") {
    return <p role="status">{t.albums.loading}</p>;
  }
  if (state.status === "error") {
    return (
      <div className="stack">
        <p role="alert" className="alert">
          {all.errors[state.code]}
        </p>
        <div>
          <button
            type="button"
            className="button"
            onClick={() => {
              void load();
            }}
          >
            {all.common.app.retry}
          </button>
        </div>
      </div>
    );
  }

  const { albums } = state;

  function closeDialog() {
    setDialog(null);
  }

  return (
    <>
      <div className="page-head">
        <h1 ref={headingRef} tabIndex={-1}>
          {t.albums.title}
        </h1>
        <Link href="/photos" className="note">
          {t.title}
        </Link>
      </div>
      <div className="toolbar">
        <button
          type="button"
          className="button"
          onClick={(event) => {
            setNotice("");
            setDialog({ kind: "new", returnFocus: event.currentTarget });
          }}
        >
          {t.albums.new}
        </button>
      </div>
      <p role="status" className="note">
        {notice}
      </p>
      {albums.length === 0 ? (
        <div className="empty">
          <p className="empty-title">{t.albums.empty.title}</p>
          <p className="note">{t.albums.empty.hint}</p>
        </div>
      ) : (
        <ul className="album-grid" aria-label={t.albums.listLabel}>
          {albums.map((album) => (
            <li key={album.id} className="album-card">
              <Link href={`/albums/${encodeURIComponent(album.id)}`} className="album-link">
                <AlbumCover fileId={album.coverFileId} />
                <span className="album-name cell-wrap">{album.name}</span>
                <span className="note">{t.albums.photos(album.itemCount)}</span>
              </Link>
              <div className="row-actions">
                <button
                  type="button"
                  className="button button-quiet button-small"
                  aria-label={t.albums.renameLabel(album.name)}
                  onClick={(event) => {
                    setNotice("");
                    setDialog({ kind: "rename", album, returnFocus: event.currentTarget });
                  }}
                >
                  {t.albums.rename}
                </button>
                <button
                  type="button"
                  className="button button-quiet button-small button-danger-text"
                  aria-label={t.albums.deleteLabel(album.name)}
                  onClick={(event) => {
                    setNotice("");
                    setDialog({ kind: "delete", album, returnFocus: event.currentTarget });
                  }}
                >
                  {t.albums.delete}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {dialog?.kind === "new" ? (
        <NameDialog
          title={t.albums.newDialog.title}
          label={t.albums.newDialog.label}
          submitLabel={t.albums.newDialog.submit}
          submittingLabel={t.albums.newDialog.submitting}
          requiredMessage={t.albums.newDialog.required}
          initialName=""
          onSubmit={async (name) => {
            const created = await createAlbum(name);
            closeDialog();
            setNotice(t.notices.created(created.name));
            await load();
          }}
          onClose={closeDialog}
          returnFocus={dialog.returnFocus}
        />
      ) : null}
      {dialog?.kind === "rename" ? (
        <NameDialog
          title={t.albums.renameDialog.title(dialog.album.name)}
          label={t.albums.renameDialog.label}
          submitLabel={t.albums.renameDialog.submit}
          submittingLabel={t.albums.renameDialog.submitting}
          requiredMessage={t.albums.renameDialog.required}
          initialName={dialog.album.name}
          onSubmit={async (name) => {
            if (name !== dialog.album.name) {
              const renamed = await renameAlbum(dialog.album.id, name);
              setNotice(t.notices.renamed(renamed.name));
              await load();
            }
            closeDialog();
          }}
          onClose={closeDialog}
          returnFocus={dialog.returnFocus}
        />
      ) : null}
      {dialog?.kind === "delete" ? (
        <ConfirmDialog
          title={t.albums.confirm.title}
          body={t.albums.confirm.body(dialog.album.name)}
          cancelLabel={t.cancel}
          submitLabel={t.albums.confirm.submit}
          submittingLabel={t.albums.confirm.deleting}
          onConfirm={async () => {
            await deleteAlbum(dialog.album.id);
            closeDialog();
            setNotice(t.notices.deleted(dialog.album.name));
            await load();
            headingRef.current?.focus();
          }}
          onClose={closeDialog}
          returnFocus={dialog.returnFocus}
        />
      ) : null}
    </>
  );
}
