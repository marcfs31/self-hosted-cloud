"use client";

import { useRouter } from "next/navigation";
import type { SetupRequest } from "@cloud/shared";
import { apiFetch } from "../lib/api";
import { useT } from "../lib/i18n/provider";
import { AccountForm } from "./account-form";

export function SetupForm() {
  const router = useRouter();
  const t = useT();
  return (
    <AccountForm
      submitLabel={t.auth.setupSubmit}
      busyLabel={t.auth.setupSubmitting}
      action={async (email, password) => {
        const body: SetupRequest = { email, password };
        await apiFetch("/auth/setup", { method: "POST", json: body });
        router.replace("/");
      }}
    />
  );
}
