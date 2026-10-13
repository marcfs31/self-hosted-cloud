"use client";

import { memo, useMemo, useState } from "react";
import type { PhotoItem } from "@cloud/shared";
import { useLocale, useT } from "../../lib/i18n/provider";
import { groupByMonth } from "../../lib/photos";
import { thumbnailHref } from "../../lib/photos-api";
import { FileIcon } from "../files/file-icon";

type OnOpen = (item: PhotoItem, trigger: HTMLElement) => void;
type OnToggle = (fileId: string) => void;

interface TileProps {
  item: PhotoItem;
  selectMode: boolean;
  selected: boolean;
  onOpen: OnOpen;
  onToggle: OnToggle;
}

/** Decorative: the "Video" word beside it carries the meaning. */
function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false">
      <path d="M8 5v14l11-7z" fill="currentColor" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

/**
 * One square. Memoised and keyed by file, so loading another page or ticking one box does not
 * re-render the hundreds already on screen. A thumbnail that cannot be made (a video without
 * ffmpeg, an SVG, a broken file) becomes a generic file tile that still shows the name.
 */
const Tile = memo(function Tile({ item, selectMode, selected, onOpen, onToggle }: TileProps) {
  const t = useT().photos;
  const [failed, setFailed] = useState(false);
  return (
    <li className={selected ? "photo-tile photo-tile-selected" : "photo-tile"}>
      <button
        type="button"
        className="photo-open"
        data-photo-id={item.fileId}
        inert={selectMode}
        onClick={(event) => {
          onOpen(item, event.currentTarget);
        }}
      >
        {failed ? (
          <span className="photo-fallback">
            <FileIcon kind="file" />
            <span className="photo-fallback-name">{item.name}</span>
          </span>
        ) : (
          <img
            className="photo-img"
            src={thumbnailHref(item.fileId, 256)}
            alt={item.name}
            loading="lazy"
            decoding="async"
            onError={() => {
              setFailed(true);
            }}
          />
        )}
        {item.kind === "video" ? (
          <span className="photo-badge">
            <PlayIcon />
            {t.video}
          </span>
        ) : null}
      </button>
      {selectMode ? (
        <>
          <input
            type="checkbox"
            className="photo-check"
            checked={selected}
            aria-label={t.select.label(item.name)}
            onChange={() => {
              onToggle(item.fileId);
            }}
          />
          <span className="photo-mark" aria-hidden="true">
            <CheckIcon />
          </span>
        </>
      ) : null}
    </li>
  );
});

interface MonthProps {
  label: string;
  items: readonly PhotoItem[];
  selectMode: boolean;
  selected: ReadonlySet<string>;
  onOpen: OnOpen;
  onToggle: OnToggle;
}

function sameItems(a: readonly PhotoItem[], b: readonly PhotoItem[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

const Month = memo(
  function Month({ label, items, selectMode, selected, onOpen, onToggle }: MonthProps) {
    return (
      <div className="photo-month">
        <h2>{label}</h2>
        <ul className="photo-grid">
          {items.map((item) => (
            <Tile
              key={item.fileId}
              item={item}
              selectMode={selectMode}
              selected={selected.has(item.fileId)}
              onOpen={onOpen}
              onToggle={onToggle}
            />
          ))}
        </ul>
      </div>
    );
  },
  (a, b) =>
    a.label === b.label &&
    a.selectMode === b.selectMode &&
    a.selected === b.selected &&
    a.onOpen === b.onOpen &&
    a.onToggle === b.onToggle &&
    sameItems(a.items, b.items),
);

const NO_SELECTION: ReadonlySet<string> = new Set();

interface PhotoGridProps {
  items: readonly PhotoItem[];
  selectMode: boolean;
  selected: ReadonlySet<string>;
  onOpen: OnOpen;
  onToggle: OnToggle;
}

/** Photos under month headings, in the order given. */
export function PhotoGrid({ items, selectMode, selected, onOpen, onToggle }: PhotoGridProps) {
  const locale = useLocale();
  const groups = useMemo(() => groupByMonth(items, locale), [items, locale]);
  return (
    <>
      {groups.map((group) => (
        <Month
          key={`${group.key}-${group.items[0]?.fileId ?? ""}`}
          label={group.label}
          items={group.items}
          selectMode={selectMode}
          // Outside select mode no tile reads the set, so ticking never re-renders the months.
          selected={selectMode ? selected : NO_SELECTION}
          onOpen={onOpen}
          onToggle={onToggle}
        />
      ))}
    </>
  );
}
