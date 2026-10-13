import type { Metadata } from "next";
import { Suspense } from "react";
import { RegisterForm } from "../../../components/register-form";
import { getT } from "../../../lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).auth.registerTitle };
}

export default async function RegisterPage() {
  const t = await getT();
  return (
    <>
      <h1>{t.auth.registerTitle}</h1>
      <p>{t.auth.registerIntro}</p>
      <Suspense>
        <RegisterForm />
      </Suspense>
    </>
  );
}
