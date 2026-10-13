"use client";

import { useEffect, useRef, useState } from "react";
import {
  CAMERA_FOLDER,
  canHash,
  ensureCameraFolder,
  findExisting,
  hashFile,
  planBackup,
  type Hashed,
} from "../../lib/backup";
import { useT } from "../../lib/i18n/provider";
import { useForm } from "../../lib/use-form";
import { FolderPickerDialog } from "../files/folder-picker-dialog";
import { FormAlert } from "../form";
import { useTrackedUploads } from "../uploads/use-tracked-uploads";
import { useUploads } from "../uploads/uploads-provider";
import { useUsage } from "../usage-provider";

type Destination = { kind: "default" } | { kind: "folder"; id: string; name: string };

interface Run {
  alreadyBackedUp: number;
  unchecked: number;
  unreadable: number;
}

export function BackupView() {
  const all = useT();
  const t = all.pwa.backup;
  const uploads = useUploads();
  const tracked = useTrackedUploads();
  const { refresh: refreshUsage } = useUsage();
  const form = useForm();
  const pickInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const chooseButton = useRef<HTMLButtonElement>(null);
  const [destination, setDestination] = useState<Destination>({ kind: "default" });
  const [picking, setPicking] = useState(false);
  const [checking, setChecking] = useState<{ done: number; total: number } | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [secure, setSecure] = useState(true);

  // crypto.subtle only exists on https or localhost; known after mount, so the server render matches.
  useEffect(() => {
    setSecure(canHash());
  }, []);

  const seenCompleted = useRef(uploads.completed);
  useEffect(() => {
    if (uploads.completed !== seenCompleted.current) {
      seenCompleted.current = uploads.completed;
      refreshUsage();
    }
  }, [uploads.completed, refreshUsage]);

  const busy = form.busy || checking !== null;

  function start(files: File[]) {
    if (files.length === 0) {
      return;
    }
    setRun(null);
    tracked.track([]);
    void form.submit(async () => {
      try {
        const hashed: Hashed[] = [];
        for (const file of files) {
          setChecking({ done: hashed.length, total: files.length });
          hashed.push(await hashFile(file));
        }
        setChecking({ done: files.length, total: files.length });
        const hashes = hashed.flatMap((h) => (h.kind === "hashed" ? [h.sha256] : []));
        const plan = planBackup(hashed, await findExisting(hashes));
        if (plan.toUpload.length > 0) {
          const parentId =
            destination.kind === "folder" ? destination.id : await ensureCameraFolder();
          tracked.track(
            uploads.enqueue(
              plan.toUpload.map((file) => ({ file, replaceId: null })),
              parentId,
            ),
          );
        }
        setRun({
          alreadyBackedUp: plan.alreadyBackedUp,
          unchecked: plan.unchecked,
          unreadable: plan.unreadable,
        });
      } finally {
        setChecking(null);
      }
    });
  }

  const failed = tracked.failed + (run?.unreadable ?? 0);
  const status = checking
    ? t.checking(checking.done, checking.total)
    : run && tracked.pending > 0
      ? t.uploading(tracked.done + tracked.failed + tracked.cancelled, tracked.total)
      : "";
  const finished = run !== null && !busy && tracked.pending === 0;

  return (
    <div className="stack">
      <h1>{t.title}</h1>
      <p>{t.intro}</p>
      <p className="note">{t.limits}</p>
      {secure ? null : (
        <p role="alert" className="alert">
          {t.insecure}
        </p>
      )}
      <div className="stack-tight">
        <p className="cell-wrap">
          {destination.kind === "folder"
            ? t.destinationChosen(destination.name)
            : t.destinationDefault(CAMERA_FOLDER)}
        </p>
        <div className="row-actions">
          <button
            ref={chooseButton}
            type="button"
            className="button button-quiet button-small"
            disabled={busy}
            onClick={() => {
              setPicking(true);
            }}
          >
            {t.chooseFolder}
          </button>
          {destination.kind === "folder" ? (
            <button
              type="button"
              className="button button-quiet button-small"
              disabled={busy}
              onClick={() => {
                setDestination({ kind: "default" });
              }}
            >
              {t.useDefault}
            </button>
          ) : null}
        </div>
      </div>
      <div className="row-actions">
        <button
          type="button"
          className="button"
          disabled={busy || !secure}
          aria-busy={busy}
          onClick={() => pickInput.current?.click()}
        >
          {t.choose}
        </button>
        <button
          type="button"
          className="button button-quiet"
          disabled={busy || !secure}
          onClick={() => cameraInput.current?.click()}
        >
          {t.take}
        </button>
        <input
          ref={pickInput}
          type="file"
          multiple
          hidden
          accept="image/*,video/*"
          data-testid="backup-pick"
          onChange={(event) => {
            const input = event.currentTarget;
            const chosen = Array.from(input.files ?? []);
            input.value = "";
            start(chosen);
          }}
        />
        <input
          ref={cameraInput}
          type="file"
          hidden
          accept="image/*"
          capture="environment"
          data-testid="backup-camera"
          onChange={(event) => {
            const input = event.currentTarget;
            const chosen = Array.from(input.files ?? []);
            input.value = "";
            start(chosen);
          }}
        />
      </div>
      <FormAlert form={form} />
      <div role="status" className="stack-tight">
        {status === "" ? null : <p>{status}</p>}
        {finished ? (
          <>
            <p className="summary">{t.summary(run.alreadyBackedUp, tracked.done, failed)}</p>
            {tracked.cancelled > 0 ? <p>{t.cancelled(tracked.cancelled)}</p> : null}
            {run.unchecked > 0 ? <p className="note">{t.unchecked(run.unchecked)}</p> : null}
            {tracked.failed > 0 ? <p className="note">{t.failedHint}</p> : null}
          </>
        ) : null}
      </div>
      {picking ? (
        <FolderPickerDialog
          title={t.pickerTitle}
          startFolderId={destination.kind === "folder" ? destination.id : null}
          returnFocus={chooseButton.current}
          onPick={(id, name) => {
            setDestination({ kind: "folder", id, name });
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
