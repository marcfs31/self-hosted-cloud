"use client";

import { useEffect, useId, useRef, useState, type SubmitEvent } from "react";
import type { TotpStatus } from "@cloud/shared";
import { apiFetch, errorCodeOf } from "../../lib/api";
import { useT } from "../../lib/i18n/provider";
import { stepUpFields } from "../../lib/security";
import { useForm } from "../../lib/use-form";
import { useResource } from "../../lib/use-resource";
import { Dialog } from "../dialog";
import { Field, FormAlert, SubmitButton } from "../form";

/** What the server wants before it hands out a new long-lived credential. */
export type StepUp = ReturnType<typeof stepUpFields>;

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
  onSubmit: (name: string, stepUp: StepUp, fail: (text: string) => void) => Promise<void>;
  onClose: () => void;
  returnFocus: HTMLElement | null;
}

function loadTotpStatus(): Promise<TotpStatus> {
  return apiFetch<TotpStatus>("/auth/totp");
}

/**
 * One required name plus the current password (and an authenticator code when two-step
 * verification is on), for a new passkey or app password.
 */
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
  const all = useT();
  const t = all.security;
  const form = useForm();
  const { state, reload } = useResource(loadTotpStatus);
  const id = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const totpEnabled = state.status === "ready" && state.data.enabled;
  const ready = state.status === "ready";

  // The form only exists once we know whether a code is needed, after the dialog has opened.
  useEffect(() => {
    if (ready) {
      nameRef.current?.focus();
    }
  }, [ready]);

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === "") {
      form.fail(requiredMessage, nameRef);
      return;
    }
    if (password === "") {
      form.fail(t.stepUp.passwordRequired, passwordRef);
      return;
    }
    if (totpEnabled && code.trim() === "") {
      form.fail(t.stepUp.codeRequired, codeRef);
      return;
    }
    void form.submit(async () => {
      try {
        await onSubmit(trimmed, stepUpFields(password, code, totpEnabled), (text) => {
          form.fail(text, nameRef);
        });
      } catch (e) {
        // The generic copy talks about an email; here the person only typed a password.
        const failure = errorCodeOf(e);
        if (failure === "invalid_credentials") {
          form.fail(t.stepUp.wrongPassword, passwordRef);
          return;
        }
        if (failure === "invalid_code") {
          form.fail(all.errors.invalid_code, codeRef);
          return;
        }
        throw e;
      }
    });
  }

  return (
    <Dialog title={title} onClose={onClose} returnFocus={returnFocus}>
      {state.status === "loading" ? <p role="status">{t.stepUp.loading}</p> : null}
      {state.status === "error" ? (
        <p role="alert" className="alert">
          {all.errors[state.code]}
        </p>
      ) : null}
      {state.status === "error" ? (
        <div className="row-actions">
          <button
            type="button"
            className="button"
            onClick={() => {
              void reload();
            }}
          >
            {all.common.app.retry}
          </button>
          <button type="button" className="button button-quiet" onClick={onClose}>
            {t.cancel}
          </button>
        </div>
      ) : null}
      {state.status === "ready" ? (
        <form onSubmit={submit} className="stack" noValidate>
          <p>{t.stepUp.intro}</p>
          <Field
            id={`${id}-name`}
            label={label}
            hint={hint}
            autoComplete="off"
            maxLength={60}
            inputRef={nameRef}
            state={form}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              form.clear();
            }}
          />
          <Field
            id={`${id}-password`}
            label={t.totp.passwordLabel}
            type="password"
            autoComplete="current-password"
            inputRef={passwordRef}
            state={form}
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
              form.clear();
            }}
          />
          {totpEnabled ? (
            <Field
              id={`${id}-code`}
              label={t.stepUp.codeLabel}
              hint={t.stepUp.codeHint}
              autoComplete="one-time-code"
              autoCapitalize="none"
              spellCheck={false}
              inputRef={codeRef}
              state={form}
              value={code}
              onChange={(event) => {
                setCode(event.target.value);
                form.clear();
              }}
            />
          ) : null}
          <FormAlert form={form} />
          <div className="row-actions">
            <SubmitButton busy={form.busy} label={submitLabel} busyLabel={submittingLabel} />
            <button type="button" className="button button-quiet" onClick={onClose}>
              {t.cancel}
            </button>
          </div>
        </form>
      ) : null}
    </Dialog>
  );
}
