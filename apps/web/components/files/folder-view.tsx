"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import type { ErrorCode, FileNode } from "@cloud/shared";
import { errorCodeOf } from "../../lib/api";
import { createFolder, trashFile, updateFile } from "../../lib/files-api";
import { useT } from "../../lib/i18n/provider";
import {
  currentConflict,
  isResolved,
  planUploads,
  resolveConflict,
  startConflicts,
  undecidedCount,
  type ConflictChoice,
  type ConflictState,
} from "../../lib/upload-conflicts";
import { useFolder } from "../../lib/use-folder";
import { NotFoundState } from "../not-found-state";
import { UsageMeter } from "../usage-meter";
import { useUsage } from "../usage-provider";
import { useUploads } from "../uploads/uploads-provider";
import { Breadcrumbs } from "./breadcrumbs";
import { ConflictDialog } from "./conflict-dialog";
import { FileTable, type RowAction } from "./file-table";
import { MoveDialog } from "./move-dialog";
import { NameDialog } from "./name-dialog";
import { VersionsDialog } from "./versions-dialog";

type DialogState =
  | { kind: "newFolder"; returnFocus: HTMLElement | null }
  | { kind: "rename" | "move" | "versions"; node: FileNode; returnFocus: HTMLElement | null };

interface PendingUpload {
  parentId: string;
  entries: readonly { key: string; file: File; existing: FileNode | null }[];
  conflicts: ConflictState;
  returnFocus: HTMLElement | null;
}

function dragHasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer.types).includes("Files");
}

/** Files dropped from the desktop; folders are left out because only files upload. */
function droppedFiles(event: DragEvent): File[] {
  const files: File[] = [];
  for (const item of Array.from(event.dataTransfer.items)) {
    if (item.kind !== "file" || item.webkitGetAsEntry()?.isDirectory === true) {
      continue;
    }
    const file = item.getAsFile();
    if (file) {
      files.push(file);
    }
  }
  return files;
}

export function FolderView({ folderId }: { folderId: string | null }) {
  const all = useT();
  const t = all.files;
  const { state, reload } = useFolder(folderId);
  const uploads = useUploads();
  const { refresh: refreshUsage } = useUsage();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [pending, setPending] = useState<PendingUpload | null>(null);
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState<ErrorCode | null>(null);
  const [dragging, setDragging] = useState(false);

  // A finished upload changes the listing and the storage in use.
  const seenCompleted = useRef(uploads.completed);
  useEffect(() => {
    if (uploads.completed !== seenCompleted.current) {
      seenCompleted.current = uploads.completed;
      void reload();
      refreshUsage();
    }
  }, [uploads.completed, reload, refreshUsage]);

  // A file dropped beside the listing would make the browser leave the page and lose the uploads.
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

  if (state.status === "loading") {
    return <p role="status">{t.loading}</p>;
  }
  if (state.status === "error") {
    if (state.code === "not_found") {
      return <NotFoundState />;
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
              void reload();
            }}
          >
            {all.common.app.retry}
          </button>
        </div>
      </div>
    );
  }

  const { folder, breadcrumbs, children } = state.listing;
  const crumbName = breadcrumbs.at(-1)?.name ?? "";
  const title = crumbName === "" ? t.rootName : crumbName;

  function chooseFiles(files: File[], returnFocus: HTMLElement | null) {
    if (files.length === 0) {
      return;
    }
    const byName = new Map(children.map((child) => [child.name, child]));
    const entries = files.map((file, index) => ({
      key: String(index),
      file,
      existing: byName.get(file.name.normalize("NFC")) ?? null,
    }));
    const conflicts = entries.flatMap((entry) =>
      entry.existing ? [{ key: entry.key, canReplace: entry.existing.kind === "file" }] : [],
    );
    if (conflicts.length === 0) {
      uploads.enqueue(
        entries.map((entry) => ({ file: entry.file, replaceId: null })),
        folder.id,
      );
      return;
    }
    setPending({ parentId: folder.id, entries, conflicts: startConflicts(conflicts), returnFocus });
  }

  function choose(choice: ConflictChoice, applyToAll: boolean) {
    if (!pending) {
      return;
    }
    const conflicts = resolveConflict(pending.conflicts, choice, applyToAll);
    if (!isResolved(conflicts)) {
      setPending({ ...pending, conflicts });
      return;
    }
    const plan = planUploads(pending.entries, (entry) => entry.existing?.id ?? null, conflicts);
    uploads.enqueue(
      plan.map((p) => ({ file: p.item.file, replaceId: p.replaceId })),
      pending.parentId,
    );
    setPending(null);
  }

  function onAction(action: RowAction, node: FileNode, trigger: HTMLButtonElement) {
    setNotice("");
    setActionError(null);
    if (action === "trash") {
      void (async () => {
        try {
          await trashFile(node.id);
          setNotice(t.notices.trashed(node.name));
          await reload();
          headingRef.current?.focus();
        } catch (e) {
          setActionError(errorCodeOf(e));
        }
      })();
      return;
    }
    setDialog({ kind: action, node, returnFocus: trigger });
  }

  function closeDialog() {
    setDialog(null);
  }

  const conflict = pending ? currentConflict(pending.conflicts) : null;
  const conflictEntry = pending?.entries.find((entry) => entry.key === conflict?.key);

  return (
    <>
      <Breadcrumbs crumbs={breadcrumbs} />
      <div className="page-head">
        <h1 ref={headingRef} tabIndex={-1} className="cell-wrap">
          {title}
        </h1>
        <span className="note">{t.itemCount(children.length)}</span>
      </div>
      <UsageMeter />
      <div className="toolbar" role="group" aria-label={t.toolbar.label}>
        <button
          type="button"
          className="button"
          onClick={(event) => {
            setDialog({ kind: "newFolder", returnFocus: event.currentTarget });
          }}
        >
          {t.toolbar.newFolder}
        </button>
        <button
          type="button"
          className="button"
          onClick={() => {
            fileInput.current?.click();
          }}
        >
          {t.toolbar.upload}
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(event) => {
            const input = event.currentTarget;
            const chosen = Array.from(input.files ?? []);
            input.value = "";
            chooseFiles(chosen, document.activeElement as HTMLElement | null);
          }}
        />
      </div>
      <p role="status" className="note">
        {notice}
      </p>
      {actionError ? (
        <p role="alert" className="alert">
          {all.errors[actionError]}
        </p>
      ) : null}
      <div
        className={dragging ? "dropzone dropzone-active" : "dropzone"}
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
            chooseFiles(droppedFiles(event), null);
          }
        }}
      >
        {dragging ? <p className="drop-hint">{t.drop.active(title)}</p> : null}
        {children.length === 0 ? (
          <div className="empty">
            <p className="empty-title">{t.empty.title}</p>
            <p className="note">{t.empty.hint}</p>
          </div>
        ) : (
          <FileTable folderName={title} nodes={children} onAction={onAction} />
        )}
      </div>

      {dialog?.kind === "newFolder" ? (
        <NameDialog
          title={t.dialogs.newFolder.title}
          label={t.dialogs.newFolder.label}
          submitLabel={t.dialogs.newFolder.submit}
          submittingLabel={t.dialogs.newFolder.submitting}
          requiredMessage={t.dialogs.newFolder.required}
          initialName=""
          onSubmit={async (name) => {
            const created = await createFolder({ parentId: folder.id, name });
            closeDialog();
            setNotice(t.notices.created(created.name));
            await reload();
          }}
          onClose={closeDialog}
          returnFocus={dialog.returnFocus}
        />
      ) : null}
      {dialog?.kind === "rename" ? (
        <NameDialog
          title={t.dialogs.rename.title(dialog.node.name)}
          label={t.dialogs.rename.label}
          submitLabel={t.dialogs.rename.submit}
          submittingLabel={t.dialogs.rename.submitting}
          requiredMessage={t.dialogs.rename.required}
          initialName={dialog.node.name}
          selectStem={dialog.node.kind === "file"}
          onSubmit={async (name) => {
            if (name !== dialog.node.name) {
              const renamed = await updateFile(dialog.node.id, { name });
              setNotice(t.notices.renamed(renamed.name));
              await reload();
            }
            closeDialog();
          }}
          onClose={closeDialog}
          returnFocus={dialog.returnFocus}
        />
      ) : null}
      {dialog?.kind === "move" ? (
        <MoveDialog
          node={dialog.node}
          startFolderId={folder.id}
          onMoved={(moved, folderName) => {
            closeDialog();
            setNotice(t.notices.moved(moved.name, folderName));
            void reload();
          }}
          onClose={closeDialog}
          returnFocus={dialog.returnFocus}
        />
      ) : null}
      {dialog?.kind === "versions" ? (
        <VersionsDialog
          file={dialog.node}
          onChanged={() => {
            void reload();
            refreshUsage();
          }}
          onClose={closeDialog}
          returnFocus={dialog.returnFocus}
        />
      ) : null}
      {pending && conflict && conflictEntry ? (
        <ConflictDialog
          key={conflict.key}
          name={conflictEntry.file.name}
          canReplace={conflict.canReplace}
          others={undecidedCount(pending.conflicts) - 1}
          onChoose={choose}
          onCancel={() => {
            setPending(null);
          }}
          returnFocus={pending.returnFocus}
        />
      ) : null}
    </>
  );
}
