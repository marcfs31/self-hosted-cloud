"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { RegisterRequest } from "@cloud/shared";
import { apiFetch } from "../lib/api";
import { useT } from "../lib/i18n/provider";
import { AccountForm } from "./account-form";

export function RegisterForm() {
  const router = useRouter();
  const t = useT();
  const token = useSearchParams().get("token");

  if (!token) {
    return (
      <p role="alert" className="alert">
        {t.auth.registerMissingToken}
      </p>
    );
  }

  return (
    <>
      <AccountForm
        submitLabel={t.auth.registerSubmit}
        busyLabel={t.auth.registerSubmitting}
        action={async (email, password) => {
          const body: RegisterRequest = { token, email, password };
          await apiFetch("/auth/register", { method: "POST", json: body });
          router.replace("/");
        }}
      />
      <p className="note">
        {t.auth.registerHaveAccount} <Link href="/login">{t.auth.registerLoginLink}</Link>
      </p>
    </>
  );
}
