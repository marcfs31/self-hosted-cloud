"use client";

import { useRouter } from "next/navigation";
import { useState, type SubmitEvent } from "react";
import type { LoginRequest } from "@cloud/shared";
import { apiFetch } from "../lib/api";
import { messages } from "../lib/messages";
import { safeNextPath } from "../lib/session";
import { useForm } from "../lib/use-form";
import { Field, FormAlert, SubmitButton } from "./form";

export function LoginForm() {
  const router = useRouter();
  const form = useForm();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    void form.submit(async () => {
      const body: LoginRequest = { email, password };
      await apiFetch("/auth/login", { method: "POST", json: body });
      router.replace(safeNextPath(new URLSearchParams(window.location.search).get("next")));
    });
  }

  return (
    <>
      <form onSubmit={onSubmit} className="stack">
        <Field
          id="email"
          label={messages.login.email}
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
          label={messages.login.password}
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
          label={messages.login.submit}
          busyLabel={messages.login.submitting}
        />
      </form>
      <p className="note">{messages.login.noAccount}</p>
    </>
  );
}
