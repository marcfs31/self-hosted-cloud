import type { Metadata } from "next";
import { LoginForm } from "../../../components/login-form";
import { getT } from "../../../lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).auth.loginTitle };
}

export default async function LoginPage() {
  const t = await getT();
  return (
    <>
      <h1>{t.auth.loginTitle}</h1>
      <LoginForm />
    </>
  );
}
