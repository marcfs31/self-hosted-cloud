"use client";

import { useEffect, useRef, useState } from "react";
import type { PublicShareInfo } from "@cloud/shared";
import { dragHasFiles, droppedFiles } from "../../lib/drop-files";
import { useFormat, useT } from "../../lib/i18n/provider";
import { publicUploadEndpoint } from "../../lib/shares-api";
import { UploadPanel } from "../uploads/upload-panel";
import { UploadsProvider, useUploads } from "../uploads/uploads-provider";

function DropBoxContent({ info }: { info: PublicShareInfo }) {
  const t = useT().shares.public;
  const format = useFormat();
  const uploads = useUploads();
  const fileInput = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);

  // A file dropped beside the zone would make the browser leave the page and lose the uploads.
  useEffect(() => {
    function keepPage(event: globalThis.DragEvent) {
      if (event.dataTransfer?.types.includes("Files") === true) {
        event.preventDefault();
      }
    }
    window.addEventListener("dragover", keepPage);
    window.addEventListener("drop", keepPage);
    return () => {
      window.removeEventListener("dragover", keepPage);
      window.removeEventListener("drop", keepPage);
    };
  }, []);

  // The provider uploads to the drop box's own endpoint, so no folder is named here.
  function send(files: File[]) {
    if (files.length > 0) {
      uploads.enqueue(
        files.map((file) => ({ file, replaceId: null })),
        "",
      );
    }
  }

  return (
    <>
      <h1 className="cell-wrap">{t.dropbox.title(info.name)}</h1>
      <p>{t.dropbox.intro}</p>
      {info.expiresAt ? <p className="note">{t.expiresOn(format.date(info.expiresAt))}</p> : null}
      <div
        className={dragging ? "dropzone dropzone-active dropbox" : "dropzone dropbox"}
        onDragEnter={(event) => {
          if (dragHasFiles(event)) {
            event.preventDefault();
            dragDepth.current += 1;
            setDragging(true);
          }
        }}
        onDragOver={(event) => {
          if (dragHasFiles(event)) {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
          }
        }}
        onDragLeave={(event) => {
          if (dragHasFiles(event)) {
            dragDepth.current = Math.max(0, dragDepth.current - 1);
            if (dragDepth.current === 0) {
              setDragging(false);
            }
          }
        }}
        onDrop={(event) => {
          if (dragHasFiles(event)) {
            event.preventDefault();
            dragDepth.current = 0;
            setDragging(false);
            send(droppedFiles(event));
          }
        }}
      >
        <p className="drop-hint">{dragging ? t.dropbox.dropActive : t.dropbox.dropHint}</p>
        <div className="toolbar">
          <button
            type="button"
            className="button"
            onClick={() => {
              fileInput.current?.click();
            }}
          >
            {t.dropbox.choose}
          </button>
        </div>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(event) => {
            const input = event.currentTarget;
            const chosen = Array.from(input.files ?? []);
            input.value = "";
            send(chosen);
          }}
        />
      </div>
      <UploadPanel errors={{ quota_exceeded: t.dropbox.full, not_found: t.dropbox.gone }} />
    </>
  );
}

/** Upload-only: visitors send files into the shared folder and never see what it holds. */
export function DropBox({ token, info }: { token: string; info: PublicShareInfo }) {
  return (
    <UploadsProvider endpoint={publicUploadEndpoint(token)}>
      <DropBoxContent info={info} />
    </UploadsProvider>
  );
}
