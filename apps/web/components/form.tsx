"use client";

import type { ComponentPropsWithoutRef, RefObject } from "react";
import type { FormState } from "../lib/use-form";

export function FormAlert({ form }: { form: FormState }) {
  if (!form.error) {
    return null;
  }
  return (
    <div id={form.alertId} ref={form.alertRef} role="alert" tabIndex={-1} className="alert">
      {form.error.text}
    </div>
  );
}

interface FieldProps extends Omit<ComponentPropsWithoutRef<"input">, "id"> {
  id: string;
  label: string;
  hint?: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  /** With inputRef, marks the field invalid when the form's error points at it. */
  state?: FormState;
  /** Visually hides the label (it is still read by assistive technology). */
  hideLabel?: boolean;
}

export function Field({ id, label, hint, state, inputRef, hideLabel, ...input }: FieldProps) {
  const hintId = `${id}-hint`;
  const invalid = state !== undefined && inputRef !== undefined && state.error?.field === inputRef;
  const describedBy = [hint ? hintId : null, invalid ? state.alertId : null].filter(Boolean);
  return (
    <div className="field">
      <label htmlFor={id} className={hideLabel ? "sr-only" : undefined}>
        {label}
      </label>
      <input
        {...input}
        id={id}
        ref={inputRef}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy.length > 0 ? describedBy.join(" ") : undefined}
      />
      {hint ? (
        <p id={hintId} className="hint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

interface SubmitButtonProps {
  busy: boolean;
  label: string;
  busyLabel: string;
}

export function SubmitButton({ busy, label, busyLabel }: SubmitButtonProps) {
  return (
    <button type="submit" className="button" disabled={busy} aria-busy={busy}>
      {busy ? busyLabel : label}
    </button>
  );
}
