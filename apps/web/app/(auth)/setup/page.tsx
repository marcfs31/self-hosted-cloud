import type { Metadata } from "next";
import { SetupForm } from "../../../components/setup-form";
import { getT } from "../../../lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).auth.setupTitle };
}

export default async function SetupPage() {
  const t = await getT();
  return (
    <>
      <h1>{t.auth.setupTitle}</h1>
      <p>{t.auth.setupIntro}</p>
      <SetupForm />
    </>
  );
}
