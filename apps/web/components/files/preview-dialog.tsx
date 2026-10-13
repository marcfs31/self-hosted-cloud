"use client";

import { useEffect, useRef, useState } from "react";
import type { ErrorCode, FileNode } from "@cloud/shared";
import { errorCodeOf } from "../../lib/api";
import { contentHref, downloadHref, getTextPreview } from "../../lib/files-api";
import { useFormat, useT } from "../../lib/i18n/provider";
import { previewKind, stepIndex, TEXT_PREVIEW_BYTES, type TextPreview } from "../../lib/preview";
import { Dialog } from "../dialog";

/** Marks the control that opens the preview of a file, so focus can go back to it. */
export function previewTriggerProps(fileId: string): { "data-preview-trigger": string } {
  return { "data-preview-trigger": fileId };
}

function findPreviewTrigger(fileId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-preview-trigger="${CSS.escape(fileId)}"]`);
}

type TextState =
  | { status: "loading" }
  | { status: "error"; code: ErrorCode }
  | { status: "ready"; preview: TextPreview };

function TextContent({ node }: { node: FileNode }) {
  const all = useT();
  const t = all.search.preview;
  const format = useFormat();
  const [state, setState] = useState<TextState>(
    node.size === 0
      ? { status: "ready", preview: { text: "", truncated: false } }
      : { status: "loading" },
  );
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (node.size === 0) {
      return;
    }
    const controller = new AbortController();
    void (async () => {
      try {
        const preview = await getTextPreview(node.id, node.size, controller.signal);
        if (!controller.signal.aborted) {
          setState({ status: "ready", preview });
        }
      } catch (e) {
        if (!controller.signal.aborted) {
          setState({ status: "error", code: errorCodeOf(e) });
        }
      }
    })();
    return () => {
      controller.abort();
    };
  }, [node.id, node.size, attempt]);

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
              setState({ status: "loading" });
              setAttempt((n) => n + 1);
            }}
          >
            {all.common.app.retry}
          </button>
        </div>
      </div>
    );
  }
  const { text, truncated } = state.preview;
  if (text === "") {
    return <p>{t.empty}</p>;
  }
  return (
    <div className="preview-text-wrap">
      {truncated ? (
        <p role="status" className="note">
          {t.truncated(format.bytes(TEXT_PREVIEW_BYTES), format.bytes(node.size))}
        </p>
      ) : null}
      <pre className="preview-text" tabIndex={0} role="region" aria-label={node.name}>
        {text}
      </pre>
    </div>
  );
}

function MediaContent({ node }: { node: FileNode }) {
  const all = useT();
  const kind = previewKind(node.mime);
  const href = contentHref(node.id);
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <p role="alert" className="alert">
        {all.errors.internal}
      </p>
    );
  }
  const onError = () => {
    setFailed(true);
  };
  switch (kind) {
    case "image":
      return <img className="preview-media" src={href} alt={node.name} onError={onError} />;
    case "video":
      return (
        <video className="preview-media" src={href} controls preload="metadata" onError={onError} />
      );
    case "audio":
      return (
        <audio className="preview-audio" src={href} controls preload="metadata" onError={onError} />
      );
    default:
      return <iframe className="preview-fill" src={href} title={node.name} />;
  }
}

function PreviewContent({ node }: { node: FileNode }) {
  const t = useT().search.preview;
  const kind = previewKind(node.mime);
  if (kind === "text") {
    return <TextContent node={node} />;
  }
  if (kind === "none") {
    return <p>{t.unavailable}</p>;
  }
  return <MediaContent node={node} />;
}

interface PreviewDialogProps {
  /** The files to step through, in order; `startId` is one of them. */
  files: readonly FileNode[];
  startId: string;
  onClose: () => void;
}

/**
 * A full-screen preview of a file, with next and previous among `files`. Focus goes back to the
 * control marked by previewTriggerProps for the file shown last.
 */
export function PreviewDialog({ files, startId, onClose }: PreviewDialogProps) {
  const all = useT();
  const t = all.search.preview;
  const format = useFormat();
  const [currentId, setCurrentId] = useState(startId);
  const shownId = useRef(startId);
  const closeButton = useRef<HTMLButtonElement>(null);
  const index = files.findIndex((file) => file.id === currentId);
  const node = files[index];
  shownId.current = currentId;

  // The file left the listing (trashed or moved elsewhere): there is nothing to show.
  useEffect(() => {
    if (index === -1) {
      onClose();
    }
  }, [index, onClose]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }
      if (event.shiftKey || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) {
        return;
      }
      // Media controls and fields use the arrow keys themselves.
      const target = event.target;
      if (
        target instanceof HTMLMediaElement ||
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
        return;
      }
      const next = stepIndex(index, files.length, event.key === "ArrowRight" ? 1 : -1);
      const file = next === null ? undefined : files[next];
      if (file) {
        event.preventDefault();
        setCurrentId(file.id);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [files, index]);

  // A button that becomes disabled at the end of the list must not take the focus with it.
  useEffect(() => {
    const active = document.activeElement;
    if (active === document.body || (active instanceof HTMLButtonElement && active.disabled)) {
      closeButton.current?.focus();
    }
  }, [currentId]);

  if (!node) {
    return null;
  }

  function go(direction: 1 | -1) {
    const next = stepIndex(index, files.length, direction);
    const file = next === null ? undefined : files[next];
    if (file) {
      setCurrentId(file.id);
    }
  }

  return (
    <Dialog
      title={node.name}
      className="dialog-full"
      onClose={onClose}
      returnFocus={() => findPreviewTrigger(shownId.current)}
    >
      <div className="preview-bar" role="group" aria-label={t.controls}>
        <button
          type="button"
          className="button button-quiet"
          disabled={index === 0}
          onClick={() => {
            go(-1);
          }}
        >
          {t.previous}
        </button>
        <button
          type="button"
          className="button button-quiet"
          disabled={index === files.length - 1}
          onClick={() => {
            go(1);
          }}
        >
          {t.next}
        </button>
        <p role="status" className="note">
          <span className="sr-only">{node.name}, </span>
          {t.position(index + 1, files.length)}
        </p>
        <a className="button preview-download" href={downloadHref(node.id)} download="">
          {t.download}
        </a>
        <button
          ref={closeButton}
          type="button"
          className="button button-quiet"
          data-autofocus
          onClick={onClose}
        >
          {all.files.dialogs.close}
        </button>
      </div>
      <p className="note">
        {format.bytes(node.size)} · {format.dateTime(node.updatedAt)}
      </p>
      <div className="preview-stage">
        <PreviewContent key={node.id} node={node} />
      </div>
    </Dialog>
  );
}
