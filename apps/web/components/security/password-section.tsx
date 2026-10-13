"use client";

import { useId, useRef, useState, type SubmitEvent } from "react";
import type { ChangePasswordRequest } from "@cloud/shared";
import { apiFetch, errorCodeOf } from "../../lib/api";
import { useT } from "../../lib/i18n/provider";
import { useForm } from "../../lib/use-form";
import { Field, FormAlert, SubmitButton } from "../form";

const MIN_PASSWORD_LENGTH = 12;

/** Change the password. Every other device is signed out; this one stays signed in. */
export function PasswordSection() {
  const all = useT();
  const t = all.security.password;
  const form = useForm();
  const id = useId();
  const currentRef = useRef<HTMLInputElement>(null);
  const nextRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [notice, setNotice] = useState("");

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice("");
    if (current === "") {
      form.fail(all.security.stepUp.passwordRequired, currentRef);
      return;
    }
    if (next.length < MIN_PASSWORD_LENGTH) {
      form.fail(all.auth.passwordTooShort, nextRef);
      return;
    }
    if (next !== confirm) {
      form.fail(all.auth.passwordMismatch, confirmRef);
      return;
    }
    void form.submit(async () => {
      const body: ChangePasswordRequest = { currentPassword: current, newPassword: next };
      try {
        await apiFetch("/auth/password", { method: "POST", json: body });
      } catch (e) {
        // The generic copy talks about an email; here the person only typed a password.
        if (errorCodeOf(e) === "invalid_credentials") {
          form.fail(all.security.stepUp.wrongPassword, currentRef);
          return;
        }
        throw e;
      }
      setCurrent("");
      setNext("");
      setConfirm("");
      setNotice(t.done);
    });
  }

  return (
    <section aria-labelledby="password-heading" className="stack">
      <h2 id="password-heading">{t.title}</h2>
      <p>{t.intro}</p>
      <form onSubmit={onSubmit} className="stack" noValidate>
        <Field
          id={`${id}-current`}
          label={t.currentLabel}
          type="password"
          autoComplete="current-password"
          inputRef={currentRef}
          state={form}
          value={current}
          onChange={(event) => {
            setCurrent(event.target.value);
            form.clear();
          }}
        />
        <Field
          id={`${id}-new`}
          label={t.newLabel}
          hint={all.auth.passwordHint}
          type="password"
          autoComplete="new-password"
          inputRef={nextRef}
          state={form}
          value={next}
          onChange={(event) => {
            setNext(event.target.value);
            form.clear();
          }}
        />
        <Field
          id={`${id}-confirm`}
          label={all.auth.confirmPassword}
          type="password"
          autoComplete="new-password"
          inputRef={confirmRef}
          state={form}
          value={confirm}
          onChange={(event) => {
            setConfirm(event.target.value);
            form.clear();
          }}
        />
        <FormAlert form={form} />
        <div>
          <SubmitButton busy={form.busy} label={t.submit} busyLabel={t.submitting} />
        </div>
      </form>
      <p role="status" className="note">
        {notice}
      </p>
    </section>
  );
}
