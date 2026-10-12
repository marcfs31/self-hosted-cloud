"use client";

import { useRef, useState, type SubmitEvent } from "react";
import { messages } from "../lib/messages";
import { useForm } from "../lib/use-form";
import { Field, FormAlert, SubmitButton } from "./form";

const MIN_PASSWORD_LENGTH = 12;

interface Props {
  submitLabel: string;
  busyLabel: string;
  /** Creates the account; throws ApiError on failure. */
  action: (email: string, password: string) => Promise<void>;
}

/** Email + new password + confirmation, shared by first-run setup and invite acceptance. */
export function AccountForm({ submitLabel, busyLabel, action }: Props) {
  const form = useForm();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password.length < MIN_PASSWORD_LENGTH) {
      form.fail(messages.account.passwordTooShort, passwordRef);
      return;
    }
    if (password !== confirm) {
      form.fail(messages.account.passwordMismatch, confirmRef);
      return;
    }
    void form.submit(() => action(email, password));
  }

  return (
    <form onSubmit={onSubmit} className="stack">
      <Field
        id="email"
        label={messages.account.email}
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={(e) => {
          setEmail(e.target.value);
        }}
      />
      <Field
        id="password"
        label={messages.account.password}
        hint={messages.account.passwordHint}
        type="password"
        autoComplete="new-password"
        required
        inputRef={passwordRef}
        state={form}
        value={password}
        onChange={(e) => {
          setPassword(e.target.value);
        }}
      />
      <Field
        id="confirm"
        label={messages.account.confirm}
        type="password"
        autoComplete="new-password"
        required
        inputRef={confirmRef}
        state={form}
        value={confirm}
        onChange={(e) => {
          setConfirm(e.target.value);
        }}
      />
      <FormAlert form={form} />
      <SubmitButton busy={form.busy} label={submitLabel} busyLabel={busyLabel} />
    </form>
  );
}
