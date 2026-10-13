"use client";

import { useEffect, useRef, useState, type SubmitEvent } from "react";
import type { TotpLoginRequest } from "@cloud/shared";
import { apiFetch } from "../../lib/api";
import { useT } from "../../lib/i18n/provider";
import { compactCode } from "../../lib/security";
import { useForm } from "../../lib/use-form";
import { Field, FormAlert, SubmitButton } from "../form";

/** The second step of signing in: a 6-digit code, or a recovery code instead. */
export function SecondFactorForm({
  onSignedIn,
  onStartOver,
}: {
  onSignedIn: () => void;
  onStartOver: () => void;
}) {
  const t = useT().security.login;
  const form = useForm();
  const inputRef = useRef<HTMLInputElement>(null);
  const [recovery, setRecovery] = useState(false);
  const [code, setCode] = useState("");

  useEffect(() => {
    inputRef.current?.focus();
  }, [recovery]);

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    void form.submit(async () => {
      const body: TotpLoginRequest = { code: compactCode(code) };
      await apiFetch("/auth/login/totp", { method: "POST", json: body });
      onSignedIn();
    });
  }

  return (
    <form onSubmit={onSubmit} className="stack">
      <Field
        id="second-factor-code"
        label={recovery ? t.recoveryLabel : t.codeLabel}
        hint={recovery ? t.recoveryIntro : t.codeIntro}
        type="text"
        inputMode={recovery ? "text" : "numeric"}
        autoComplete={recovery ? "off" : "one-time-code"}
        autoCapitalize="none"
        spellCheck={false}
        required
        inputRef={inputRef}
        state={form}
        value={code}
        onChange={(e) => {
          setCode(e.target.value);
        }}
      />
      <FormAlert form={form} />
      <SubmitButton busy={form.busy} label={t.submit} busyLabel={t.submitting} />
      <div className="row-actions">
        <button
          type="button"
          className="link-button"
          onClick={() => {
            setRecovery((on) => !on);
            setCode("");
            form.clear();
          }}
        >
          {recovery ? t.useCode : t.useRecovery}
        </button>
        <button type="button" className="link-button" onClick={onStartOver}>
          {t.startOver}
        </button>
      </div>
    </form>
  );
}
