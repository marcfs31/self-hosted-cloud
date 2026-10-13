"use client";

import { useEffect, useId, useRef, useState, type SubmitEvent } from "react";
import { errorCodeOf } from "../../lib/api";
import { useT } from "../../lib/i18n/provider";
import { useForm } from "../../lib/use-form";
import { Dialog } from "../dialog";
import { Field, FormAlert, SubmitButton } from "../form";

interface NameDialogProps {
  title: string;
  label: string;
  submitLabel: string;
  submittingLabel: string;
  requiredMessage: string;
  initialName: string;
  /** Selects the name without its extension, ready to be typed over. */
  selectStem?: boolean;
  /** Resolves when done (the parent then closes the dialog); a failure is shown in the dialog. */
  onSubmit: (name: string) => Promise<void>;
  onClose: () => void;
  returnFocus: HTMLElement | null;
}

/** One name field: used to create a folder and to rename an item. */
export function NameDialog({
  title,
  label,
  submitLabel,
  submittingLabel,
  requiredMessage,
  initialName,
  selectStem = false,
  onSubmit,
  onClose,
  returnFocus,
}: NameDialogProps) {
  const t = useT();
  const form = useForm();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(initialName);

  useEffect(() => {
    const input = inputRef.current;
    if (input && selectStem) {
      const dot = initialName.lastIndexOf(".");
      input.setSelectionRange(0, dot > 0 ? dot : initialName.length);
    }
  }, [initialName, selectStem]);

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === "") {
      form.fail(requiredMessage, inputRef);
      return;
    }
    void form.submit(async () => {
      try {
        await onSubmit(trimmed);
      } catch (e) {
        form.fail(t.errors[errorCodeOf(e)], inputRef);
      }
    });
  }

  return (
    <Dialog title={title} onClose={onClose} returnFocus={returnFocus}>
      <form onSubmit={submit} className="stack" noValidate>
        <Field
          id={inputId}
          label={label}
          autoComplete="off"
          spellCheck={false}
          data-autofocus=""
          inputRef={inputRef}
          state={form}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            form.clear();
          }}
        />
        <FormAlert form={form} />
        <div className="row-actions">
          <SubmitButton busy={form.busy} label={submitLabel} busyLabel={submittingLabel} />
          <button type="button" className="button button-quiet" onClick={onClose}>
            {t.files.dialogs.cancel}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
