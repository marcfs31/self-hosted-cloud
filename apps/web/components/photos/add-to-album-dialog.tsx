"use client";

import { useEffect, useId, useRef, useState, type SubmitEvent } from "react";
import type { Album, ErrorCode } from "@cloud/shared";
import { errorCodeOf } from "../../lib/api";
import { useT } from "../../lib/i18n/provider";
import { addAlbumItems, createAlbum, getAlbums } from "../../lib/photos-api";
import { useForm } from "../../lib/use-form";
import { Dialog } from "../dialog";
import { Field, FormAlert, SubmitButton } from "../form";

interface AddToAlbumDialogProps {
  fileIds: readonly string[];
  /** The photos are in the album (the parent then closes the dialog). */
  onAdded: (albumName: string) => void;
  onClose: () => void;
  returnFocus: () => HTMLElement | null;
}

type Albums =
  | { status: "loading" }
  | { status: "error"; code: ErrorCode }
  | { status: "ready"; albums: readonly Album[] };

/** Pick one of the albums, or name a new one; either way the chosen photos go in. */
export function AddToAlbumDialog({
  fileIds,
  onAdded,
  onClose,
  returnFocus,
}: AddToAlbumDialogProps) {
  const all = useT();
  const t = all.photos;
  const form = useForm();
  const nameId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [state, setState] = useState<Albums>({ status: "loading" });
  const [creating, setCreating] = useState(false);
  // If creating worked but adding did not, trying again must not create a second album.
  const created = useRef<Album | null>(null);

  useEffect(() => {
    let stale = false;
    getAlbums().then(
      (albums) => {
        if (!stale) {
          setState({ status: "ready", albums });
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
  }, []);

  function addTo(album: Album) {
    setCreating(false);
    void form.submit(async () => {
      await addAlbumItems(album.id, fileIds);
      onAdded(album.name);
    });
  }

  function submitNew(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === "") {
      form.fail(t.addDialog.required, nameRef);
      return;
    }
    setCreating(true);
    void form.submit(async () => {
      created.current ??= await createAlbum(trimmed);
      await addAlbumItems(created.current.id, fileIds);
      onAdded(created.current.name);
    });
  }

  return (
    <Dialog title={t.addDialog.title(fileIds.length)} onClose={onClose} returnFocus={returnFocus}>
      {state.status === "loading" ? <p role="status">{t.addDialog.loading}</p> : null}
      {state.status === "error" ? (
        <p role="alert" className="alert">
          {all.errors[state.code]}
        </p>
      ) : null}
      {state.status === "ready" ? (
        state.albums.length === 0 ? (
          <p className="note">{t.addDialog.none}</p>
        ) : (
          <ul className="picker" aria-label={t.addDialog.existing}>
            {state.albums.map((album) => (
              <li key={album.id}>
                <button
                  type="button"
                  className="picker-item"
                  disabled={form.busy}
                  onClick={() => {
                    addTo(album);
                  }}
                >
                  <span className="cell-wrap">{album.name}</span>
                  <span className="note">({t.albums.photos(album.itemCount)})</span>
                </button>
              </li>
            ))}
          </ul>
        )
      ) : null}
      <form onSubmit={submitNew} className="stack" noValidate>
        <Field
          id={nameId}
          label={t.addDialog.newLabel}
          autoComplete="off"
          spellCheck={false}
          data-autofocus=""
          inputRef={nameRef}
          state={form}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            form.clear();
          }}
        />
        <FormAlert form={form} />
        <div className="row-actions">
          <SubmitButton
            busy={form.busy}
            label={t.addDialog.create}
            busyLabel={creating ? t.addDialog.creating : t.addDialog.adding}
          />
          <button type="button" className="button button-quiet" onClick={onClose}>
            {t.cancel}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
