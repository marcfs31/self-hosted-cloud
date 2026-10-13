"use client";

import { useId, useState } from "react";
import { useT } from "../../lib/i18n/provider";
import type { ConflictChoice } from "../../lib/upload-conflicts";
import { Dialog } from "../dialog";

interface ConflictDialogProps {
  name: string;
  canReplace: boolean;
  /** How many more conflicts wait after this one. */
  others: number;
  onChoose: (choice: ConflictChoice, applyToAll: boolean) => void;
  /** Escape: forget the whole selection. */
  onCancel: () => void;
  returnFocus: HTMLElement | null;
}

export function ConflictDialog({
  name,
  canReplace,
  others,
  onChoose,
  onCancel,
  returnFocus,
}: ConflictDialogProps) {
  const t = useT().files.dialogs.conflict;
  const checkId = useId();
  const [all, setAll] = useState(false);
  const applyToAll = others > 0 && all;

  return (
    <Dialog title={t.title} onClose={onCancel} returnFocus={returnFocus}>
      <p className="cell-wrap">{t.body(name)}</p>
      {canReplace ? null : <p className="note">{t.folderNote}</p>}
      {others > 0 ? (
        <div className="check">
          <input
            id={checkId}
            type="checkbox"
            checked={all}
            onChange={(event) => {
              setAll(event.target.checked);
            }}
          />
          <label htmlFor={checkId}>{t.applyToAll(others)}</label>
        </div>
      ) : null}
      <div className="row-actions">
        {canReplace ? (
          <button
            type="button"
            className="button"
            onClick={() => {
              onChoose("replace", applyToAll);
            }}
          >
            {t.replace}
          </button>
        ) : null}
        <button
          type="button"
          className="button"
          data-autofocus=""
          onClick={() => {
            onChoose("keepBoth", applyToAll);
          }}
        >
          {t.keepBoth}
        </button>
        <button
          type="button"
          className="button button-quiet"
          onClick={() => {
            onChoose("skip", applyToAll);
          }}
        >
          {t.skip}
        </button>
      </div>
    </Dialog>
  );
}
