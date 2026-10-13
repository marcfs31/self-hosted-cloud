"use client";

import { useForm } from "../lib/use-form";
import { Dialog } from "./dialog";
import { FormAlert } from "./form";

interface ConfirmDialogProps {
  title: string;
  body: string;
  cancelLabel: string;
  submitLabel: string;
  submittingLabel: string;
  /** Resolves when done (the parent then closes the dialog); a failure is shown in the dialog. */
  onConfirm: () => Promise<void>;
  onClose: () => void;
  returnFocus: HTMLElement | null;
}

/** A question with a destructive answer. Focus starts on Cancel, the safe choice. */
export function ConfirmDialog({
  title,
  body,
  cancelLabel,
  submitLabel,
  submittingLabel,
  onConfirm,
  onClose,
  returnFocus,
}: ConfirmDialogProps) {
  const form = useForm();
  return (
    <Dialog title={title} onClose={onClose} returnFocus={returnFocus}>
      <p>{body}</p>
      <FormAlert form={form} />
      <div className="row-actions">
        <button type="button" className="button button-quiet" data-autofocus="" onClick={onClose}>
          {cancelLabel}
        </button>
        <button
          type="button"
          className="button button-danger"
          disabled={form.busy}
          aria-busy={form.busy}
          onClick={() => {
            void form.submit(onConfirm);
          }}
        >
          {form.busy ? submittingLabel : submitLabel}
        </button>
      </div>
    </Dialog>
  );
}
