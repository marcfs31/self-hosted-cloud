import type { Metadata } from "next";
import { Suspense } from "react";
import { RegisterForm } from "../../../components/register-form";
import { messages } from "../../../lib/messages";

export const metadata: Metadata = { title: messages.register.title };

export default function RegisterPage() {
  return (
    <>
      <h1>{messages.register.title}</h1>
      <p>{messages.register.intro}</p>
      <Suspense>
        <RegisterForm />
      </Suspense>
    </>
  );
}
