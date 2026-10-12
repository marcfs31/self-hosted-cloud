"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { RegisterRequest } from "@cloud/shared";
import { apiFetch } from "../lib/api";
import { messages } from "../lib/messages";
import { AccountForm } from "./account-form";

export function RegisterForm() {
  const router = useRouter();
  const token = useSearchParams().get("token");

  if (!token) {
    return (
      <p role="alert" className="alert">
        {messages.register.missingToken}
      </p>
    );
  }

  return (
    <>
      <AccountForm
        submitLabel={messages.register.submit}
        busyLabel={messages.register.submitting}
        action={async (email, password) => {
          const body: RegisterRequest = { token, email, password };
          await apiFetch("/auth/register", { method: "POST", json: body });
          router.replace("/");
        }}
      />
      <p className="note">
        {messages.register.haveAccount} <Link href="/login">{messages.register.loginLink}</Link>
      </p>
    </>
  );
}
