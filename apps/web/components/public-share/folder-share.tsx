"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ErrorCode, PublicFolderListing, PublicShareInfo } from "@cloud/shared";
import { errorCodeOf } from "../../lib/api";
import { useFormat, useT } from "../../lib/i18n/provider";
import { getPublicFolder, publicFileHref, publicZipHref } from "../../lib/shares-api";
import { FileIcon } from "../files/file-icon";
import { NotFound } from "./not-found";

type State =
  | { status: "loading" }
  | { status: "error"; code: ErrorCode }
  | { status: "ready"; listing: PublicFolderListing };

interface FolderShareProps {
  token: string;
  info: PublicShareInfo;
  /** The password grant ran out while browsing: read the share again to ask for it. */
  onLocked: () => Promise<void>;
}

/** The address of a folder inside the share; the shared folder itself has no query. */
function folderHref(token: string, folderId: string | null): string {
  const base = `/s/${encodeURIComponent(token)}`;
  return folderId === null ? base : `${base}?folder=${encodeURIComponent(folderId)}`;
}

export function FolderShare({ token, info, onLocked }: FolderShareProps) {
  const all = useT();
  const t = all.shares.public;
  const files = all.files;
  const format = useFormat();
  const folderId = useSearchParams().get("folder");
  const latest = useRef(0);
  const [state, setState] = useState<State>({ status: "loading" });

  const load = useCallback(async () => {
    latest.current += 1;
    const mine = latest.current;
    try {
      const listing = await getPublicFolder(token, folderId);
      if (mine === latest.current) {
        setState({ status: "ready", listing });
      }
    } catch (e) {
      if (mine !== latest.current) {
        return;
      }
      const code = errorCodeOf(e);
      if (code === "share_locked") {
        await onLocked();
        return;
      }
      setState({ status: "error", code });
    }
  }, [token, folderId, onLocked]);

  useEffect(() => {
    setState({ status: "loading" });
    void load();
    return () => {
      latest.current += 1;
    };
  }, [load]);

  if (state.status === "loading") {
    return <p role="status">{t.loading}</p>;
  }
  if (state.status === "error") {
    if (state.code === "not_found") {
      return (
        <>
          <NotFound />
          <p>
            <Link href={folderHref(token, null)}>{info.name}</Link>
          </p>
        </>
      );
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

  const { folder, breadcrumbs, children } = state.listing;
  const atRoot = breadcrumbs.length <= 1;

  return (
    <>
      <nav aria-label={files.breadcrumbsLabel}>
        <ol className="breadcrumbs">
          {breadcrumbs.map((crumb, index) => {
            const last = index === breadcrumbs.length - 1;
            return (
              <li key={crumb.id}>
                {last ? (
                  <span aria-current="page">{crumb.name}</span>
                ) : (
                  <Link href={folderHref(token, index === 0 ? null : crumb.id)}>{crumb.name}</Link>
                )}
              </li>
            );
          })}
        </ol>
      </nav>
      <div className="page-head">
        <h1 className="cell-wrap">{folder.name}</h1>
        <span className="note">{files.itemCount(children.length)}</span>
      </div>
      {info.expiresAt ? <p className="note">{t.expiresOn(format.date(info.expiresAt))}</p> : null}
      <div className="toolbar">
        <a className="button" href={publicZipHref(token, atRoot ? null : folder.id)} download="">
          {t.folder.downloadAll}
        </a>
      </div>
      {children.length === 0 ? (
        <div className="empty">
          <p className="empty-title">{t.folder.empty}</p>
        </div>
      ) : (
        <table className="table files-table">
          <caption className="sr-only">{t.folder.caption(folder.name)}</caption>
          <thead>
            <tr>
              <th scope="col">{files.table.name}</th>
              <th scope="col">{files.table.size}</th>
              <th scope="col">{files.table.modified}</th>
              <th scope="col">
                <span className="sr-only">{files.table.actions}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {children.map((node) => (
              <tr key={node.id}>
                <td data-label={files.table.name} className="cell-wrap">
                  <span className="name-cell">
                    <FileIcon kind={node.kind} />
                    <span>
                      {node.kind === "folder" ? (
                        <Link href={folderHref(token, node.id)}>{node.name}</Link>
                      ) : (
                        node.name
                      )}
                    </span>
                  </span>
                </td>
                <td data-label={files.table.size}>
                  {node.kind === "folder" ? files.table.folder : format.bytes(node.size)}
                </td>
                <td data-label={files.table.modified}>{format.dateTime(node.updatedAt)}</td>
                <td data-label={files.table.actions}>
                  {node.kind === "file" ? (
                    <a
                      className="button button-quiet button-small"
                      href={publicFileHref(token, node.id)}
                      download=""
                      aria-label={t.folder.downloadLabel(node.name)}
                    >
                      {t.folder.download}
                    </a>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
