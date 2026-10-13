"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ErrorCode, FileNode, FileVersion } from "@cloud/shared";
import { errorCodeOf } from "../../lib/api";
import {
  deleteVersion,
  getVersions,
  restoreVersion,
  versionDownloadHref,
} from "../../lib/files-api";
import { useFormat, useT } from "../../lib/i18n/provider";
import { useForm } from "../../lib/use-form";
import { Dialog } from "../dialog";
import { FormAlert } from "../form";

interface VersionsDialogProps {
  file: FileNode;
  /** Something changed (a restore or a delete): the listing behind the dialog is stale. */
  onChanged: () => void;
  onClose: () => void;
  returnFocus: HTMLElement | null;
}

type Versions =
  | { status: "loading" }
  | { status: "error"; code: ErrorCode }
  | { status: "ready"; versions: readonly FileVersion[] };

export function VersionsDialog({ file, onChanged, onClose, returnFocus }: VersionsDialogProps) {
  const all = useT();
  const t = all.files.versions;
  const format = useFormat();
  const form = useForm();
  const [state, setState] = useState<Versions>({ status: "loading" });
  const [confirming, setConfirming] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);

  const load = useCallback(async () => {
    try {
      const { versions } = await getVersions(file.id);
      setState({ status: "ready", versions });
    } catch (e) {
      setState({ status: "error", code: errorCodeOf(e) });
    }
  }, [file.id]);

  useEffect(() => {
    void load();
  }, [load]);

  function restore(version: FileVersion, number: number) {
    setNotice("");
    void form.submit(async () => {
      await restoreVersion(file.id, version.id);
      await load();
      onChanged();
      setNotice(t.restored(number));
    });
  }

  function remove(version: FileVersion, number: number) {
    setNotice("");
    void form.submit(async () => {
      await deleteVersion(file.id, version.id);
      setConfirming(null);
      await load();
      onChanged();
      setNotice(t.deleted(number));
      closeRef.current?.focus();
    });
  }

  const versions = state.status === "ready" ? state.versions : [];

  return (
    <Dialog title={t.title(file.name)} onClose={onClose} returnFocus={returnFocus}>
      <p className="note">{t.note}</p>
      {state.status === "error" ? (
        <p role="alert" className="alert">
          {all.errors[state.code]}
        </p>
      ) : state.status === "loading" ? (
        <p role="status">{t.loading}</p>
      ) : (
        <ul className="versions" aria-label={t.listLabel}>
          {versions.map((version, index) => {
            const number = versions.length - index;
            return (
              <li key={version.id} className="version">
                <p className="version-head">
                  <strong>{t.version(number)}</strong>
                  {version.current ? <span className="badge">{t.current}</span> : null}
                </p>
                <p className="note">
                  {format.dateTime(version.createdAt)} · {format.bytes(version.size)}
                </p>
                {confirming === version.id ? (
                  <div className="stack">
                    <p>{t.confirmDelete(number)}</p>
                    <div className="row-actions">
                      <button
                        type="button"
                        className="button button-quiet"
                        autoFocus
                        onClick={() => {
                          setConfirming(null);
                          closeRef.current?.focus();
                        }}
                      >
                        {t.keep}
                      </button>
                      <button
                        type="button"
                        className="button button-danger"
                        disabled={form.busy}
                        onClick={() => {
                          remove(version, number);
                        }}
                      >
                        {t.confirmYes}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="row-actions">
                    <a
                      className="button button-quiet button-small"
                      href={versionDownloadHref(file.id, version.id)}
                      download=""
                      aria-label={t.downloadLabel(number)}
                    >
                      {t.download}
                    </a>
                    {version.current ? null : (
                      <>
                        <button
                          type="button"
                          className="button button-quiet button-small"
                          disabled={form.busy}
                          aria-label={t.restoreLabel(number)}
                          onClick={() => {
                            restore(version, number);
                          }}
                        >
                          {t.restore}
                        </button>
                        <button
                          type="button"
                          className="button button-quiet button-small button-danger-text"
                          disabled={form.busy}
                          aria-label={t.deleteLabel(number)}
                          onClick={() => {
                            form.clear();
                            setNotice("");
                            setConfirming(version.id);
                          }}
                        >
                          {t.delete}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <FormAlert form={form} />
      <p role="status" className="note">
        {notice}
      </p>
      <div className="row-actions">
        <button ref={closeRef} type="button" className="button" data-autofocus="" onClick={onClose}>
          {all.files.dialogs.close}
        </button>
      </div>
    </Dialog>
  );
}
