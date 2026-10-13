"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ErrorCode, Share } from "@cloud/shared";
import { errorCodeOf } from "../../lib/api";
import { useFormat, useT } from "../../lib/i18n/provider";
import { isExpired } from "../../lib/shares";
import { listShares, revokeShare } from "../../lib/shares-api";
import { ConfirmDialog } from "../confirm-dialog";
import { FileIcon } from "../files/file-icon";

type State =
  | { status: "loading" }
  | { status: "error"; code: ErrorCode }
  | { status: "ready"; shares: readonly Share[] };

interface Revoking {
  share: Share;
  returnFocus: HTMLElement | null;
}

export function SharesView() {
  const all = useT();
  const t = all.shares;
  const format = useFormat();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [state, setState] = useState<State>({ status: "loading" });
  const [revoking, setRevoking] = useState<Revoking | null>(null);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const { shares } = await listShares();
      setState({ status: "ready", shares });
    } catch (e) {
      setState({ status: "error", code: errorCodeOf(e) });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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
              void load();
            }}
          >
            {all.common.app.retry}
          </button>
        </div>
      </div>
    );
  }

  const { shares } = state;
  const now = Date.now();
  const yesNo = (value: boolean) => (value ? t.yes : t.no);

  return (
    <>
      <div className="page-head">
        <h1 ref={headingRef} tabIndex={-1}>
          {t.title}
        </h1>
      </div>
      <p className="note">{t.intro}</p>
      <p role="status" className="note">
        {notice}
      </p>
      {shares.length === 0 ? (
        <div className="empty">
          <p className="empty-title">{t.empty.title}</p>
          <p className="note">{t.empty.hint}</p>
        </div>
      ) : (
        <table className="table files-table">
          <caption className="sr-only">{t.caption}</caption>
          <thead>
            <tr>
              <th scope="col">{t.columns.item}</th>
              <th scope="col">{t.columns.kind}</th>
              <th scope="col">{t.columns.dropBox}</th>
              <th scope="col">{t.columns.password}</th>
              <th scope="col">{t.columns.created}</th>
              <th scope="col">{t.columns.expires}</th>
              <th scope="col">
                <span className="sr-only">{t.columns.actions}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {shares.map((share) => (
              <tr key={share.id}>
                <td data-label={t.columns.item} className="cell-wrap">
                  <span className="name-cell">
                    <FileIcon kind={share.kind} />
                    <span>
                      {share.kind === "folder" ? (
                        <Link href={`/folders/${encodeURIComponent(share.fileId)}`}>
                          {share.fileName}
                        </Link>
                      ) : (
                        share.fileName
                      )}
                    </span>
                  </span>
                </td>
                <td data-label={t.columns.kind}>{t.kind[share.kind]}</td>
                <td data-label={t.columns.dropBox}>{yesNo(share.allowUpload)}</td>
                <td data-label={t.columns.password}>{yesNo(share.hasPassword)}</td>
                <td data-label={t.columns.created}>{format.dateTime(share.createdAt)}</td>
                <td data-label={t.columns.expires}>
                  {share.expiresAt === null
                    ? t.never
                    : isExpired(share.expiresAt, now)
                      ? t.expired(format.dateTime(share.expiresAt))
                      : format.dateTime(share.expiresAt)}
                </td>
                <td data-label={t.columns.actions}>
                  <button
                    type="button"
                    className="button button-quiet button-small button-danger-text"
                    aria-label={t.revokeLabel(share.fileName)}
                    onClick={(event) => {
                      setRevoking({ share, returnFocus: event.currentTarget });
                    }}
                  >
                    {t.revoke}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {revoking ? (
        <ConfirmDialog
          title={t.confirm.title}
          body={t.confirm.body(revoking.share.fileName)}
          cancelLabel={t.confirm.cancel}
          submitLabel={t.confirm.submit}
          submittingLabel={t.confirm.submitting}
          onConfirm={async () => {
            await revokeShare(revoking.share.id);
            setRevoking(null);
            setNotice(t.notices.revoked(revoking.share.fileName));
            await load();
            headingRef.current?.focus();
          }}
          onClose={() => {
            setRevoking(null);
          }}
          returnFocus={revoking.returnFocus}
        />
      ) : null}
    </>
  );
}
