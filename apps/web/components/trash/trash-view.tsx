"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ErrorCode, FileNode } from "@cloud/shared";
import { errorCodeOf } from "../../lib/api";
import { deleteForever, emptyTrash, getTrash, restoreFromTrash } from "../../lib/files-api";
import { useFormat, useT } from "../../lib/i18n/provider";
import { ConfirmDialog } from "../confirm-dialog";
import { FileIcon } from "../files/file-icon";
import { UsageMeter } from "../usage-meter";
import { useUsage } from "../usage-provider";

/** The number of days is the API's TRASH_RETENTION_DAYS; the web may import only types from it. */
const RETENTION_DAYS = 30;

type Items = { status: "loading" } | { status: "error"; code: ErrorCode } | ReadyItems;
interface ReadyItems {
  status: "ready";
  items: readonly FileNode[];
}

type Confirm =
  | { kind: "delete"; node: FileNode; returnFocus: HTMLElement | null }
  | { kind: "empty"; returnFocus: HTMLElement | null };

export function TrashView() {
  const all = useT();
  const t = all.trash;
  const format = useFormat();
  const { refresh: refreshUsage } = useUsage();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [state, setState] = useState<Items>({ status: "loading" });
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState<ErrorCode | null>(null);

  const load = useCallback(async () => {
    try {
      const { items } = await getTrash();
      setState({ status: "ready", items });
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

  const { items } = state;

  async function restore(node: FileNode) {
    setNotice("");
    setActionError(null);
    try {
      const restored = await restoreFromTrash(node.id);
      setNotice(t.notices.restored(restored.name));
      await load();
      headingRef.current?.focus();
    } catch (e) {
      setActionError(errorCodeOf(e));
    }
  }

  return (
    <>
      <div className="page-head">
        <h1 ref={headingRef} tabIndex={-1}>
          {t.title}
        </h1>
      </div>
      <p className="note">{t.retention(RETENTION_DAYS)}</p>
      <UsageMeter />
      <div className="toolbar">
        <button
          type="button"
          className="button button-danger"
          disabled={items.length === 0}
          onClick={(event) => {
            setConfirm({ kind: "empty", returnFocus: event.currentTarget });
          }}
        >
          {t.emptyTrash}
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
          <p className="empty-title">{t.empty.title}</p>
          <p className="note">{t.empty.hint}</p>
        </div>
      ) : (
        <table className="table files-table">
          <caption className="sr-only">{t.caption}</caption>
          <thead>
            <tr>
              <th scope="col">{t.name}</th>
              <th scope="col">{t.size}</th>
              <th scope="col">{t.trashed}</th>
              <th scope="col">
                <span className="sr-only">{t.actions}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((node) => (
              <tr key={node.id}>
                <td data-label={t.name} className="cell-wrap">
                  <span className="name-cell">
                    <FileIcon kind={node.kind} />
                    <span>{node.name}</span>
                  </span>
                </td>
                <td data-label={t.size}>
                  {node.kind === "folder" ? t.folder : format.bytes(node.size)}
                </td>
                <td data-label={t.trashed}>
                  {node.deletedAt === null ? "" : format.dateTime(node.deletedAt)}
                </td>
                <td data-label={t.actions}>
                  <div className="row-actions">
                    <button
                      type="button"
                      className="button button-quiet button-small"
                      aria-label={t.restoreLabel(node.name)}
                      onClick={() => {
                        void restore(node);
                      }}
                    >
                      {t.restore}
                    </button>
                    <button
                      type="button"
                      className="button button-quiet button-small button-danger-text"
                      aria-label={t.deleteForeverLabel(node.name)}
                      onClick={(event) => {
                        setConfirm({ kind: "delete", node, returnFocus: event.currentTarget });
                      }}
                    >
                      {t.deleteForever}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {confirm?.kind === "delete" ? (
        <ConfirmDialog
          title={t.confirm.deleteTitle}
          body={t.confirm.deleteBody(confirm.node.name)}
          cancelLabel={t.confirm.cancel}
          submitLabel={t.confirm.deleteSubmit}
          submittingLabel={t.confirm.deleting}
          onConfirm={async () => {
            await deleteForever(confirm.node.id);
            setConfirm(null);
            setNotice(t.notices.deleted(confirm.node.name));
            refreshUsage();
            await load();
            headingRef.current?.focus();
          }}
          onClose={() => {
            setConfirm(null);
          }}
          returnFocus={confirm.returnFocus}
        />
      ) : null}
      {confirm?.kind === "empty" ? (
        <ConfirmDialog
          title={t.confirm.emptyTitle}
          body={t.confirm.emptyBody(items.length)}
          cancelLabel={t.confirm.cancel}
          submitLabel={t.confirm.emptySubmit}
          submittingLabel={t.confirm.emptying}
          onConfirm={async () => {
            await emptyTrash();
            setConfirm(null);
            setNotice(t.notices.emptied);
            refreshUsage();
            await load();
            headingRef.current?.focus();
          }}
          onClose={() => {
            setConfirm(null);
          }}
          returnFocus={confirm.returnFocus}
        />
      ) : null}
    </>
  );
}
