"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { AlbumDetail, ErrorCode } from "@cloud/shared";
import { ApiError, errorCodeOf } from "../../lib/api";
import { useT } from "../../lib/i18n/provider";
import {
  PAGE_SIZE,
  deleteAlbum,
  getAlbum,
  removeAlbumItem,
  renameAlbum,
} from "../../lib/photos-api";
import { useSelection } from "../../lib/use-selection";
import { ConfirmDialog } from "../confirm-dialog";
import { NameDialog } from "../files/name-dialog";
import { NotFoundState } from "../not-found-state";
import { Lightbox } from "./lightbox";
import { LoadMore } from "./load-more";
import { PhotoGrid } from "./photo-grid";

type State =
  | { status: "loading" }
  | { status: "error"; code: ErrorCode }
  | { status: "ready"; detail: AlbumDetail };

export function AlbumView({ albumId }: { albumId: string }) {
  const all = useT();
  const t = all.photos;
  const router = useRouter();
  const selection = useSelection();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const renameRef = useRef<HTMLButtonElement>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);
  const [state, setState] = useState<State>({ status: "loading" });
  const [selectMode, setSelectMode] = useState(false);
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [openId, setOpenId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"rename" | "delete" | null>(null);
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState<ErrorCode | null>(null);

  const load = useCallback(async () => {
    try {
      setState({ status: "ready", detail: await getAlbum(albumId) });
    } catch (e) {
      setState({ status: "error", code: errorCodeOf(e) });
    }
  }, [albumId]);

  useEffect(() => {
    void load();
  }, [load]);

  const detail = state.status === "ready" ? state.detail : null;
  // The API returns the whole album; the grid shows it a page at a time so it stays light.
  const shown = useMemo(() => detail?.items.slice(0, visible) ?? [], [detail, visible]);
  const showMore = useCallback(() => {
    setVisible((count) => count + PAGE_SIZE);
  }, []);
  const closeLightbox = useCallback(() => {
    setOpenId(null);
  }, []);
  const open = useCallback((item: { fileId: string }) => {
    setOpenId(item.fileId);
  }, []);

  if (state.status === "loading") {
    return <p role="status">{t.loading}</p>;
  }
  if (state.status === "error") {
    if (state.code === "not_found") {
      return <NotFoundState />;
    }
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

  const { album, items } = state.detail;

  function stopSelecting() {
    setSelectMode(false);
    selection.clear();
  }

  async function removeSelected() {
    const ids = [...selection.selected];
    setNotice("");
    setActionError(null);
    // A photo that is already gone from the album (404) is the outcome we wanted.
    const results = await Promise.allSettled(ids.map((id) => removeAlbumItem(album.id, id)));
    const failure = results.find(
      (r): r is PromiseRejectedResult =>
        r.status === "rejected" && !(r.reason instanceof ApiError && r.reason.status === 404),
    );
    const removed = results.length - results.filter((r) => r.status === "rejected").length;
    stopSelecting();
    await load();
    if (failure) {
      setActionError(errorCodeOf(failure.reason));
    } else {
      setNotice(t.notices.removed(removed, album.name));
    }
    headingRef.current?.focus();
  }

  return (
    <>
      <nav aria-label={t.albums.title}>
        <Link href="/albums">{t.albums.back}</Link>
      </nav>
      <div className="page-head">
        <h1 ref={headingRef} tabIndex={-1} className="cell-wrap">
          {album.name}
        </h1>
        <span className="note">{t.albums.photos(items.length)}</span>
      </div>
      <div className="toolbar" role="group" aria-label={t.albums.toolbarLabel}>
        <button
          ref={renameRef}
          type="button"
          className="button button-quiet"
          onClick={() => {
            setNotice("");
            setDialog("rename");
          }}
        >
          {t.albums.rename}
        </button>
        {items.length > 0 ? (
          <button
            type="button"
            className="button"
            onClick={() => {
              setNotice("");
              if (selectMode) {
                stopSelecting();
              } else {
                setSelectMode(true);
              }
            }}
          >
            {selectMode ? t.select.cancel : t.select.start}
          </button>
        ) : null}
        {selectMode ? (
          <>
            <button
              type="button"
              className="button button-danger"
              disabled={selection.selected.size === 0}
              onClick={() => {
                void removeSelected();
              }}
            >
              {t.albums.remove}
            </button>
            <span role="status" className="note toolbar-count">
              {t.select.count(selection.selected.size)}
            </span>
          </>
        ) : null}
        <button
          ref={deleteRef}
          type="button"
          className="button button-quiet button-danger-text"
          onClick={() => {
            setNotice("");
            setDialog("delete");
          }}
        >
          {t.albums.deleteAlbum}
        </button>
      </div>
      <p role="status" className="note">
        {notice}
      </p>
      {actionError ? (
        <p role="alert" className="alert">
          {all.errors[actionError]}
        </p>
      ) : null}
      {items.length === 0 ? (
        <div className="empty">
          <p className="empty-title">{t.albums.emptyAlbum.title}</p>
          <p className="note">{t.albums.emptyAlbum.hint}</p>
        </div>
      ) : (
        <PhotoGrid
          items={shown}
          selectMode={selectMode}
          selected={selection.selected}
          onOpen={open}
          onToggle={selection.toggle}
        />
      )}
      <LoadMore
        hasMore={shown.length < items.length}
        loading={false}
        auto
        count={shown.length}
        onLoadMore={showMore}
      />

      {openId !== null ? (
        <Lightbox
          items={shown}
          fileId={openId}
          hasMore={shown.length < items.length}
          loadingMore={false}
          loadFailed={false}
          onLoadMore={showMore}
          onChange={setOpenId}
          onClose={closeLightbox}
        />
      ) : null}
      {dialog === "rename" ? (
        <NameDialog
          title={t.albums.renameDialog.title(album.name)}
          label={t.albums.renameDialog.label}
          submitLabel={t.albums.renameDialog.submit}
          submittingLabel={t.albums.renameDialog.submitting}
          requiredMessage={t.albums.renameDialog.required}
          initialName={album.name}
          onSubmit={async (name) => {
            if (name !== album.name) {
              const renamed = await renameAlbum(album.id, name);
              setNotice(t.notices.renamed(renamed.name));
              await load();
            }
            setDialog(null);
          }}
          onClose={() => {
            setDialog(null);
          }}
          returnFocus={renameRef.current}
        />
      ) : null}
      {dialog === "delete" ? (
        <ConfirmDialog
          title={t.albums.confirm.title}
          body={t.albums.confirm.body(album.name)}
          cancelLabel={t.cancel}
          submitLabel={t.albums.confirm.submit}
          submittingLabel={t.albums.confirm.deleting}
          onConfirm={async () => {
            await deleteAlbum(album.id);
            setDialog(null);
            router.replace("/albums");
          }}
          onClose={() => {
            setDialog(null);
          }}
          returnFocus={deleteRef.current}
        />
      ) : null}
    </>
  );
}
