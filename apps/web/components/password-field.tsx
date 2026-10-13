"use client";

import { useState, type ChangeEvent, type RefObject } from "react";
import { useT } from "../lib/i18n/provider";
import type { FormState } from "../lib/use-form";

interface PasswordFieldProps {
  id: string;
  label: string;
  hint?: string;
  value: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  inputRef: RefObject<HTMLInputElement | null>;
  state: FormState;
  autoComplete: string;
  required?: boolean;
  "data-autofocus"?: string;
}

/** A password input with a toggle that shows what was typed. */
export function PasswordField({
  id,
  label,
  hint,
  value,
  onChange,
  inputRef,
  state,
  autoComplete,
  required,
  "data-autofocus": autofocus,
}: PasswordFieldProps) {
  const t = useT().shares.password;
  const [visible, setVisible] = useState(false);
  const hintId = `${id}-hint`;
  const invalid = state.error?.field === inputRef;
  const describedBy = [hint ? hintId : null, invalid ? state.alertId : null].filter(Boolean);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="input-row">
        <input
          id={id}
          ref={inputRef}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          autoCapitalize="off"
          spellCheck={false}
          required={required}
          data-autofocus={autofocus}
          value={value}
          onChange={onChange}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy.length > 0 ? describedBy.join(" ") : undefined}
        />
        <button
          type="button"
          className="button button-quiet"
          aria-controls={id}
          onClick={() => {
            setVisible((v) => !v);
          }}
        >
          {visible ? t.hide : t.show}
        </button>
      </div>
      {hint ? (
        <p id={hintId} className="hint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
