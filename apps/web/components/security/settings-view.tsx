"use client";

import Link from "next/link";
import { useT } from "../../lib/i18n/provider";
import { AppPasswordsSection } from "./app-passwords-section";
import { PasskeysSection } from "./passkeys-section";
import { PasswordSection } from "./password-section";
import { SessionsSection } from "./sessions-section";
import { TotpSection } from "./totp-section";

export function SettingsView() {
  const t = useT().security;
  return (
    <>
      <h1>{t.title}</h1>
      <p>{t.intro}</p>
      <p>
        <Link href="/activity">{t.activityLink}</Link>
      </p>
      <PasswordSection />
      <PasskeysSection />
      <TotpSection />
      <AppPasswordsSection />
      <SessionsSection />
    </>
  );
}
