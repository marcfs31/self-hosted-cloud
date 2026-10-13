"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PhotoItem } from "@cloud/shared";
import { useFormat, useT } from "../../lib/i18n/provider";
import { neighbour } from "../../lib/photos";
import { contentHref, thumbnailHref } from "../../lib/photos-api";
import { Dialog } from "../dialog";
import { FileIcon } from "../files/file-icon";

/** How close to the end of what is loaded the lightbox asks for the next page. */
const PRELOAD_AHEAD = 3;

function Media({ item }: { item: PhotoItem }) {
  const t = useT().photos.lightbox;
  const [failed, setFailed] = useState(false);
  if (item.kind === "video") {
    // Played from the original; the thumbnail is only the poster, and may not exist.
    return (
      <video
        className="lightbox-media"
        controls
        playsInline
        preload="metadata"
        poster={thumbnailHref(item.fileId, 1024)}
        src={contentHref(item.fileId)}
      />
    );
  }
  if (failed) {
    return (
      <div className="lightbox-fallback">
        <FileIcon kind="file" />
        <p>{t.noPreview}</p>
      </div>
    );
  }
  return (
    <img
      className="lightbox-media"
      src={thumbnailHref(item.fileId, 1024)}
      alt={item.name}
      decoding="async"
      onError={() => {
        setFailed(true);
      }}
    />
  );
}

interface LightboxProps {
  /** Everything loaded so far, in display order. */
  items: readonly PhotoItem[];
  fileId: string;
  hasMore: boolean;
  loadingMore: boolean;
  /** The last request for more failed: the lightbox does not ask again by itself. */
  loadFailed: boolean;
  onLoadMore: () => void;
  onChange: (fileId: string) => void;
  onClose: () => void;
}

/** One photo or video at a time, in a native dialog. Escape closes it and focus returns to its tile. */
export function Lightbox({
  items,
  fileId,
  hasMore,
  loadingMore,
  loadFailed,
  onLoadMore,
  onChange,
  onClose,
}: LightboxProps) {
  const t = useT().photos.lightbox;
  const format = useFormat();
  const item = items.find((candidate) => candidate.fileId === fileId);
  const previous = neighbour(items, fileId, -1);
  const next = neighbour(items, fileId, 1);
  const index = items.findIndex((candidate) => candidate.fileId === fileId);

  // The tile of whichever photo is showing when the dialog closes gets the focus back.
  const current = useRef(fileId);
  useEffect(() => {
    current.current = fileId;
  }, [fileId]);
  const returnFocus = useCallback(
    () => document.querySelector<HTMLElement>(`[data-photo-id="${CSS.escape(current.current)}"]`),
    [],
  );

  useEffect(() => {
    if (hasMore && !loadingMore && !loadFailed && index >= items.length - PRELOAD_AHEAD) {
      onLoadMore();
    }
  }, [hasMore, loadingMore, loadFailed, index, items.length, onLoadMore]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        (event.target instanceof HTMLElement && event.target.tagName === "VIDEO")
      ) {
        return;
      }
      const target =
        event.key === "ArrowLeft" ? previous : event.key === "ArrowRight" ? next : null;
      if (target) {
        event.preventDefault();
        onChange(target.fileId);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [previous, next, onChange]);

  if (!item) {
    return null;
  }

  // aria-disabled, not disabled: the button the person just used must keep its focus at the end.
  return (
    <Dialog title={item.name} onClose={onClose} returnFocus={returnFocus} wide>
      <div className="lightbox-stage">
        <Media key={item.fileId} item={item} />
      </div>
      <p className="note">
        {item.takenAtSource === "exif"
          ? t.taken(format.dateTime(item.takenAt))
          : t.uploaded(format.dateTime(item.takenAt))}
      </p>
      <div className="lightbox-controls">
        <button
          type="button"
          className="button button-quiet"
          aria-disabled={previous === null}
          onClick={() => {
            if (previous) {
              onChange(previous.fileId);
            }
          }}
        >
          {t.previous}
        </button>
        <p role="status" className="note">
          {t.position(index + 1, hasMore ? `${items.length}+` : String(items.length))}
        </p>
        <button
          type="button"
          className="button button-quiet"
          aria-disabled={next === null}
          onClick={() => {
            if (next) {
              onChange(next.fileId);
            }
          }}
        >
          {t.next}
        </button>
        <a
          className="button button-quiet"
          href={contentHref(item.fileId)}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t.openOriginal}
        </a>
        <button type="button" className="button" data-autofocus="" onClick={onClose}>
          {t.close}
        </button>
      </div>
    </Dialog>
  );
}
