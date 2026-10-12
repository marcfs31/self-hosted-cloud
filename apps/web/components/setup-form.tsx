"use client";

import { useRouter } from "next/navigation";
import type { SetupRequest } from "@cloud/shared";
import { apiFetch } from "../lib/api";
import { messages } from "../lib/messages";
import { AccountForm } from "./account-form";

export function SetupForm() {
  const router = useRouter();
  return (
    <AccountForm
      submitLabel={messages.setup.submit}
      busyLabel={messages.setup.submitting}
      action={async (email, password) => {
        const body: SetupRequest = { email, password };
        await apiFetch("/auth/setup", { method: "POST", json: body });
        router.replace("/");
      }}
    />
  );
}
