"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { useT } from "../../lib/i18n/provider";
import { usePhotoTimeline } from "../../lib/use-photo-timeline";
import { useSelection } from "../../lib/use-selection";
import { AddToAlbumDialog } from "./add-to-album-dialog";
import { Lightbox } from "./lightbox";
import { LoadMore } from "./load-more";
import { PhotoGrid } from "./photo-grid";

export function PhotosView() {
  const all = useT();
  const t = all.photos;
  const { state, reload, loadMore } = usePhotoTimeline();
  const selection = useSelection();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState("");

  const open = useCallback((item: { fileId: string }) => {
    setOpenId(item.fileId);
  }, []);
  const closeLightbox = useCallback(() => {
    setOpenId(null);
  }, []);

  if (state.status === "loading") {
    return <p role="status">{t.loading}</p>;
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
              void reload();
            }}
          >
            {all.common.app.retry}
          </button>
        </div>
      </div>
    );
  }

  const { items, hasMore, loadingMore, moreError } = state;

  function stopSelecting() {
    setSelectMode(false);
    selection.clear();
  }

  return (
    <>
      <div className="page-head">
        <h1 ref={headingRef} tabIndex={-1}>
          {t.title}
        </h1>
        <span className="note">{hasMore ? t.countSoFar(items.length) : t.count(items.length)}</span>
      </div>
      <div className="toolbar" role="group" aria-label={t.toolbar.label}>
        <Link href="/albums" className="button button-quiet">
          {t.toolbar.albums}
        </Link>
        {items.length > 0 ? (
          <button
            ref={toggleRef}
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
              ref={addRef}
              type="button"
              className="button"
              disabled={selection.selected.size === 0}
              onClick={() => {
                setAdding(true);
              }}
            >
              {t.select.addToAlbum}
            </button>
            <span role="status" className="note toolbar-count">
              {t.select.count(selection.selected.size)}
            </span>
          </>
        ) : null}
      </div>
      <p role="status" className="note">
        {notice}
      </p>
      {items.length === 0 ? (
        <div className="empty">
          <p className="empty-title">{t.empty.title}</p>
          <p className="note">{t.empty.hint}</p>
        </div>
      ) : (
        <PhotoGrid
          items={items}
          selectMode={selectMode}
          selected={selection.selected}
          onOpen={open}
          onToggle={selection.toggle}
        />
      )}
      {moreError ? (
        <p role="alert" className="alert">
          {all.errors[moreError]}
        </p>
      ) : null}
      <LoadMore
        hasMore={hasMore}
        loading={loadingMore}
        auto={moreError === null}
        count={items.length}
        onLoadMore={loadMore}
      />

      {openId !== null ? (
        <Lightbox
          items={items}
          fileId={openId}
          hasMore={hasMore}
          loadingMore={loadingMore}
          loadFailed={moreError !== null}
          onLoadMore={loadMore}
          onChange={setOpenId}
          onClose={closeLightbox}
        />
      ) : null}
      {adding ? (
        <AddToAlbumDialog
          fileIds={[...selection.selected]}
          onAdded={(albumName) => {
            const count = selection.selected.size;
            setAdding(false);
            stopSelecting();
            setNotice(t.notices.added(count, albumName));
          }}
          onClose={() => {
            setAdding(false);
          }}
          returnFocus={() => (addRef.current?.isConnected ? addRef.current : toggleRef.current)}
        />
      ) : null}
    </>
  );
}
