"use client";

import { useRouter } from "next/navigation";
import { useState, type SubmitEvent } from "react";
import type { LoginRequest, LoginResponse } from "@cloud/shared";
import { apiFetch } from "../lib/api";
import { useT } from "../lib/i18n/provider";
import { safeNextPath } from "../lib/session";
import { useForm } from "../lib/use-form";
import { Field, FormAlert, SubmitButton } from "./form";
import { PasskeyLoginButton } from "./security/passkey-login-button";
import { SecondFactorForm } from "./security/second-factor-form";

export function LoginForm() {
  const router = useRouter();
  const t = useT();
  const form = useForm();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [secondFactor, setSecondFactor] = useState(false);

  function signedIn() {
    router.replace(safeNextPath(new URLSearchParams(window.location.search).get("next")));
  }

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    void form.submit(async () => {
      const body: LoginRequest = { email, password };
      const result = await apiFetch<LoginResponse>("/auth/login", { method: "POST", json: body });
      if ("mfaRequired" in result) {
        setSecondFactor(true);
        return;
      }
      signedIn();
    });
  }

  if (secondFactor) {
    return (
      <SecondFactorForm
        onSignedIn={signedIn}
        onStartOver={() => {
          setSecondFactor(false);
          setPassword("");
        }}
      />
    );
  }

  return (
    <>
      <form onSubmit={onSubmit} className="stack">
        <Field
          id="email"
          label={t.auth.email}
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
          }}
        />
        <Field
          id="password"
          label={t.auth.password}
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
          }}
        />
        <FormAlert form={form} />
        <SubmitButton
          busy={form.busy}
          label={t.auth.loginSubmit}
          busyLabel={t.auth.loginSubmitting}
        />
        <PasskeyLoginButton form={form} onSignedIn={signedIn} />
      </form>
      <p className="note">{t.auth.loginNoAccount}</p>
    </>
  );
}
