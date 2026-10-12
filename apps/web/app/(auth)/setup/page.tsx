import type { Metadata } from "next";
import { SetupForm } from "../../../components/setup-form";
import { messages } from "../../../lib/messages";

export const metadata: Metadata = { title: messages.setup.title };

export default function SetupPage() {
  return (
    <>
      <h1>{messages.setup.title}</h1>
      <p>{messages.setup.intro}</p>
      <SetupForm />
    </>
  );
}
