"use client";

import type { PublicShareInfo } from "@cloud/shared";
import { useFormat, useT } from "../../lib/i18n/provider";
import { previewKind } from "../../lib/shares";
import { publicContentHref } from "../../lib/shares-api";

export function FileShare({ token, info }: { token: string; info: PublicShareInfo }) {
  const t = useT().shares.public;
  const format = useFormat();
  const preview = previewKind(info.mime);
  const src = publicContentHref(token, false);

  return (
    <>
      <h1 className="cell-wrap">{info.name}</h1>
      <p className="note">
        {t.file.size(format.bytes(info.size ?? 0))}
        {info.mime ? ` · ${info.mime}` : ""}
      </p>
      {info.expiresAt ? <p className="note">{t.expiresOn(format.date(info.expiresAt))}</p> : null}
      {preview === "image" ? <img className="preview" src={src} alt={info.name} /> : null}
      {preview === "video" ? (
        <video className="preview" src={src} controls preload="metadata" aria-label={info.name} />
      ) : null}
      {preview === "audio" ? (
        <audio
          className="preview-audio"
          src={src}
          controls
          preload="metadata"
          aria-label={info.name}
        />
      ) : null}
      <div>
        <a className="button" href={publicContentHref(token, true)} download="">
          {t.file.download}
        </a>
      </div>
    </>
  );
}
