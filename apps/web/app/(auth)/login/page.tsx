import type { Metadata } from "next";
import { LoginForm } from "../../../components/login-form";
import { messages } from "../../../lib/messages";

export const metadata: Metadata = { title: messages.login.title };

export default function LoginPage() {
  return (
    <>
      <h1>{messages.login.title}</h1>
      <LoginForm />
    </>
  );
}
