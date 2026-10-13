"use client";

import { useState } from "react";
import { thumbnailHref } from "../../lib/photos-api";
import { FileIcon } from "../files/file-icon";

/** An album's first photo, or a plain tile when it has none or its thumbnail cannot be made. */
export function AlbumCover({ fileId }: { fileId: string | null }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="album-cover">
      {fileId === null || failed ? (
        <FileIcon kind="file" />
      ) : (
        <img
          className="photo-img"
          src={thumbnailHref(fileId, 256)}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => {
            setFailed(true);
          }}
        />
      )}
    </span>
  );
}
