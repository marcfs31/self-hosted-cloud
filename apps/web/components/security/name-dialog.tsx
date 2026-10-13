"use client";

import { useId, useRef, useState, type SubmitEvent } from "react";
import { useT } from "../../lib/i18n/provider";
import { useForm } from "../../lib/use-form";
import { Dialog } from "../dialog";
import { Field, FormAlert, SubmitButton } from "../form";

interface NameDialogProps {
  title: string;
  label: string;
  hint: string;
  requiredMessage: string;
  submitLabel: string;
  submittingLabel: string;
  /**
   * Resolves when done (the parent then closes the dialog). A thrown API error is shown in the
   * dialog; `fail` shows any other message and keeps the dialog open.
   */
  onSubmit: (name: string, fail: (text: string) => void) => Promise<void>;
  onClose: () => void;
  returnFocus: HTMLElement | null;
}

/** One required name, for a new passkey or app password. */
export function SecurityNameDialog({
  title,
  label,
  hint,
  requiredMessage,
  submitLabel,
  submittingLabel,
  onSubmit,
  onClose,
  returnFocus,
}: NameDialogProps) {
  const t = useT().security;
  const form = useForm();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === "") {
      form.fail(requiredMessage, inputRef);
      return;
    }
    void form.submit(() =>
      onSubmit(trimmed, (text) => {
        form.fail(text, inputRef);
      }),
    );
  }

  return (
    <Dialog title={title} onClose={onClose} returnFocus={returnFocus}>
      <form onSubmit={submit} className="stack" noValidate>
        <Field
          id={inputId}
          label={label}
          hint={hint}
          autoComplete="off"
          maxLength={60}
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
            {t.cancel}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
