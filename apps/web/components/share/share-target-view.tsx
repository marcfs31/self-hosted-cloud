"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { getRoot } from "../../lib/files-api";
import { useFormat, useT } from "../../lib/i18n/provider";
import {
  clearShared,
  loadShared,
  pruneSharedFiles,
  sharedFilesSupported,
} from "../../lib/share-store";
import { isShareId } from "../../sw/sw-shared";
import { useForm } from "../../lib/use-form";
import { FolderPickerDialog } from "../files/folder-picker-dialog";
import { FormAlert } from "../form";
import { useTrackedUploads } from "../uploads/use-tracked-uploads";
import { useUploads } from "../uploads/uploads-provider";
import { useUsage } from "../usage-provider";

type Shared =
  | { status: "loading" }
  | { status: "unsupported" }
  | { status: "ready"; files: File[] }
  | { status: "empty" };

interface Destination {
  /** Null is the person's root folder. */
  id: string | null;
  name: string | null;
}

/** The page the Android share sheet lands on: lists what was shared and uploads it to a folder. */
export function ShareTargetView({ shareId }: { shareId: string | null }) {
  const all = useT();
  const t = all.pwa.share;
  const format = useFormat();
  const uploads = useUploads();
  const tracked = useTrackedUploads();
  const { refresh: refreshUsage } = useUsage();
  const form = useForm();
  const chooseButton = useRef<HTMLButtonElement>(null);
  const [shared, setShared] = useState<Shared>({ status: "loading" });
  const [destination, setDestination] = useState<Destination>({ id: null, name: null });
  const [picking, setPicking] = useState(false);
  const [discarded, setDiscarded] = useState(false);
  const [sent, setSent] = useState<{ folderId: string } | null>(null);

  useEffect(() => {
    let stale = false;
    if (!sharedFilesSupported()) {
      setShared({ status: "unsupported" });
      return;
    }
    if (!isShareId(shareId)) {
      setShared({ status: "empty" });
      return;
    }
    pruneSharedFiles()
      .catch(() => undefined)
      .then(() => loadShared(shareId))
      .then(
        (files) => {
          if (!stale) {
            setShared(files.length === 0 ? { status: "empty" } : { status: "ready", files });
          }
        },
        () => {
          if (!stale) {
            setShared({ status: "empty" });
          }
        },
      );
    return () => {
      stale = true;
    };
  }, [shareId]);

  const clean = tracked.settled && tracked.failed === 0 && tracked.cancelled === 0;
  useEffect(() => {
    if (clean && isShareId(shareId)) {
      refreshUsage();
      void clearShared(shareId).catch(() => undefined);
    }
  }, [clean, shareId, refreshUsage]);

  const folderLabel = destination.name ?? all.files.rootName;

  function upload(files: File[]) {
    void form.submit(async () => {
      const parentId = destination.id ?? (await getRoot()).folder.id;
      tracked.track(
        uploads.enqueue(
          files.map((file) => ({ file, replaceId: null })),
          parentId,
        ),
      );
      setSent({ folderId: parentId });
    });
  }

  async function discard() {
    if (isShareId(shareId)) {
      await clearShared(shareId).catch(() => undefined);
    }
    setShared({ status: "empty" });
    setDiscarded(true);
  }

  if (shared.status === "loading") {
    return <p role="status">{t.loading}</p>;
  }
  if (shared.status === "unsupported") {
    return (
      <div className="stack">
        <h1>{t.title}</h1>
        <p role="alert" className="alert">
          {t.unsupported}
        </p>
      </div>
    );
  }
  if (shared.status === "empty") {
    return (
      <div className="stack">
        <h1>{t.title}</h1>
        {discarded ? <p role="status">{t.discarded}</p> : null}
        <div className="card empty">
          <p className="empty-title">{t.empty.title}</p>
          <p className="note">{t.empty.hint}</p>
        </div>
        <div>
          <Link href="/" className="button button-quiet">
            {t.empty.back}
          </Link>
        </div>
      </div>
    );
  }

  const { files } = shared;
  return (
    <div className="stack">
      <h1>{t.title}</h1>
      <p>{t.count(files.length)}</p>
      <ul className="versions" aria-label={t.listLabel}>
        {files.map((file, index) => (
          <li key={`${String(index)}-${file.name}`} className="version">
            <span className="cell-wrap">{file.name}</span>
            <span className="note">{format.bytes(file.size)}</span>
          </li>
        ))}
      </ul>
      <p className="cell-wrap">{t.destination(folderLabel)}</p>
      <div className="row-actions">
        <button
          ref={chooseButton}
          type="button"
          className="button button-quiet"
          disabled={form.busy || sent !== null}
          onClick={() => {
            setPicking(true);
          }}
        >
          {t.chooseFolder}
        </button>
      </div>
      <FormAlert form={form} />
      <div role="status" className="stack-tight">
        {sent && !tracked.settled ? <p>{t.uploading}</p> : null}
        {sent && tracked.settled ? (
          <>
            <p>
              {tracked.failed + tracked.cancelled === 0
                ? t.finished(tracked.done, folderLabel)
                : t.withFailures(tracked.done, tracked.failed + tracked.cancelled)}
            </p>
            <Link href={`/folders/${sent.folderId}`} className="button button-quiet">
              {t.openFolder}
            </Link>
          </>
        ) : null}
      </div>
      {sent ? null : (
        <div className="row-actions">
          <button
            type="button"
            className="button"
            disabled={form.busy}
            aria-busy={form.busy}
            onClick={() => {
              upload(files);
            }}
          >
            {t.upload}
          </button>
          <button
            type="button"
            className="button button-quiet"
            disabled={form.busy}
            onClick={() => {
              void discard();
            }}
          >
            {t.discard}
          </button>
        </div>
      )}
      {picking ? (
        <FolderPickerDialog
          title={t.pickerTitle}
          startFolderId={destination.id}
          returnFocus={chooseButton.current}
          onPick={(id, name) => {
            setDestination({ id, name });
            setPicking(false);
          }}
          onClose={() => {
            setPicking(false);
          }}
        />
      ) : null}
    </div>
  );
}
