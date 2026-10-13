"use client";

import { useId, useRef, useState, type SubmitEvent } from "react";
import { ApiError } from "../../lib/api";
import { useT } from "../../lib/i18n/provider";
import { unlockShare } from "../../lib/shares-api";
import { useForm } from "../../lib/use-form";
import { FormAlert, SubmitButton } from "../form";
import { PasswordField } from "../password-field";

interface UnlockFormProps {
  token: string;
  /** Resolves once the share has been read again, now that the grant cookie is set. */
  onUnlocked: () => Promise<void>;
}

export function UnlockForm({ token, onUnlocked }: UnlockFormProps) {
  const t = useT().shares.public.locked;
  const form = useForm();
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [password, setPassword] = useState("");

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    void form.submit(async () => {
      try {
        await unlockShare(token, password);
      } catch (e) {
        // A wrong password is the one failure worth its own words; the rest read as usual.
        if (e instanceof ApiError && e.code === "invalid_credentials") {
          form.fail(t.wrong, inputRef);
          return;
        }
        throw e;
      }
      await onUnlocked();
    });
  }

  return (
    <>
      <h1>{t.title}</h1>
      <p>{t.body}</p>
      <form onSubmit={submit} className="stack" noValidate>
        <PasswordField
          id={id}
          label={t.label}
          autoComplete="off"
          required
          inputRef={inputRef}
          state={form}
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            form.clear();
          }}
        />
        <FormAlert form={form} />
        <div>
          <SubmitButton busy={form.busy} label={t.submit} busyLabel={t.submitting} />
        </div>
      </form>
    </>
  );
}
